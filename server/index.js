// search-surface backend — Express 5 + better-sqlite3.
// Serves /api/search/* from local SQLite, proxies /api/siphon/* and /api/prism/*
// to upstream services (same pattern as prism-surface's monolith backend).

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios').default || require('axios');

const searchRoutes = require('./routes/search');
const searchHelperRoutes = require('./search-helpers');
const authRoutes = require('./auth-routes');
const adminRoutes = require('./admin-routes');
const zelloRoutes = require('./routes/zello');
const integrationsRoutes = require('./routes/integrations');
const preferencesRoutes = require('./routes/preferences');
const { router: internalRoutes } = require('./routes/internal');

const app = express();
const PORT = process.env.API_PORT || 4078;
const SIPHON_URL = process.env.SIPHON_URL || 'http://127.0.0.1:3883';
const PRISM_URL = process.env.PRISM_URL || 'http://127.0.0.1:3885';

// ── Middleware ──
// In dev the web app runs on :4077 and the api on :4078 — allow credentials
// from the Next dev origin so the session cookie round-trips. In prod nginx
// fronts both on the same origin and this is moot.
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:4077';
app.use(cors({
  origin: (origin, cb) => cb(null, origin || CORS_ORIGIN),
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── Auth / multi-tenant ──
app.use('/api/auth', authRoutes);

// ── Platform admin (cross-tenant) ──
app.use('/api/admin', adminRoutes);

// ── Zello BYOK (per-tenant integration) — kept for its JWT-minting flow ──
app.use('/api/zello', zelloRoutes);

// ── Generic BYOK integrations (Telegram/Slack/Discord/Matrix/TAK/Broadnet) ──
app.use('/api/integrations', integrationsRoutes);

// ── Per-user UI preferences (map basemap, 3D toggle, layer picks) ──
app.use('/api/preferences', preferencesRoutes);

// ── Internal API for dispatch gateway (shared-secret, not tenant-scoped) ──
// nginx MUST block /api/internal/* from public reach.
app.use('/api/internal', internalRoutes);

// ── TTL cache for upstream proxies (mirrors prism-surface) ──
const proxyCache = new Map();
const CACHE_TTL = {
  default: 5000,
  weather: 60000,
  alerts: 5000,
};
function getCacheTTL(url) {
  if (url.includes('/weather') || url.includes('/radar')) return CACHE_TTL.weather;
  if (url.includes('/alerts')) return CACHE_TTL.alerts;
  return CACHE_TTL.default;
}
function cachedProxy(key, fetcher, ttl) {
  const cached = proxyCache.get(key);
  if (cached && Date.now() - cached.ts < ttl) return Promise.resolve(cached.data);
  return fetcher().then(data => {
    proxyCache.set(key, { data, ts: Date.now() });
    if (proxyCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of proxyCache) if (now - v.ts > 300000) proxyCache.delete(k);
    }
    return data;
  });
}

// ── Upload static ──
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Health ──
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'search-surface', port: PORT }));

// ── Siphon proxy ──
app.use('/api/siphon', async (req, res) => {
  try {
    const url = `${SIPHON_URL}/api${req.url}`;
    if (req.method === 'POST') {
      const resp = await axios.post(url, req.body, { timeout: 15000 });
      return res.json(resp.data);
    }
    const ttl = getCacheTTL(req.url);
    const data = await cachedProxy(`siphon:${req.url}`, async () => {
      const resp = await axios.get(url, { timeout: 15000 });
      return resp.data;
    }, ttl);
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: `Siphon: ${err.message}` });
  }
});

// ── Prism proxy ──
app.use('/api/prism', async (req, res) => {
  try {
    const url = `${PRISM_URL}/api${req.url}`;
    if (req.method === 'POST') {
      const resp = await axios.post(url, req.body, { timeout: 15000 });
      return res.json(resp.data);
    }
    const ttl = getCacheTTL(req.url);
    const data = await cachedProxy(`prism:${req.url}`, async () => {
      const resp = await axios.get(url, { timeout: 15000 });
      return resp.data;
    }, ttl);
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: `Prism: ${err.message}` });
  }
});

// ── Search helpers (geocode, OSM, LPB, airspace) — must come first ──
app.use('/api/search', searchHelperRoutes);
// ── Search operations (zones, teams, reports, comms, SITREP, field) ──
app.use('/api/search', searchRoutes);

app.listen(PORT, () => {
  console.log(`[search-surface] API listening on :${PORT}`);
  console.log(`[search-surface] SIPHON_URL=${SIPHON_URL}`);
  console.log(`[search-surface] PRISM_URL=${PRISM_URL}`);
});
