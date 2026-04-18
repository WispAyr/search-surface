// ── Search-and-Rescue helper endpoints ──
// Geocoding (Nominatim), OSM street/hazard extraction (Overpass),
// Lost Person Behaviour stats, travel-mode isochrones, static UK airspace.

const express = require('express');
const axios = require('axios');
const { tileBbox, bboxKey, persistedOverpass } = require('./overpass-cache');
const router = express.Router();

const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
// Primary + mirrors. We race them so a 504 on one doesn't sink the request.
const OVERPASS_ENDPOINTS = (process.env.OVERPASS_URLS
  ? process.env.OVERPASS_URLS.split(',')
  : [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ]
).map(s => s.trim()).filter(Boolean);
const OVERPASS = OVERPASS_ENDPOINTS[0];

async function overpass(query, timeoutMs = 25000) {
  // Race all mirrors in parallel — whichever returns first wins. A sequential
  // fallback loop stacked wait times across slow mirrors and frequently
  // exceeded nginx's 60s proxy_read_timeout in dense urban polygons. With a
  // race, the total wait is ≤ timeoutMs regardless of how many mirrors hang.
  //
  // One automatic retry after 800ms: every couple of weeks the public Overpass
  // fleet hits a synchronised 504/429 window and all three mirrors fail inside
  // the same second. A single short backoff catches that transient without
  // materially extending the p99 wait (the retry still races all mirrors).
  if (!OVERPASS_ENDPOINTS.length) throw new Error('no overpass endpoints configured');
  const body = `data=${encodeURIComponent(query)}`;
  const hdrs = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA };
  const raceOnce = () => {
    const attempts = OVERPASS_ENDPOINTS.map((url) =>
      axios.post(url, body, { headers: hdrs, timeout: timeoutMs, validateStatus: s => s >= 200 && s < 300 })
        .then((r) => r.data)
    );
    return Promise.any(attempts);
  };
  try {
    return await raceOnce();
  } catch (e1) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      return await raceOnce();
    } catch (e2) {
      const errs = (e2?.errors || []).map((x) => x?.message || String(x)).join('; ');
      throw new Error(`all overpass mirrors failed after retry: ${errs || 'unknown'}`);
    }
  }
}
const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const UA = 'wispayr-search/1.0 (ops@wispayr.online)';

// Tiny in-memory cache — avoid hammering public APIs.
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  return fn().then((v) => { cache.set(key, { value: v, expires: Date.now() + ttlMs }); return v; });
}

// ── Lost Person Behaviour profiles (ISRID-derived, distance from IPP in km) ──
// Rings are 25%, 50%, 75%, 95% containment.
const LPB_PROFILES = {
  dementia:        { label: 'Dementia / Alzheimer\'s',     rings_km: [0.3, 0.9, 2.0, 7.9],   water_risk: 0.31, notes: 'Travels in straight line until obstructed. High water-feature mortality — check rivers, ditches first.' },
  child_1_3:       { label: 'Child 1–3 yrs',                rings_km: [0.1, 0.3, 0.7, 2.1],   water_risk: 0.15, notes: 'Stays near IPP. Oriented to play areas, will hide when scared.' },
  child_4_6:       { label: 'Child 4–6 yrs',                rings_km: [0.2, 0.5, 1.6, 3.2],   water_risk: 0.10, notes: 'Will purposefully travel. Seeks out familiar places.' },
  child_7_9:       { label: 'Child 7–9 yrs',                rings_km: [0.3, 1.0, 2.1, 4.8],   water_risk: 0.08, notes: 'More mobile, may follow trails/roads.' },
  child_10_12:     { label: 'Child 10–12 yrs',              rings_km: [0.5, 1.6, 3.5, 7.0],   water_risk: 0.06, notes: 'Mobile like an adult, may have intent/destination.' },
  child_13_15:     { label: 'Youth 13–15 yrs',              rings_km: [0.8, 2.5, 5.5, 12.0],  water_risk: 0.05, notes: 'Often despondent or intentional, check social contacts.' },
  hiker:           { label: 'Hiker',                        rings_km: [1.0, 3.2, 6.1, 12.9],  water_risk: 0.04, notes: 'Tends to stay on trail network, may be injured.' },
  despondent:      { label: 'Despondent / Suicidal',        rings_km: [0.3, 1.0, 3.2, 9.9],   water_risk: 0.18, notes: 'Seeks isolation, often high ground or water. Check vehicle for note.' },
  mental_illness:  { label: 'Mental illness',               rings_km: [0.5, 1.9, 4.0, 9.6],   water_risk: 0.12, notes: 'Behaviour unpredictable; may be in public areas.' },
  substance_abuse: { label: 'Substance abuse',              rings_km: [0.5, 1.6, 3.9, 9.3],   water_risk: 0.10, notes: 'Will often be found asleep/unconscious.' },
  autism:          { label: 'Autism spectrum',              rings_km: [0.4, 1.2, 2.8, 8.0],   water_risk: 0.40, notes: 'STRONG water attraction. Check all water features first, even at distance.' },
  dog:             { label: 'Missing dog',                  rings_km: [0.2, 0.8, 2.0, 5.0],   water_risk: 0.05, notes: 'Often returns to familiar routes. Ask neighbours; check parks/woods. Smaller dogs ≤ 1 km typically.' },
  cat:             { label: 'Missing cat',                  rings_km: [0.05, 0.15, 0.3, 0.5], water_risk: 0.02, notes: 'Cats rarely go far — 90% within 500m, hiding in sheds/garages/gardens.' },
};

