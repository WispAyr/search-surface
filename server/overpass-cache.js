// Persistent Overpass cache — SQLite on disk, tile-quantised keys.
//
// Two problems with the previous in-memory cache:
//   • Keyed on bbox to 3 decimal places (~100m) — any small pan/zoom in the
//     grid tool cracked the cache.
//   • Died on every systemctl restart, so the first request after a deploy
//     paid full Overpass latency (and during public-Overpass brownouts,
//     failed outright with no stale fallback).
//
// Fixes:
//   • Keys are built from a *tiled* bbox (0.01° ≈ 1.1 km lat / 0.65 km lon
//     at 55°N). Callers are expected to ALSO send the tiled bbox to
//     Overpass so the cached payload actually covers the caller's request.
//     Oversampling by one tile on each side is fine — the client already
//     clips the returned features to whatever it needs.
//   • Disk-backed via better-sqlite3 in the same data/ dir as search.db.
//   • `persistedOverpass()` returns stale cache (up to STALE_MAX_AGE) when
//     live Overpass fails, so an ops incident during a mirror brownout
//     still sees the river network the IC saw five minutes ago rather
//     than a hard error.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const CACHE_PATH = process.env.OVERPASS_CACHE_PATH || path.join(DATA_DIR, 'overpass-cache.db');

