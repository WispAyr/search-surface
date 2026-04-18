// Generic BYOK integration CRUD.
//
// Replaces the one-off Zello route pattern for Telegram/Slack/Discord/Matrix/
// TAK/Broadnet. Each integration stores its config at tenant_settings key
// "{name}.config" (encrypted). Zello keeps its dedicated route because it
// needs server-side JWT minting; it's wired through the same tenant_settings
// store so the list endpoint sees it too.
//
// Endpoints:
//   GET    /api/integrations                → { integrations: [{ name, configured, updated_at, summary }] }
//   GET    /api/integrations/:name          → { configured, ...safe_fields }
//   PUT    /api/integrations/:name          → save config (owner only), omitted secret fields are kept
//   DELETE /api/integrations/:name          → remove config (owner only)
//   POST   /api/integrations/:name/test     → fire test message via dispatch gateway
//
// Supported integrations come from the static list below. The dedicated Zello
// route is still mounted separately because of its JWT-minting flow; this
// module treats it as a pass-through for listing purposes only.

const express = require('express');
const axios = require('axios');
const { settings } = require('../auth-db');
const { routing } = require('../search-db');
const { requireTenant, requireRole } = require('../tenant-middleware');

const router = express.Router();

const SUPPORTED = [
  { name: 'telegram', displayName: 'Telegram', secretFields: ['bot_token'] },
  { name: 'slack', displayName: 'Slack', secretFields: ['webhook_url'] },
  { name: 'discord', displayName: 'Discord', secretFields: ['webhook_url'] },
  { name: 'matrix', displayName: 'Matrix', secretFields: ['access_token', 'password'] },
  { name: 'tak', displayName: 'TAK Server', secretFields: ['client_cert', 'client_key', 'ca_cert'] },
  { name: 'broadnet', displayName: 'Broadnet', secretFields: [] },
];

const BY_NAME = new Map(SUPPORTED.map(s => [s.name, s]));

function settingKey(name) { return `${name}.config`; }