router.get('/profiles', (req, res) => {
  res.json({ profiles: LPB_PROFILES });
});

// ── Geocode (forward) ──
router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const key = `geocode:${q}`;
    const data = await cached(key, 5 * 60_000, async () => {
      const r = await axios.get(`${NOMINATIM}/search`, {
        params: { q, format: 'json', limit: 8, countrycodes: 'gb', addressdetails: 1 },
        headers: { 'User-Agent': UA },
        timeout: 8000,
      });
      return r.data;
    });
    res.json({ results: (data || []).map((x) => ({
      lat: parseFloat(x.lat),
      lon: parseFloat(x.lon),
      display_name: x.display_name,
      type: x.type,
      class: x.class,
      importance: x.importance,
      boundingbox: x.boundingbox,
    })) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Reverse geocode ──
router.get('/reverse', async (req, res) => {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  try {
    const key = `rev:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const data = await cached(key, 10 * 60_000, async () => {
      const r = await axios.get(`${NOMINATIM}/reverse`, {
        params: { lat, lon, format: 'json', addressdetails: 1, zoom: 18 },
        headers: { 'User-Agent': UA },
        timeout: 8000,
      });
      return r.data;
    });
    res.json({
      display_name: data.display_name,
      address: data.address,
      postcode: data.address?.postcode,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Streets within a polygon (for door-knock sheet) ──
// body: { polygon: [[lat,lon], ...] } OR { bbox: [s,w,n,e] }
router.post('/osm/streets', async (req, res) => {
  const { polygon, bbox } = req.body || {};
  try {
    let area;
    if (polygon && Array.isArray(polygon) && polygon.length >= 3) {
      const poly = polygon.map(([la, lo]) => `${la} ${lo}`).join(' ');
      area = `(poly:"${poly}")`;
    } else if (bbox && bbox.length === 4) {
      area = `(${bbox.join(',')})`;
    } else {
      return res.status(400).json({ error: 'polygon or bbox required' });
    }
    const query = `[out:json][timeout:25];
      way["highway"]["name"]${area};
      out tags;`;
    const key = `streets:${Buffer.from(query).toString('base64').slice(0, 48)}`;
    const data = await cached(key, 10 * 60_000, () => overpass(query, 30_000));
    const names = new Map();
    for (const el of data.elements || []) {
      const n = el.tags?.name;
      if (!n) continue;
      const entry = names.get(n) || { name: n, count: 0, highway: el.tags?.highway };
      entry.count += 1;
      names.set(n, entry);
    }
    const streets = [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
    res.json({ streets, total: streets.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Hazards / attractors from OSM within bbox ──
// Returns hazards (water, cliffs, railway, quarries) + attractors (shelter, benches, play, shops)
router.post('/osm/features', async (req, res) => {
  const { bbox } = req.body || {};
  if (!bbox || bbox.length !== 4) return res.status(400).json({ error: 'bbox [s,w,n,e] required' });
  const rawBbox = bbox.map(Number);
  if (!rawBbox.every(Number.isFinite)) return res.status(400).json({ error: 'bbox must be numbers' });
  const [rs, rw, rn, re] = rawBbox;
  // Cap area: Overpass returns timeouts fast on big bboxes.
  if ((rn - rs) * (re - rw) > 0.2) return res.status(400).json({ error: 'bbox too large (>0.2 sq deg)' });
  // Tile outward so cache keys cluster and small pans reuse results.
  const tiled = tileBbox(rawBbox);
  const [s, w, n, e] = tiled;
  const a = `(${s},${w},${n},${e})`;

  // Split into two smaller queries so one timeout doesn't sink the other.
  // Dropped: natural=water (too many polygons in urban areas), shop=* (too many nodes).
  const hazardsQ = `[out:json][timeout:20];
    (
      way["waterway"~"river|stream|canal"]${a};
      way["natural"="cliff"]${a};
      way["railway"="rail"]${a};
      way["landuse"="quarry"]${a};
      way["man_made"="mineshaft"]${a};
    );
    out center tags 400;`;
  const attractorsQ = `[out:json][timeout:20];
    (
      node["amenity"~"shelter|bus_station|cafe|pub|restaurant|fast_food"]${a};
      node["leisure"~"playground|park"]${a};
      way["leisure"~"park|nature_reserve"]${a};
    );
    out center tags 400;`;

  const classify = (el) => {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon) return null;
    const name = t.name || '';
    if (/river|stream|canal/.test(t.waterway || '')) return { kind: 'water', name, lat, lon, _cat: 'hazard' };
    if (t.natural === 'cliff') return { kind: 'cliff', name, lat, lon, _cat: 'hazard' };
    if (t.railway === 'rail') return { kind: 'railway', name, lat, lon, _cat: 'hazard' };
    if (t.landuse === 'quarry') return { kind: 'quarry', name, lat, lon, _cat: 'hazard' };
    if (t.man_made === 'mineshaft') return { kind: 'mineshaft', name, lat, lon, _cat: 'hazard' };
    if (/shelter|bus_station/.test(t.amenity || '')) return { kind: t.amenity, name, lat, lon, _cat: 'attractor' };
    if (/cafe|pub|restaurant|fast_food/.test(t.amenity || '')) return { kind: t.amenity, name, lat, lon, _cat: 'attractor' };
    if (/playground|park|nature_reserve/.test(t.leisure || '')) return { kind: t.leisure, name, lat, lon, _cat: 'attractor' };
    return null;
  };

  const settle = async (ns, q) => {
    try {
      const r = await persistedOverpass(overpass, {
        key: bboxKey(ns, tiled),
        ttlMs: 30 * 60_000,
        query: q,
        timeoutMs: 25_000,
      });
      return r.source === 'stale'
        ? { ...r.value, _stale: true, _staleError: r.error }
        : r.value;
    } catch (e) { return { _error: e.message, elements: [] }; }
  };
  const [hz, at] = await Promise.all([
    settle('feat:hz', hazardsQ),
    settle('feat:at', attractorsQ),
  ]);
  const hazards = [], attractors = [];
  for (const el of hz.elements || []) { const c = classify(el); if (c?._cat === 'hazard') { delete c._cat; hazards.push(c); } }
  for (const el of at.elements || []) { const c = classify(el); if (c?._cat === 'attractor') { delete c._cat; attractors.push(c); } }
  const errors = [hz._error, at._error].filter(Boolean);
  const stale = Boolean(hz._stale || at._stale);
  res.json({ hazards, attractors, partial: errors.length > 0, errors, stale });
});

// ── Terrain polygons for smart-grid classification ──
// Returns raw OSM polygons (land/water/intertidal hints) within a bbox so the
// client can classify each grid cell locally without shipping all of Overpass
// to the browser. Callers compute per-cell {land_pct, water_pct, intertidal_pct}
// via turf; we just do the Overpass hop + long TTL cache.
//
// Response shape: { water: GeoJSON.FeatureCollection, coastline: FC, rivers: FC,
//                   intertidal: FC, bbox, partial, errors }
// - `water` is closed polygons tagged natural=water | waterway=riverbank
//   | landuse=reservoir.
// - `coastline` is linear ways tagged natural=coastline (client buffers 100m
//   inland to approximate the wet zone).
// - `rivers` is linear ways (waterway=river|stream|canal) for buffered strips.
// - `intertidal` is natural=beach | natural=shoal | wetland=tidalflat polygons.
router.post('/osm/terrain', async (req, res) => {
  const { bbox } = req.body || {};
  if (!bbox || bbox.length !== 4) return res.status(400).json({ error: 'bbox [s,w,n,e] required' });
  const rawBbox = bbox.map(Number);
  if (!rawBbox.every(Number.isFinite)) return res.status(400).json({ error: 'bbox must be numbers' });
  const [rs, rw, rn, re] = rawBbox;
  // Cap area — same guard as /osm/features, bigger bboxes time out on Overpass.
  if ((rn - rs) * (re - rw) > 0.2) return res.status(400).json({ error: 'bbox too large (>0.2 sq deg)' });
  const tiled = tileBbox(rawBbox);
  const [s, w, n, e] = tiled;
  const a = `(${s},${w},${n},${e})`;

  // Split into three smaller queries so one timeout doesn't poison the other
  // two — partial results are more useful than none. Each clocks in well under
  // the Overpass 25s server-side timeout.
  const waterQ = `[out:json][timeout:25];
    (
      way["natural"="water"]${a};
      way["waterway"="riverbank"]${a};
      way["landuse"="reservoir"]${a};
      way["landuse"="basin"]${a};
      relation["natural"="water"]${a};
    );
    out geom 400;`;
  const coastRiverQ = `[out:json][timeout:25];
    (
      way["natural"="coastline"]${a};
      way["waterway"~"^(river|stream|canal|drain|ditch)$"]${a};
    );
    out geom 600;`;
  const intertidalQ = `[out:json][timeout:25];
    (
      way["natural"="beach"]${a};
      way["natural"="shoal"]${a};
      way["wetland"="tidalflat"]${a};
      way["natural"="wetland"]${a};
    );
    out geom 200;`;

  const settle = async (ns, q) => {
    try {
      const r = await persistedOverpass(overpass, {
        key: bboxKey(ns, tiled),
        ttlMs: 30 * 60_000,
        query: q,
        timeoutMs: 25_000,
      });
      return r.source === 'stale'
        ? { ...r.value, _stale: true, _staleError: r.error }
        : r.value;
    } catch (err) { return { _error: err.message, elements: [] }; }
  };
  const [wr, cr, it] = await Promise.all([
    settle('terr:w', waterQ),
    settle('terr:c', coastRiverQ),
    settle('terr:i', intertidalQ),
  ]);

  // Convert Overpass "out geom" results → GeoJSON features. Overpass emits
  // { type:'way', geometry:[{lat,lon},...] } for closed ways and the same for
  // open ways (LineString). Relations with geom give per-member geometry too.
  function elToFeature(el, tagsByClass) {
    const tags = el.tags || {};
    const klass = tagsByClass(tags);
    if (!klass) return null;
    const props = { klass, name: tags.name || null };
    if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
      const coords = el.geometry.map((p) => [p.lon, p.lat]);
      // Closed ring → Polygon; open → LineString.
      const first = coords[0], last = coords[coords.length - 1];
      const closed = coords.length >= 4 && first[0] === last[0] && first[1] === last[1];
      return closed
        ? { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [coords] } }
        : { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } };
    }
    if (el.type === 'relation' && Array.isArray(el.members)) {
      // Build a MultiPolygon from outer rings only (inner holes are rare and
      // not critical for coarse classification).
      const rings = el.members
        .filter((m) => m.role === 'outer' && Array.isArray(m.geometry) && m.geometry.length >= 4)
        .map((m) => m.geometry.map((p) => [p.lon, p.lat]))
        .filter((r) => {
          const a = r[0], b = r[r.length - 1];
          return a[0] === b[0] && a[1] === b[1];
        });
      if (!rings.length) return null;
      return {
        type: 'Feature', properties: props,
        geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) },
      };
    }
    return null;
  }

  const waterFC = { type: 'FeatureCollection', features: [] };
  const coastFC = { type: 'FeatureCollection', features: [] };
  const riverFC = { type: 'FeatureCollection', features: [] };
  const intertidalFC = { type: 'FeatureCollection', features: [] };

  for (const el of wr.elements || []) {
    const f = elToFeature(el, (t) => {
      if (t.natural === 'water') return 'water';
      if (t.waterway === 'riverbank') return 'water';
      if (t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
      return null;
    });
    if (f) waterFC.features.push(f);
  }
  for (const el of cr.elements || []) {
    const f = elToFeature(el, (t) => {
      if (t.natural === 'coastline') return 'coastline';
      if (t.waterway && /^(river|stream|canal|drain|ditch)$/.test(t.waterway)) return t.waterway;
      return null;
    });
    if (!f) continue;
    if (f.properties.klass === 'coastline') coastFC.features.push(f);
    else riverFC.features.push(f);
  }
  for (const el of it.elements || []) {
    const f = elToFeature(el, (t) => {
      if (t.natural === 'beach') return 'beach';
      if (t.natural === 'shoal') return 'shoal';
      if (t.wetland === 'tidalflat') return 'tidalflat';
      if (t.natural === 'wetland') return 'wetland';
      return null;
    });
    if (f) intertidalFC.features.push(f);
  }

  const errors = [wr._error, cr._error, it._error].filter(Boolean);
  const stale = Boolean(wr._stale || cr._stale || it._stale);
  res.json({
    bbox: [s, w, n, e],
    water: waterFC,
    coastline: coastFC,
    rivers: riverFC,
    intertidal: intertidalFC,
    counts: {
      water: waterFC.features.length,
      coastline: coastFC.features.length,
      rivers: riverFC.features.length,
      intertidal: intertidalFC.features.length,
    },
    partial: errors.length > 0,
    errors,
    stale,
  });
});

// ── Smart-grid Tier B1 — River network + collection points ──
//
// Powers the "river corridor (drift)" grid type. Returns:
//  - rivers: FeatureCollection of LineStrings (waterway=river|stream|canal|drain)
//    with enough tag detail on each to derive drawn direction + classification.
//  - collectionPoints: FeatureCollection of Points where floating bodies tend
//    to hang up — weirs, dams, bridge crossings, sluices. These become
//    priority-1 zones in the UI.
//
// Same mirror-race + long-TTL cache as /osm/terrain. Capped at 0.2 sq-deg
// bbox — a river search corridor fits comfortably in that envelope (~25km
// downstream from LKP at Ayrshire latitudes).
router.post('/osm/rivers', async (req, res) => {
  const { bbox } = req.body || {};
  if (!bbox || bbox.length !== 4) return res.status(400).json({ error: 'bbox [s,w,n,e] required' });
  const rawBbox = bbox.map(Number);
  if (!rawBbox.every(Number.isFinite)) return res.status(400).json({ error: 'bbox must be numbers' });
  const [rs, rw, rn, re] = rawBbox;
  if ((rn - rs) * (re - rw) > 0.2) return res.status(400).json({ error: 'bbox too large (>0.2 sq deg)' });
  const tiled = tileBbox(rawBbox);
  const [s, w, n, e] = tiled;
  const a = `(${s},${w},${n},${e})`;

  // Linear waterways — drawn from upstream → downstream by OSM convention but
  // not guaranteed. We preserve raw node order so the client can fall back to
  // a DEM elevation check later if needed.
  const waterwayQ = `[out:json][timeout:25];
    (
      way["waterway"~"^(river|stream|canal|drain)$"]${a};
    );
    out geom 400;`;

  // Collection points — a grab-bag of features that snag floating bodies.
  // Deliberately over-inclusive; the UI filters to those within the corridor.
  const collectionQ = `[out:json][timeout:25];
    (
      node["waterway"="weir"]${a};
      way["waterway"="weir"]${a};
      node["waterway"="dam"]${a};
      way["waterway"="dam"]${a};
      node["waterway"="lock_gate"]${a};
      way["waterway"="lock_gate"]${a};
      node["waterway"="sluice_gate"]${a};
      node["waterway"="waterfall"]${a};
      way["man_made"="pier"]${a};
      way["bridge"="yes"]["highway"]${a};
      way["man_made"="bridge"]${a};
    );
    out geom 300;`;

  const settle = async (ns, q) => {
    try {
      const r = await persistedOverpass(overpass, {
        key: bboxKey(ns, tiled),
        ttlMs: 30 * 60_000,
        query: q,
        timeoutMs: 25_000,
      });
      return r.source === 'stale'
        ? { ...r.value, _stale: true, _staleError: r.error }
        : r.value;
    } catch (err) { return { _error: err.message, elements: [] }; }
  };
  const [ww, cp] = await Promise.all([
    settle('riv:w', waterwayQ),
    settle('riv:c', collectionQ),
  ]);

  const riversFC = { type: 'FeatureCollection', features: [] };
  const collectionFC = { type: 'FeatureCollection', features: [] };

  for (const el of ww.elements || []) {
    const tags = el.tags || {};
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const coords = el.geometry.map((p) => [p.lon, p.lat]);
    riversFC.features.push({
      type: 'Feature',
      properties: {
        osm_id: el.id,
        waterway: tags.waterway || null,
        name: tags.name || null,
        // Default OSM widths when not tagged; client uses these for corridor
        // minimum-width floor. Numbers in metres — conservative.
        width_m: numericTag(tags.width) || null,
      },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  // Collection-point classifier — one label per feature so UI can pick an icon.
  const toCenterPoint = (el) => {
    if (el.type === 'node') {
      if (typeof el.lat === 'number' && typeof el.lon === 'number') return [el.lon, el.lat];
      return null;
    }
    // way → centroid of geometry array if present
    if (Array.isArray(el.geometry) && el.geometry.length > 0) {
      let sx = 0, sy = 0, n = 0;
      for (const p of el.geometry) {
        if (typeof p.lon === 'number' && typeof p.lat === 'number') { sx += p.lon; sy += p.lat; n++; }
      }
      if (n > 0) return [sx / n, sy / n];
    }
    return null;
  };
  const classify = (tags) => {
    if (tags.waterway === 'weir') return 'weir';
    if (tags.waterway === 'dam') return 'dam';
    if (tags.waterway === 'lock_gate') return 'lock';
    if (tags.waterway === 'sluice_gate') return 'sluice';
    if (tags.waterway === 'waterfall') return 'waterfall';
    if (tags.man_made === 'pier') return 'pier';
    if (tags.man_made === 'bridge' || tags.bridge === 'yes') return 'bridge';
    return 'other';
  };
  for (const el of cp.elements || []) {
    const tags = el.tags || {};
    const pt = toCenterPoint(el);
    if (!pt) continue;
    const kind = classify(tags);
    if (kind === 'other') continue;
    collectionFC.features.push({
      type: 'Feature',
      properties: {
        osm_id: el.id,
        kind,
        name: tags.name || null,
      },
      geometry: { type: 'Point', coordinates: pt },
    });
  }

  const errors = [ww._error, cp._error].filter(Boolean);
  const stale = Boolean(ww._stale || cp._stale);
  res.json({
    bbox: [s, w, n, e],
    rivers: riversFC,
    collection_points: collectionFC,
    counts: {
      rivers: riversFC.features.length,
      collection_points: collectionFC.features.length,
    },
    partial: errors.length > 0,
    errors,
    stale,
  });
});

// Parse an OSM "width" tag — values vary wildly ("20", "20 m", "approximate").
// Returns a positive number in metres or null.
function numericTag(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  const s = String(v).trim();
  const m = s.match(/^([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Vehicle route through a polygon (OSRM trip) ──
// body: { waypoints: [[lat,lon], ...] }   (must already be sampled — we keep backend dumb)
router.post('/route/vehicle', async (req, res) => {
  const { waypoints } = req.body || {};
  if (!Array.isArray(waypoints) || waypoints.length < 2) return res.status(400).json({ error: 'waypoints[] required (>=2)' });
  // Public OSRM trip-API scales poorly with waypoint count and the quality
  // ceiling hits around 10-12 anyway. Clamp to 12 + dedupe near-identical
  // coords so client-side polygon sampling can't accidentally request 20
  // waypoints that boil down to the same street corner twice.
  try {
    const pts = dedupeWaypoints(waypoints).slice(0, 12);
    if (pts.length < 2) return res.status(400).json({ error: 'need >=2 distinct waypoints after dedupe' });
    const coords = pts.map(([la, lo]) => `${lo},${la}`).join(';');
    // overview=simplified is ~10-30x smaller than full and just as usable for
    // the "show me the route" map overlay. steps=false skips turn-by-turn.
    const url = `${OSRM}/trip/v1/driving/${coords}?source=first&roundtrip=true&overview=simplified&geometries=geojson&steps=false`;
    const r = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': UA } });
    const trip = r.data.trips?.[0];
    if (!trip) return res.status(502).json({ error: 'no trip found' });
    res.json({
      geometry: trip.geometry,
      distance_m: trip.distance,
      duration_s: trip.duration,
      waypoints: r.data.waypoints,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Waypoints closer than ~30m (0.00028°) are treated as duplicates — OSRM
// routes the same street segment either way and the extra node just slows
// the trip solver.
function dedupeWaypoints(pts) {
  const out = [];
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 2) continue;
    const [la, lo] = p;
    if (!isFinite(la) || !isFinite(lo)) continue;
    const near = out.some(([pla, plo]) => Math.abs(pla - la) < 0.00028 && Math.abs(plo - lo) < 0.00028);
    if (!near) out.push([la, lo]);
  }
  return out;
}

// ── Smart-grid Tier B2 — tide forecast (Open-Meteo Marine) ──
//
// Free, no-key API; hourly sea_level_height_msl for up to 7 days forward. We
// proxy rather than letting the browser hit Open-Meteo directly so we can
// cache (30 min TTL is plenty — tide predictions change by seconds per day,
// not minutes) and avoid baking their URL into the client. Also dodges CORS
// preflights.
//
// Why not go through siphon? Siphon has an `open_meteo_marine` source but
// it's a configured-per-location fetcher, not a lat/lon endpoint. The search
// UI needs ad-hoc forecasts for whatever AOI the operator has loaded, which
// is exactly the pattern the existing /osm/terrain + /osm/rivers endpoints
// already follow: fetch-on-demand, cache briefly, no siphon round-trip.
router.get('/tide', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat, lon required' });
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'lat/lon out of range' });
  }
  // Round to 2 dp so the cache keys hit for nearby cells in the same AOI —
  // tide prediction resolution is ~km, not metres.
  const latR = lat.toFixed(2);
  const lonR = lon.toFixed(2);
  const key = `tide:${latR},${lonR}`;
  try {
    const data = await cached(key, 30 * 60_000, async () => {
      const url = `https://marine-api.open-meteo.com/v1/marine`
        + `?latitude=${latR}&longitude=${lonR}`
        + `&hourly=sea_level_height_msl`
        + `&timezone=UTC&forecast_days=3&past_days=1`;
      const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': UA } });
      const h = r.data?.hourly || {};
      const times = Array.isArray(h.time) ? h.time : [];
      const heights = Array.isArray(h.sea_level_height_msl) ? h.sea_level_height_msl : [];
      // Zip into point array; drop any null samples (Open-Meteo can gap).
      const points = [];
      for (let i = 0; i < times.length; i++) {
        const hM = heights[i];
        if (hM == null || !Number.isFinite(hM)) continue;
        points.push({ t: `${times[i]}Z`, h_m: Number(hM) });
      }
      return {
        lat: Number(latR), lon: Number(lonR),
        source: 'open-meteo marine',
        fetched_at: new Date().toISOString(),
        points,
      };
    });
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: `tide: ${err.message}` });
  }
});

