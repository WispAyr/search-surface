// Service worker for search-surface field-team view.
// Scoped to /field/ via explicit register-time scope — ops console unaffected.
//
// Strategy:
//   - /field/* navigations    → network-first, fall back to cached shell
//   - /_next/static/*         → cache-first (immutable build assets)
//   - OSM / ARCGIS tiles      → stale-while-revalidate (rolling LRU)
//   - /api/*                  → bypass (app-layer offline queue owns it)

const VERSION = 'search-field-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const TILE_CACHE = `${VERSION}-tiles`;
const TILE_CACHE_LIMIT = 400; // ~20 MB of 256px PNG tiles

// Precache only the minimum — the rest is populated on navigation.
const SHELL_URLS = ['/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Rolling LRU for tile cache — delete oldest when over limit.
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  const excess = keys.length - limit;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

function isTile(url) {
  const h = url.hostname;
  return h.includes('tile.openstreetmap') || h.includes('basemaps.cartocdn') ||
         h.includes('server.arcgisonline') || h.endsWith('.arcgis.com') ||
         h.includes('tile.thunderforest');
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchAndStore = fetch(req).then((res) => {
    if (res && res.status === 200) {
      cache.put(req, res.clone());
      if (cacheName === TILE_CACHE) trimCache(TILE_CACHE, TILE_CACHE_LIMIT);
    }
    return res;
  }).catch(() => cached);
  return cached || fetchAndStore;
}

async function networkFirstShell(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last resort: any previously cached /field/ page as a shell.
    const keys = await cache.keys();
    for (const k of keys) {
      if (new URL(k.url).pathname.startsWith('/field/')) return cache.match(k);
    }
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font:14px system-ui;padding:2rem;background:#0b0f14;color:#e5e7eb"><h1>Offline</h1><p>Open the field link while online once — it will work offline after that.</p></body>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function cacheFirstStatic(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.status === 200) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API passes through — app-layer queue owns writes and reads.
  if (url.pathname.startsWith('/api/')) return;

  // Only intercept /field/* pages + shared statics/tiles.
  const isFieldNav = request.mode === 'navigate' && url.pathname.startsWith('/field/');
  const isStatic = url.pathname.startsWith('/_next/static/') || url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/icon');
  const tile = url.origin !== self.location.origin && isTile(url);

  if (isFieldNav) event.respondWith(networkFirstShell(request));
  else if (isStatic) event.respondWith(cacheFirstStatic(request));
  else if (tile) event.respondWith(staleWhileRevalidate(request, TILE_CACHE));
});

// Allow the app to trigger an immediate drain when online comes back and the SW
// is what saw the online event first (belt-and-braces; the page handles it too).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