function safeFields(spec, cfg) {
  if (!cfg) return null;
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (spec.secretFields.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

// GET list — returns the configured state for every supported integration,
// plus the Zello config if present (Zello route owns its own writes).
router.get('/', requireTenant, (req, res) => {
  const integrations = SUPPORTED.map(spec => {
    const cfg = settings.getJson(req.tenant.id, settingKey(spec.name));
    return {
      name: spec.name,
      display_name: spec.displayName,
      configured: Boolean(cfg),
      updated_at: cfg?.updated_at || null,
      summary: safeFields(spec, cfg),
    };
  });
  const zelloCfg = settings.getJson(req.tenant.id, 'zello.config');
  integrations.push({
    name: 'zello',
    display_name: 'Zello',
    configured: Boolean(zelloCfg),
    updated_at: zelloCfg?.updated_at || null,
    summary: zelloCfg ? { issuer: zelloCfg.issuer, network_type: zelloCfg.network_type, default_channel: zelloCfg.default_channel } : null,
  });
  res.json({ integrations });
});

router.get('/:name', requireTenant, (req, res) => {
  const spec = BY_NAME.get(req.params.name);
  if (!spec) return res.status(404).json({ error: 'unknown integration' });
  const cfg = settings.getJson(req.tenant.id, settingKey(spec.name));
  if (!cfg) return res.json({ configured: false });
  res.json({ configured: true, ...safeFields(spec, cfg), updated_at: cfg.updated_at });
});

router.put('/:name', requireTenant, requireRole('owner'), (req, res) => {
  const spec = BY_NAME.get(req.params.name);
  if (!spec) return res.status(404).json({ error: 'unknown integration' });
  const incoming = req.body || {};
  const prior = settings.getJson(req.tenant.id, settingKey(spec.name)) || {};
  // Preserve any secret fields the client omitted (client sends empty when
  // it doesn't want to overwrite). Non-secret fields are replaced wholesale.
  const cfg = { ...incoming };
  for (const key of spec.secretFields) {
    if (cfg[key] == null || cfg[key] === '') {
      if (prior[key]) cfg[key] = prior[key];
    }
  }
  cfg.updated_at = new Date().toISOString();
  settings.setJson(req.tenant.id, settingKey(spec.name), cfg, { encrypted: true });
  res.json({ ok: true, configured: true, ...safeFields(spec, cfg), updated_at: cfg.updated_at });
});

router.delete('/:name', requireTenant, requireRole('owner'), (req, res) => {
  const spec = BY_NAME.get(req.params.name);
  if (!spec) return res.status(404).json({ error: 'unknown integration' });
  settings.delete(req.tenant.id, settingKey(spec.name));
  res.json({ ok: true });
});

// Send a test message via the dispatch gateway. We don't hit the provider
// directly from here — the gateway is the one path we want exercised.
router.post('/:name/test', requireTenant, requireRole('owner'), async (req, res) => {
  const spec = BY_NAME.get(req.params.name);
  if (!spec) return res.status(404).json({ error: 'unknown integration' });
  const gatewayUrl = process.env.DISPATCH_URL;
  const sharedSecret = process.env.DISPATCH_SHARED_SECRET;
  if (!gatewayUrl || !sharedSecret) {
    return res.status(500).json({ error: 'dispatch gateway not configured (set DISPATCH_URL and DISPATCH_SHARED_SECRET)' });
  }
  try {
    const result = await axios.post(`${gatewayUrl.replace(/\/+$/, '')}/send`, {
      tenant_id: req.tenant.id,
      channels: [spec.name],
      message: { from: 'search-surface', body: `Test message from ${req.tenant.name || req.tenant.id}. Integration: ${spec.displayName}.` },
    }, {
      timeout: 15_000,
      headers: { 'x-comms-app': 'search-surface', 'x-comms-secret': sharedSecret },
      validateStatus: () => true,
    });
    const channelResult = result.data?.results?.[spec.name];
    if (!channelResult) return res.status(502).json({ ok: false, error: 'no result from gateway' });
    if (!channelResult.ok) return res.status(400).json({ ok: false, error: channelResult.error || 'send failed' });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Compute the HMAC-signed inbound webhook URL for a (channel, operation).
// Owner pastes this into Telegram's setWebhook / Slack Events / Discord
// outgoing integration so siphon can receive inbound messages.
router.get('/webhook-url', requireTenant, requireRole('owner'), (req, res) => {
  const channel = String(req.query.channel || '');
  const operationId = String(req.query.operation_id || '');
  if (!channel || !operationId) return res.status(400).json({ error: 'channel and operation_id required' });
  const siphonUrl = process.env.SIPHON_PUBLIC_URL;
  const secret = process.env.COMMS_WEBHOOK_SECRET;
  if (!siphonUrl || !secret) return res.status(503).json({ error: 'inbound webhooks not configured (SIPHON_PUBLIC_URL + COMMS_WEBHOOK_SECRET required)' });
  const msg = `${channel}|${req.tenant.id}|${operationId}`;
  const sig = require('crypto').createHmac('sha256', secret).update(msg).digest('hex').slice(0, 32);
  res.json({
    url: `${siphonUrl.replace(/\/+$/, '')}/api/comms/inbound/${channel}/${req.tenant.id}/${operationId}/${sig}`,
    channel,
    operation_id: operationId,
  });
});

// ── Cross-channel routing ────────────────────────────────
//
// GET  /api/integrations/routing[?operation_id=]  → effective config
// PUT  /api/integrations/routing                  → { operation_id?, enabled_channels[], fan_out_all }
// DELETE /api/integrations/routing?operation_id=  → remove override (or tenant default)

router.get('/routing/config', requireTenant, (req, res) => {
  const operationId = req.query.operation_id ? String(req.query.operation_id) : null;
  const effective = routing.getEffective(req.tenant.id, operationId);
  const tenantDefault = routing.get(req.tenant.id, null);
  const override = operationId ? routing.get(req.tenant.id, operationId) : null;
  res.json({
    effective,
    tenant_default: tenantDefault,
    operation_override: override,
  });
});

router.put('/routing/config', requireTenant, requireRole('owner'), (req, res) => {
  const { operation_id, enabled_channels, fan_out_all } = req.body || {};
  if (!Array.isArray(enabled_channels)) return res.status(400).json({ error: 'enabled_channels must be an array' });
  const saved = routing.set(req.tenant.id, operation_id || null, {
    enabled_channels,
    fan_out_all: fan_out_all !== false,
  });
  res.json({ ok: true, config: saved });
});

router.delete('/routing/config', requireTenant, requireRole('owner'), (req, res) => {
  const operationId = req.query.operation_id ? String(req.query.operation_id) : null;
  routing.remove(req.tenant.id, operationId);
  res.json({ ok: true });
});

module.exports = router;