const db = new Database(CACHE_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS overpass_cache (
    cache_key   TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_overpass_cache_created
    ON overpass_cache(created_at);
`);

const TILE_DEG = 0.01; // 0.01° → ~1.1 km lat, ~0.65 km lon at UK latitudes.
const STALE_MAX_AGE_MS = 24 * 3600_000; // fall back to cache ≤24h old on Overpass failure.
const GC_INTERVAL_MS = 60 * 60_000;     // hourly cleanup.
const GC_MAX_AGE_MS = 7 * 24 * 3600_000; // drop anything older than 7 days.

// Snap a bbox [s,w,n,e] outward to the enclosing 0.01° tile grid. Return the
// tiled bbox — caller uses this both as cache key AND as the Overpass query
// bbox. Small jiggle in user bbox → same tile → cache hit.
function tileBbox(bbox) {
  const [s, w, n, e] = bbox.map(Number);
  if (![s, w, n, e].every(Number.isFinite)) {
    throw new Error('tileBbox: bbox must be four finite numbers');
  }
  const floor = (v) => Math.floor(v / TILE_DEG) * TILE_DEG;
  const ceil  = (v) => Math.ceil(v / TILE_DEG) * TILE_DEG;
  // Round to 2dp to avoid 0.01 + 0.02 = 0.030000000000000002 cache-key noise.
  return [floor(s), floor(w), ceil(n), ceil(e)].map((v) => Number(v.toFixed(4)));
}

// Build a cache key from a namespace + tiled bbox. Namespace lets us keep
// river / hazards / terrain queries on the same bbox independently cached.
function bboxKey(ns, tiledBbox) {
  return `${ns}|${tiledBbox.join(',')}`;
}

const SELECT = db.prepare(
  'SELECT payload, expires_at, created_at FROM overpass_cache WHERE cache_key = ?'
);
const UPSERT = db.prepare(
  'INSERT OR REPLACE INTO overpass_cache (cache_key, payload, expires_at, created_at) VALUES (?, ?, ?, ?)'
);

function getEntry(key) {
  const row = SELECT.get(key);
  if (!row) return null;
  try {
    return {
      value: JSON.parse(row.payload),
      expires_at: row.expires_at,
      created_at: row.created_at,
      fresh: row.expires_at > Date.now(),
    };
  } catch {
    return null;
  }
}

function setEntry(key, value, ttlMs) {
  const now = Date.now();
  UPSERT.run(key, JSON.stringify(value), now + ttlMs, now);
}

// Small in-memory counter so ops can see at a glance whether the cache is
// earning its keep. Reset on process restart — for long-term analytics we'd
// ship to prism, but for "is the 429 storm being absorbed?" this is enough.
const stats = {
  started_at: Date.now(),
  by_source: { cache: 0, live: 0, stale: 0, error: 0 },
  by_namespace: {}, // ns → { cache, live, stale, error }
  latency_live_ms: [], // rolling sample of most recent 100 live calls
  latency_cache_ms: [], // rolling sample of most recent 100 cache/stale hits
};

function bumpNs(ns, outcome) {
  const row = stats.by_namespace[ns] || (stats.by_namespace[ns] = { cache: 0, live: 0, stale: 0, error: 0 });
  row[outcome] = (row[outcome] || 0) + 1;
  stats.by_source[outcome] = (stats.by_source[outcome] || 0) + 1;
}
function recordLatency(source, ms) {
  const arr = source === 'live' ? stats.latency_live_ms : stats.latency_cache_ms;
  arr.push(ms);
  if (arr.length > 100) arr.shift();
}

// Wraps an Overpass call with persistent cache + stale-if-error.
// - overpassFn: async fn that does the actual network call.
// - opts.key: full cache key (use bboxKey()).
// - opts.ns: short tag for stats bucketing (e.g. 'riv:w'). Optional.
// - opts.ttlMs: how long a success stays fresh.
// - opts.query: the Overpass query string.
// - opts.timeoutMs: per-call Overpass timeout.
//
// Return shape: { value, source, elapsed_ms }
//   source ∈ { 'cache', 'live', 'stale' }
// If source is 'stale' the `error` field contains the live-fetch error.
async function persistedOverpass(overpassFn, { key, ns, ttlMs, query, timeoutMs }) {
  const tag = ns || key.split('|')[0] || 'unknown';
  const t0 = Date.now();
  const existing = getEntry(key);
  if (existing?.fresh) {
    const elapsed = Date.now() - t0;
    bumpNs(tag, 'cache'); recordLatency('cache', elapsed);
    return { value: existing.value, source: 'cache', elapsed_ms: elapsed };
  }
  try {
    const value = await overpassFn(query, timeoutMs);
    setEntry(key, value, ttlMs);
    const elapsed = Date.now() - t0;
    bumpNs(tag, 'live'); recordLatency('live', elapsed);
    return { value, source: 'live', elapsed_ms: elapsed };
  } catch (err) {
    if (existing && Date.now() - existing.created_at < STALE_MAX_AGE_MS) {
      const elapsed = Date.now() - t0;
      bumpNs(tag, 'stale'); recordLatency('cache', elapsed);
      return { value: existing.value, source: 'stale', error: err.message, elapsed_ms: elapsed };
    }
    bumpNs(tag, 'error');
    throw err;
  }
}

function pct(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
function getStats() {
  const s = stats.by_source;
  const total = s.cache + s.live + s.stale + s.error;
  const cache_hit_ratio = total > 0 ? (s.cache + s.stale) / total : null;
  return {
    uptime_s: Math.floor((Date.now() - stats.started_at) / 1000),
    total_requests: total,
    cache_hit_ratio,
    by_source: { ...stats.by_source },
    by_namespace: JSON.parse(JSON.stringify(stats.by_namespace)),
    latency_live: { p50: pct(stats.latency_live_ms, 0.5), p95: pct(stats.latency_live_ms, 0.95), n: stats.latency_live_ms.length },
    latency_cache: { p50: pct(stats.latency_cache_ms, 0.5), p95: pct(stats.latency_cache_ms, 0.95), n: stats.latency_cache_ms.length },
  };
}

// Periodic cleanup — cheap, fire-and-forget.
const GC = db.prepare('DELETE FROM overpass_cache WHERE created_at < ?');
const gcTimer = setInterval(() => {
  try { GC.run(Date.now() - GC_MAX_AGE_MS); } catch { /* ignore */ }
}, GC_INTERVAL_MS);
if (typeof gcTimer.unref === 'function') gcTimer.unref();

module.exports = { tileBbox, bboxKey, getEntry, setEntry, persistedOverpass, getStats, TILE_DEG };
