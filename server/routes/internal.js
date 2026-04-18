// Internal API consumed only by dispatch gateway.
//
// Auth model: shared-secret header (DISPATCH_SHARED_SECRET). No tenant cookie —
// the gateway is trusted to request creds for any tenant it's routing for.
// IMPORTANT: this router must be mounted WITHOUT requireTenant in front of it.
// It should NOT be exposed to the public internet; nginx blocks /api/internal/*.

const express = require('express');
const crypto = require('crypto');
const { settings } = require('../auth-db');
const { comms, operations, routing } = require('../search-db');

const router = express.Router();

function requireSharedSecret(req, res, next) {
  const expected = process.env.DISPATCH_SHARED_SECRET;
  if (!expected) return res.status(500).json({ error: 'DISPATCH_SHARED_SECRET not set on search-surface' });
  const got = req.headers['x-comms-secret'];
  if (typeof got !== 'string') return res.status(401).json({ error: 'missing shared secret' });
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return res.status(401).json({ error: 'invalid shared secret' });
  try {
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'invalid shared secret' });
  } catch {
    return res.status(401).json({ error: 'invalid shared secret' });
  }
  next();
}

// GET /api/internal/comms-config?tenant_id=&channel=
// Gateway asks for a tenant's BYOK config for a specific channel.
// Returns { config: { ... } } with the DECRYPTED config, or 404 if not set.
router.get('/comms-config', requireSharedSecret, (req, res) => {
  const tenantId = String(req.query.tenant_id || '');
  const channel = String(req.query.channel || '');
  if (!tenantId || !channel) return res.status(400).json({ error: 'tenant_id and channel required' });
  const key = `${channel}.config`;
  const cfg = settings.getJson(tenantId, key);
  if (!cfg) return res.status(404).json({ error: 'not configured' });
  res.json({ config: cfg });
});

// POST /api/internal/comms-ingest
// Gateway (or a siphon webhook source) pushes an inbound message into the
// ops comms log. We write it, broadcast via SSE, and return the created row.
//   body: { tenant_id, operation_id, source_channel, from, body, timestamp? }
router.post('/comms-ingest', requireSharedSecret, express.json({ limit: '1mb' }), (req, res) => {
  const { tenant_id, operation_id, source_channel, from, body } = req.body || {};
  if (!operation_id || !source_channel || !body) {
    return res.status(400).json({ error: 'operation_id, source_channel, and body required' });
  }
  // Sanity: make sure the operation belongs to the claimed tenant.
  const opTenant = operations.getTenantId(operation_id);
  if (tenant_id && opTenant && opTenant !== tenant_id) {
    return res.status(403).json({ error: 'operation not in tenant' });
  }
  const entry = comms.add(operation_id, {
    from_callsign: from || source_channel,
    message: body,
    type: 'radio',
    source_channel,
  });
  // Reuse the search routes' SSE broadcaster if available — it's lazily
  // imported to avoid a circular dep.
  try {
    const { broadcast } = require('./search');
    if (typeof broadcast === 'function') broadcast(operation_id, { type: 'comms', data: entry });
  } catch { /* if search routes not yet loaded, clients will pick it up on refresh */ }
  res.status(201).json(entry);

  // Cross-channel fan-out — fire-and-forget. Looks up the tenant's routing
  // config, strips the source_channel (don't echo back), and posts to the
  // dispatch /route endpoint.
  const effectiveTenant = tenant_id || opTenant;
  if (!effectiveTenant) return;
  const gatewayUrl = process.env.DISPATCH_URL;
  const sharedSecret = process.env.DISPATCH_SHARED_SECRET;
  if (!gatewayUrl || !sharedSecret) return;
  let targets = [];
  try {
    const cfg = routing.getEffective(effectiveTenant, operation_id);
    targets = (cfg?.enabled_channels || []).filter((c) => c !== source_channel);
  } catch { targets = []; }
  if (targets.length === 0) return;
  const axios = require('axios');
  axios.post(`${gatewayUrl.replace(/\/+$/, '')}/route`, {
    tenant_id: effectiveTenant,
    operation_id,
    source_channel,
    message: { from: from || source_channel, body, meta: { operation_id } },
  }, {
    timeout: 15_000,
    headers: { 'x-comms-app': 'search-surface', 'x-comms-secret': sharedSecret },
    validateStatus: () => true,
  }).then((result) => {
    try {
      const { broadcast } = require('./search');
      if (typeof broadcast === 'function') broadcast(operation_id, { type: 'comms_fanout', data: { comms_id: entry.id, results: result.data?.results || {} } });
    } catch { /* ignore */ }
  }).catch((err) => console.warn('[internal] comms fan-out failed:', err.message));
});

module.exports = { router, requireSharedSecret };
