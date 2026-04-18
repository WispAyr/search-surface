// Per-user map preferences: basemap choice, 3D toggle, enabled layers, etc.
// Stored as an opaque JSON blob so the UI can evolve without schema changes.

const express = require('express');
const { mapPrefs } = require('../search-db');
const { requireTenant } = require('../tenant-middleware');

const router = express.Router();

router.get('/map', requireTenant, (req, res) => {
  const { prefs, updated_at } = mapPrefs.get(req.tenant.user_id);
  res.json({ prefs, updated_at });
});

router.put('/map', requireTenant, (req, res) => {
  const prefs = req.body?.prefs;
  if (prefs && typeof prefs !== 'object') {
    return res.status(400).json({ error: '`prefs` must be an object' });
  }
  const result = mapPrefs.set(req.tenant.user_id, prefs || {});
  res.json(result);
});

module.exports = router;
