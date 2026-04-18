// ── Search-and-Rescue helper endpoints ──
// Geocoding (Nominatim), OSM street/hazard extraction (Overpass),
// Lost Person Behaviour stats, travel-mode isochrones, static UK airspace.

const express = require('express');
const axios = require('axios');
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
  if (!OVERPASS_ENDPOINTS.length) throw new Error('no overpass endpoints configured');
  const body = `data=${encodeURIComponent(query)}`;
  const hdrs = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA };
  const attempts = OVERPASS_ENDPOINTS.map((url) =>
    axios.post(url, body, { headers: hdrs, timeout: timeoutMs, validateStatus: s => s >= 200 && s < 300 })
      .then((r) => r.data)
  );
  return Promise.any(attempts).catch((e) => {
    const errs = (e?.errors || []).map((x) => x?.message || String(x)).join('; ');
    throw new Error(`all overpass mirrors failed: ${errs || 'unknown'}`);
  });
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
  const [s, w, n, e] = bbox;
  // Cap area: Overpass returns timeouts fast on big bboxes.
  if ((n - s) * (e - w) > 0.2) return res.status(400).json({ error: 'bbox too large (>0.2 sq deg)' });
  const a = `(${bbox.join(',')})`;

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

  const keyBase = bbox.map(v => v.toFixed(3)).join(',');
  const settle = async (q, key) => {
    try { return await cached(key, 30 * 60_000, () => overpass(q, 25_000)); }
    catch (e) { return { _error: e.message, elements: [] }; }
  };
  const [hz, at] = await Promise.all([
    settle(hazardsQ, `hz:${keyBase}`),
    settle(attractorsQ, `at:${keyBase}`),
  ]);
  const hazards = [], attractors = [];
  for (const el of hz.elements || []) { const c = classify(el); if (c?._cat === 'hazard') { delete c._cat; hazards.push(c); } }
  for (const el of at.elements || []) { const c = classify(el); if (c?._cat === 'attractor') { delete c._cat; attractors.push(c); } }
  const errors = [hz._error, at._error].filter(Boolean);
  res.json({ hazards, attractors, partial: errors.length > 0, errors });
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
  const [s, w, n, e] = bbox.map(Number);
  if (![s, w, n, e].every(Number.isFinite)) return res.status(400).json({ error: 'bbox must be numbers' });
  // Cap area — same guard as /osm/features, bigger bboxes time out on Overpass.
  if ((n - s) * (e - w) > 0.2) return res.status(400).json({ error: 'bbox too large (>0.2 sq deg)' });
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

  const keyBase = [s, w, n, e].map((v) => v.toFixed(3)).join(',');
  const settle = async (q, key) => {
    try { return await cached(key, 30 * 60_000, () => overpass(q, 25_000)); }
    catch (err) { return { _error: err.message, elements: [] }; }
  };
  const [wr, cr, it] = await Promise.all([
    settle(waterQ, `terr:w:${keyBase}`),
    settle(coastRiverQ, `terr:c:${keyBase}`),
    settle(intertidalQ, `terr:i:${keyBase}`),
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
  });
});

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