// ── Smart-grid Tier B3 — river gauges (SEPA KiWIS + EA flood-monitoring) ──
//
// Tier B1's river-corridor generator takes a surface velocity as input (operator
// picks from a preset). B3 lets that velocity be *observed* instead of *guessed*:
// fetch the nearest live gauge reading for the LKP's catchment and surface its
// stage + trend + a suggested m/s so the corridor reflects real conditions.
//
// Two sources, merged:
//   - SEPA KiWIS (Scotland) — the primary source for Ayrshire/Clyde ops. The
//     station list is ~1 MB of JSON, cached 24h because metadata doesn't move.
//     Per-station `15minute` series is cached 10 min per station to keep volley
//     counts sane when multiple operators re-open the same AOI.
//   - EA flood-monitoring (England/Wales) — picks up stations south of the
//     border, used when an op crosses into Cumbria/Northumbria.
//
// Partial=true is set when either side fails so a SEPA outage doesn't block
// ops that could still be served by EA gauges (and vice versa).
const SEPA_KIWIS = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS';
const EA_FLOOD = 'https://environment.data.gov.uk/flood-monitoring';

// Haversine in metres. Used to rank stations by distance to bbox centre so we
// only fetch readings for the N closest (SEPA caps aside, a bbox can hold 40+
// stations and we don't want 40 sequential reading fetches).
function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6_371_000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat);
  const dLon = toR(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Trend from a series of {time, stage_m}. Compares the mean of the *latest* ~1h
// against the mean of the *earliest* ~1h of the supplied window. Threshold is
// 5 cm — anything smaller is steady-state noise on a typical SEPA gauge.
function computeTrend(series) {
  const rows = series.filter((r) => r.stage_m != null);
  if (rows.length < 4) return 'unknown';
  const head = rows.slice(0, Math.max(2, Math.floor(rows.length / 4)));
  const tail = rows.slice(-Math.max(2, Math.floor(rows.length / 4)));
  const mean = (xs) => xs.reduce((a, r) => a + r.stage_m, 0) / xs.length;
  const delta = mean(tail) - mean(head);
  if (Math.abs(delta) < 0.05) return 'steady';
  return delta > 0 ? 'rising' : 'falling';
}

async function fetchSepaStationList() {
  // Cached 24h — station locations don't move. ~1 MB payload so we trim to
  // just the fields we need before caching to keep memory footprint small.
  return cached('sepa:stations', 24 * 60 * 60_000, async () => {
    const url = `${SEPA_KIWIS}?service=kisters&type=queryServices&request=getStationList`
      + `&format=objson&parametertype_name=S`
      + `&returnfields=station_no,station_id,station_name,station_latitude,station_longitude`;
    const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA } });
    return (Array.isArray(r.data) ? r.data : [])
      .map((s) => ({
        station_id: String(s.station_id),
        station_no: String(s.station_no),
        station_name: String(s.station_name || '').trim(),
        lat: Number(s.station_latitude),
        lon: Number(s.station_longitude),
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  });
}

// Resolve a SEPA station_id to its `15minute` ts_id. Cached a full day because
// ts_ids are permanent once assigned. Some stations only have daily/monthly
// aggregates — those return null and the caller skips them.
async function sepaTsIdFor(stationId) {
  return cached(`sepa:ts:${stationId}`, 24 * 60 * 60_000, async () => {
    const url = `${SEPA_KIWIS}?service=kisters&type=queryServices&request=getTimeseriesList`
      + `&format=objson&station_id=${stationId}&parametertype_name=S`
      + `&returnfields=ts_id,ts_name`;
    const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': UA } });
    const list = Array.isArray(r.data) ? r.data : [];
    const live = list.find((t) => t.ts_name === '15minute');
    return live ? String(live.ts_id) : null;
  });
}

async function sepaLatestFor(stationId) {
  // One-stop: resolve ts_id, fetch last 6h of values, extract trend + latest.
  // Cached 10 min per station so repeat UI opens are cheap.
  return cached(`sepa:latest:${stationId}`, 10 * 60_000, async () => {
    const tsId = await sepaTsIdFor(stationId);
    if (!tsId) return { latest: null, series: [], trend: 'unknown' };
    const url = `${SEPA_KIWIS}?service=kisters&type=queryServices&request=getTimeseriesValues`
      + `&format=dajson&ts_id=${tsId}&period=PT6H`;
    const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': UA } });
    const row0 = Array.isArray(r.data) ? r.data[0] : null;
    const raw = row0 && Array.isArray(row0.data) ? row0.data : [];
    const series = raw
      .map(([t, v]) => ({ time: String(t), stage_m: v == null ? null : Number(v), flow_cumecs: null }))
      .filter((s) => s.stage_m != null && Number.isFinite(s.stage_m));
    const latest = series.length ? series[series.length - 1] : null;
    return { latest, series, trend: computeTrend(series) };
  });
}

async function fetchSepaGaugesInBbox(bbox, maxStations = 15) {
  const [s, w, n, e] = bbox;
  const stations = await fetchSepaStationList();
  const inBbox = stations.filter((x) => x.lat >= s && x.lat <= n && x.lon >= w && x.lon <= e);
  // Rank by distance to centre so we fetch readings for the closest ones.
  const cLat = (s + n) / 2;
  const cLon = (w + e) / 2;
  inBbox.sort((a, b) =>
    haversineM(cLat, cLon, a.lat, a.lon) - haversineM(cLat, cLon, b.lat, b.lon),
  );
  const picked = inBbox.slice(0, maxStations);
  // Parallel per-station reading fetch. Settle — one slow station shouldn't
  // drag the whole response.
  const readings = await Promise.allSettled(picked.map((st) => sepaLatestFor(st.station_id)));
  return picked.map((st, i) => {
    const r = readings[i];
    const v = r.status === 'fulfilled' ? r.value : { latest: null, series: [], trend: 'unknown' };
    return {
      id: `sepa:${st.station_id}`,
      label: st.station_name,
      lat: st.lat,
      lon: st.lon,
      source: 'SEPA',
      latest: v.latest,
      series: v.series,
      trend: v.trend,
      state: 'unknown', // rating-curve-free state classification is a later tier
    };
  });
}

async function fetchEaGaugesInBbox(bbox, maxStations = 15) {
  // EA doesn't support bbox directly — we query by centre+radius covering the
  // bbox corners, then filter client-side.
  const [s, w, n, e] = bbox;
  const cLat = (s + n) / 2;
  const cLon = (w + e) / 2;
  const distKm = haversineM(cLat, cLon, n, e) / 1000;
  const url = `${EA_FLOOD}/id/stations?parameter=level`
    + `&lat=${cLat.toFixed(4)}&long=${cLon.toFixed(4)}&dist=${Math.ceil(distKm)}&_limit=100`;
  return cached(`ea:gauges:${cLat.toFixed(3)},${cLon.toFixed(3)},${Math.ceil(distKm)}`, 10 * 60_000, async () => {
    const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': UA } });
    const items = Array.isArray(r.data?.items) ? r.data.items : [];
    const inBbox = items.filter((st) => {
      const lat = Number(st.lat), lon = Number(st.long);
      return Number.isFinite(lat) && Number.isFinite(lon) && lat >= s && lat <= n && lon >= w && lon <= e;
    });
    // Rank + trim
    inBbox.sort((a, b) =>
      haversineM(cLat, cLon, Number(a.lat), Number(a.long))
      - haversineM(cLat, cLon, Number(b.lat), Number(b.long)),
    );
    const picked = inBbox.slice(0, maxStations);
    // Fetch last 6h of readings per station in parallel.
    const readings = await Promise.allSettled(picked.map(async (st) => {
      const id = String(st.notation || st['@id']?.split('/').pop() || '');
      if (!id) return { latest: null, series: [], trend: 'unknown' };
      const readUrl = `${EA_FLOOD}/id/stations/${id}/readings?parameter=level&_sorted&_limit=24`;
      const rr = await axios.get(readUrl, { timeout: 10000, headers: { 'User-Agent': UA } });
      const rowsRaw = Array.isArray(rr.data?.items) ? rr.data.items : [];
      const series = rowsRaw
        .map((row) => ({ time: String(row.dateTime), stage_m: Number(row.value), flow_cumecs: null }))
        .filter((x) => Number.isFinite(x.stage_m))
        .reverse(); // API returns newest first
      const latest = series.length ? series[series.length - 1] : null;
      return { latest, series, trend: computeTrend(series) };
    }));
    return picked.map((st, i) => {
      const v = readings[i].status === 'fulfilled' ? readings[i].value : { latest: null, series: [], trend: 'unknown' };
      return {
        id: `ea:${st.notation || st.label}`,
        label: String(st.label || st.riverName || st.notation || 'EA gauge'),
        lat: Number(st.lat),
        lon: Number(st.long),
        source: 'EA',
        latest: v.latest,
        series: v.series,
        trend: v.trend,
        state: 'unknown',
      };
    });
  });
}

router.get('/gauges', async (req, res) => {
  const raw = String(req.query.bbox || '').split(',').map(Number);
  if (raw.length !== 4 || !raw.every(Number.isFinite)) {
    return res.status(400).json({ error: 'bbox=s,w,n,e required' });
  }
  const [s, w, n, e] = raw;
  if (s >= n || w >= e || (n - s) > 2 || (e - w) > 2) {
    return res.status(400).json({ error: 'bbox invalid or too large (max 2° per side)' });
  }
  const errors = [];
  let partial = false;
  const [sepa, ea] = await Promise.all([
    fetchSepaGaugesInBbox([s, w, n, e]).catch((err) => {
      errors.push(`sepa: ${err.message}`);
      partial = true;
      return [];
    }),
    fetchEaGaugesInBbox([s, w, n, e]).catch((err) => {
      errors.push(`ea: ${err.message}`);
      partial = true;
      return [];
    }),
  ]);
  res.json({
    gauges: [...sepa, ...ea],
    bbox: [s, w, n, e],
    generated_at: new Date().toISOString(),
    partial,
    errors,
  });
});

// ── Tenant-scoped SAR feature flags ──
// Stored in tenant_settings under key `search.tenant_prefs`. Owner-only writes,
// any authed tenant user can read so the Conditions panel knows which optional
// sections to render. Unknown keys are accepted but ignored on read so we can
// add flags without a schema migration.
const TENANT_PREFS_KEY = 'search.tenant_prefs';
const TENANT_PREFS_DEFAULTS = {
  show_river_gauge_in_conditions: false,
};
function coerceTenantPrefs(raw) {
  const out = { ...TENANT_PREFS_DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(TENANT_PREFS_DEFAULTS)) {
      if (typeof raw[k] === typeof TENANT_PREFS_DEFAULTS[k]) out[k] = raw[k];
    }
  }
  return out;
}

