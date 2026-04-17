// Zello BYOK integration for search-surface.
//
// Flow:
//   1. Owner stores their Zello developer credentials (issuer + RSA private
//      key + optional default channel) via PUT /api/zello/settings. The key
//      is AES-GCM encrypted at rest using AUTH_SECRET.
//   2. Frontend PTT panel calls POST /api/zello/token to mint a short-lived
//      RS256 JWT bound to the tenant's issuer. We never ship the private key
//      to the browser.
//   3. Browser opens wss://zello.io/ws directly with the minted JWT.
//
// JWT format per Zello docs (https://github.com/zelloptt/zello-channel-api):
//   header: { alg: "RS256", typ: "JWT" }
//   payload: { iss: "<issuer>", exp: <unix_ts> }
//   signed RS256 with the developer's private key.
//
// We sign inline with node:crypto — no jsonwebtoken dep needed.

const express = require('express');
const crypto = require('crypto');
const { settings } = require('../auth-db');
const { requireTenant, requireRole } = require('../tenant-middleware');

const router = express.Router();

const SETTING_KEY = 'zello.config';
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwtRs256(payload, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  const encSig = sig.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${signingInput}.${encSig}`;
}

function loadConfig(tenantId) {
  return settings.getJson(tenantId, SETTING_KEY);
}

function maskKey(pem) {
  if (!pem) return null;
  const lines = pem.split('\n').filter(Boolean);
  if (lines.length < 2) return '***';
  return `${lines[0]}\n…${lines.length - 2} lines…\n${lines[lines.length - 1]}`;
}

// ── GET current config (never leaks the raw key) ──
router.get('/settings', requireTenant, (req, res) => {
  const cfg = loadConfig(req.tenant.id);
  if (!cfg) return res.json({ configured: false });
  res.json({
    configured: true,
    issuer: cfg.issuer,
    network_type: cfg.network_type || 'consumer',
    network_name: cfg.network_name || null,
    default_channel: cfg.default_channel || null,
    private_key_preview: maskKey(cfg.private_key),
    updated_at: cfg.updated_at,
  });
});

// ── PUT (owner only) ──
router.put('/settings', requireTenant, requireRole('owner'), (req, res) => {
  const { issuer, private_key, network_type, network_name, default_channel } = req.body || {};
  if (!issuer || !private_key) return res.status(400).json({ error: 'issuer and private_key required' });
  if (!String(private_key).includes('BEGIN') || !String(private_key).includes('PRIVATE KEY')) {
    return res.status(400).json({ error: 'private_key must be a PEM-encoded RSA key' });
  }
  // Validate: attempt a dummy sign so we fail fast on mis-pasted keys.
  try {
    signJwtRs256({ iss: issuer, exp: Math.floor(Date.now() / 1000) + 60 }, private_key);
  } catch (err) {
    return res.status(400).json({ error: `Invalid private key: ${err.message}` });
  }
  const cfg = {
    issuer: String(issuer).trim(),
    private_key: String(private_key),
    network_type: network_type === 'work' ? 'work' : 'consumer',
    network_name: network_name ? String(network_name).trim() : null,
    default_channel: default_channel ? String(default_channel).trim() : null,
    updated_at: new Date().toISOString(),
  };
  settings.setJson(req.tenant.id, SETTING_KEY, cfg, { encrypted: true });
  res.json({
    ok: true,
    configured: true,
    issuer: cfg.issuer,
    network_type: cfg.network_type,
    network_name: cfg.network_name,
    default_channel: cfg.default_channel,
    updated_at: cfg.updated_at,
  });
});

router.delete('/settings', requireTenant, requireRole('owner'), (req, res) => {
  settings.delete(req.tenant.id, SETTING_KEY);
  res.json({ ok: true });
});

// ── Mint a token for the browser to connect with ──
//
// Returns:
//   {
//     token: "<jwt>",
//     expires_at: ISO,
//     ws_url: "wss://zello.io/ws",
//     channel: "<default_channel or requested>",
//     username: <user email, used as display name on channel>,
//   }
router.post('/token', requireTenant, (req, res) => {
  const cfg = loadConfig(req.tenant.id);
  if (!cfg) return res.status(400).json({ error: 'Zello is not configured for this team' });
  const requestedChannel = req.body?.channel ? String(req.body.channel).trim() : null;
  const channel = requestedChannel || cfg.default_channel;
  if (!channel) return res.status(400).json({ error: 'No channel specified and no default_channel set' });

  const ttl = Math.min(Math.max(parseInt(req.body?.ttl_seconds, 10) || DEFAULT_TTL_SECONDS, 60), 6 * 3600);
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = { iss: cfg.issuer, exp: nowSec + ttl };

  let token;
  try {
    token = signJwtRs256(payload, cfg.private_key);
  } catch (err) {
    return res.status(500).json({ error: `Failed to sign token: ${err.message}` });
  }

  res.json({
    token,
    expires_at: new Date((nowSec + ttl) * 1000).toISOString(),
    ws_url: cfg.network_type === 'work' && cfg.network_name
      ? `wss://${cfg.network_name}.zellowork.com/ws`
      : 'wss://zello.io/ws',
    channel,
    username: req.tenant.email,
    display_name: req.tenant.display_name || req.tenant.email,
  });
});

module.exports = router;