// Lazy-require so search-helpers stays importable in test harnesses that
// don't wire up auth. Real mounts happen after auth-db has initialised.
let _settingsModule = null;
function getSettings() {
  if (!_settingsModule) _settingsModule = require('./auth-db').settings;
  return _settingsModule;
}
let _tenantMiddleware = null;
function getTenantMiddleware() {
  if (!_tenantMiddleware) _tenantMiddleware = require('./tenant-middleware');
  return _tenantMiddleware;
}

router.get('/tenant-prefs', (req, res, next) => {
  const { requireTenant } = getTenantMiddleware();
  return requireTenant(req, res, () => {
    const stored = getSettings().getJson(req.tenant.id, TENANT_PREFS_KEY);
    res.json({ prefs: coerceTenantPrefs(stored) });
  });
});

router.put('/tenant-prefs', (req, res, next) => {
  const { requireTenant, requireRole } = getTenantMiddleware();
  return requireTenant(req, res, () => requireRole('owner')(req, res, () => {
    const merged = coerceTenantPrefs({
      ...(getSettings().getJson(req.tenant.id, TENANT_PREFS_KEY) || {}),
      ...(req.body || {}),
    });
    getSettings().setJson(req.tenant.id, TENANT_PREFS_KEY, merged);
    res.json({ prefs: merged });
  }));
});

// ── Static simplified UK airspace (fallback for siphon) ──
// Major CTRs/ATZs covering Scotland & NW England. Not flight-safety grade — ops awareness only.
const STATIC_AIRSPACE = require('./data/uk-airspace-static.json');
router.get('/airspace', (req, res) => {
  res.json(STATIC_AIRSPACE);
});

// ── Internal helpers exposed to routes/search.js so the zone-assignment hook
//    can build a street checklist and (for vehicle teams) a driving route
//    without making HTTP round-trips to our own endpoints. ──

async function streetsInPolygon(polygonLatLon) {
  if (!Array.isArray(polygonLatLon) || polygonLatLon.length < 3) return [];
  const poly = polygonLatLon.map(([la, lo]) => `${la} ${lo}`).join(' ');
  const query = `[out:json][timeout:25];
    way["highway"]["name"](poly:"${poly}");
    out tags;`;
  const key = `streets:${Buffer.from(query).toString('base64').slice(0, 48)}`;
  const data = await cached(key, 10 * 60_000, () => overpass(query, 30_000));
  const names = new Map();
  for (const el of data.elements || []) {
    const n = el.tags?.name;
    if (!n) continue;
    const entry = names.get(n) || { name: n, count: 0, highway: el.tags?.highway };
    entry.count += 1;
    names.set(n, entry);
  }
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function vehicleRouteThrough(waypointsLatLon) {
  if (!Array.isArray(waypointsLatLon) || waypointsLatLon.length < 2) return null;
  const trimmed = waypointsLatLon.slice(0, 50);
  const coords = trimmed.map(([la, lo]) => `${lo},${la}`).join(';');
  const url = `${OSRM}/trip/v1/driving/${coords}?source=first&roundtrip=true&overview=full&geometries=geojson&steps=false`;
  const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA } });
  const trip = r.data.trips?.[0];
  if (!trip) return null;
  return { geometry: trip.geometry, distance_m: trip.distance, duration_s: trip.duration };
}

module.exports = router;
module.exports.streetsInPolygon = streetsInPolygon;
module.exports.vehicleRouteThrough = vehicleRouteThrough;
