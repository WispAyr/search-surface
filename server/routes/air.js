// Air activity for a search operation.
//
// Two reads, both scoped to the operation's datum:
//   GET /api/search/air/live/:id    current aircraft, from siphon's merged ADS-B
//   GET /api/search/air/tracks/:id  historical trails, from the egpk trail log
//
// Why this matters operationally: a helicopter's LOITER CENTROID marks where the
// crews thought the subject might be. That is an independent read on the search
// picture, and it is the one signal here we do not generate ourselves.
//
// Caveat carried through to the client: aircraft that do not transmit ADS-B, or
// transmit with position blocked, are absent. This is a FLOOR on air activity.

const express = require('express');
const axios = require('axios').default || require('axios');
const { Pool } = require('pg');
const { operations, zones } = require('../search-db');
const optics = require('../optics-model');
const podModel = require('../pod-model');
const { attachTenant, requireTenant } = require('../tenant-middleware');

const router = express.Router();
router.use(attachTenant);

const SIPHON_ADSB = process.env.SIPHON_ADSB_URL || 'http://127.0.0.1:3883/api/aviation/adsb';

// Read-only role, SELECT on adsb_trail_log + aircraft only. Lazily constructed so
// a missing EGPK_DATABASE_URL degrades to "no history" rather than killing boot.
let pool = null;
function db() {
  if (!process.env.EGPK_DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.EGPK_DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (e) => console.warn('[air] pg pool error:', e.message));
  }
  return pool;
}

function opDatum(req, res) {
  const op = operations.get(req.params.id, req.tenant.id);
  if (!op) { res.status(404).json({ error: 'Operation not found' }); return null; }
  if (op.datum_lat == null || op.datum_lon == null) {
    res.status(400).json({ error: 'Operation has no datum' }); return null;
  }
  return op;
}

const R_EARTH = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function haversine(aLat, aLon, bLat, bLon) {
  const p1 = toRad(aLat), p2 = toRad(bLat);
  const x = Math.sin((p2 - p1) / 2) ** 2
    + Math.cos(p1) * Math.cos(p2) * Math.sin(toRad(bLon - aLon) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(x));
}

// Rotorcraft type codes + callsign/operator patterns that matter to a search.
const HELO_TYPES = new Set(['S92','AW139','A139','EC75','H175','AS32','EC35','EC45','B429','A109','S76','AS65','B412','AW169','BK17','H145','H160','B06','B505','R44','R66','R22','AS55','AS50','H125','H135','EC20','EXPL','A169']);
const SAR_CS = /^(RESCUE|COASTGD|POLICE|PGDS|NPAS|HELIMED|SAR)/;

// Type is usually UNKNOWN outside EGPK's enrichment cache, so fall back to how the
// aircraft actually flew. Slow + low + sustained is a rotorcraft on station; nothing
// else holds that profile for this long.
function kinematicClass(minAltM, avgSpeedMs, minutes) {
  if (minAltM == null || avgSpeedMs == null) return null;
  if (avgSpeedMs < 60 && minAltM < 900 && minutes >= 15) return 'probable-rotorcraft';
  return null;
}

function classify(typeCode, operator, callsign) {
  const t = (typeCode || '').toUpperCase();
  const op = (operator || '').toLowerCase();
  const cs = (callsign || '').toUpperCase();
  if (op.includes('coastguard') || op.includes('hmcg') || op.includes('maritime')
    || cs.startsWith('COASTGD') || cs.startsWith('RESCUE')) return 'coastguard';
  if (op.includes('police') || cs.startsWith('POLICE') || cs.startsWith('NPAS')
    || cs.startsWith('PGDS')) return 'police';
  if (op.includes('ambulance') || op.includes('air ambulance') || cs.startsWith('HELIMED')) return 'air-ambulance';
  if (op.includes('rescue') || op.includes('search')) return 'sar';
  if (HELO_TYPES.has(t)) return 'helicopter';
  return 'other';
}

// ── Live ────────────────────────────────────────────────────────────────────
router.get('/live/:id', requireTenant, async (req, res) => {
  const op = opDatum(req, res);
  if (!op) return;
  const radiusKm = Math.min(200, Math.max(1, Number(req.query.radius_km) || 40));
  try {
    const { data } = await axios.get(SIPHON_ADSB, { timeout: 12000 });
    const list = Array.isArray(data) ? data : (data.aircraft || []);
    const out = [];
    for (const a of list) {
      const lat = a.latitude ?? a.lat, lon = a.longitude ?? a.lon;
      if (lat == null || lon == null) continue;
      const d = haversine(op.datum_lat, op.datum_lon, lat, lon);
      if (d > radiusKm * 1000) continue;
      const cs = (a.callsign || '').trim();
      let cat = classify(a.type_code, a.operator, cs);
      if (cat === 'other' && !a.on_ground && a.altitude_m != null && a.altitude_m < 900
        && a.speed_ms != null && a.speed_ms < 60) cat = 'probable-rotorcraft';
      out.push({
        icao24: a.icao24 || a.hex,
        callsign: cs || null,
        registration: a.registration || null,
        type_code: a.type_code || null,
        operator: a.operator || null,
        lat, lon,
        alt_m: a.altitude_m ?? null,
        heading: a.heading ?? null,
        speed_ms: a.speed_ms ?? null,
        on_ground: !!a.on_ground,
        dist_m: Math.round(d),
        category: cat,
        // A slow, low rotorcraft near the datum is the thing worth surfacing.
        of_interest: cat !== 'other'
          && !a.on_ground
          && (a.altitude_m == null || a.altitude_m < 1200)
          && d < 15000,
      });
    }
    out.sort((x, y) => x.dist_m - y.dist_m);
    res.json({
      datum: [op.datum_lat, op.datum_lon],
      radius_km: radiusKm,
      count: out.length,
      of_interest: out.filter(a => a.of_interest).length,
      fetched_at: new Date().toISOString(),
      aircraft: out,
      source: 'siphon adsb (merged network feed)',
    });
  } catch (err) {
    res.status(502).json({ error: `siphon adsb: ${err.message}` });
  }
});

// ── History ─────────────────────────────────────────────────────────────────
router.get('/tracks/:id', requireTenant, async (req, res) => {
  const op = opDatum(req, res);
  if (!op) return;
  const pg = db();
  if (!pg) return res.status(503).json({ error: 'EGPK_DATABASE_URL not configured — no trail history' });

  const hours = Math.min(24 * 8, Math.max(1, Number(req.query.hours) || 48));
  const radiusKm = Math.min(50, Math.max(1, Number(req.query.radius_km) || 8));
  const minPts = Math.max(2, Number(req.query.min_points) || 8);
  const maxAlt = Number(req.query.max_alt_m) || 2000;
  const loiterSpreadM = Number(req.query.loiter_spread_m) || 1500;
  const loiterNearM = Number(req.query.loiter_near_m) || 3000;

  // Bounding box first (indexed), exact radius filtered in JS.
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos(toRad(op.datum_lat)));

  try {
    const { rows } = await pg.query(
      `SELECT t.icao24, NULLIF(TRIM(t.callsign),'') AS callsign,
              t.lat, t.lon, t.alt_m, t.speed_ms, t.logged_at,
              a.registration, a.type_code, a.operator
         FROM adsb_trail_log t
         LEFT JOIN aircraft a ON a.icao24 = t.icao24
        WHERE t.logged_at > now() - make_interval(hours => $1)
          AND t.lat BETWEEN $2 AND $3
          AND t.lon BETWEEN $4 AND $5
          AND (t.alt_m IS NULL OR t.alt_m < $6)
        ORDER BY t.icao24, t.logged_at
        LIMIT 200000`,
      [hours, op.datum_lat - dLat, op.datum_lat + dLat,
        op.datum_lon - dLon, op.datum_lon + dLon, maxAlt],
    );

    const byAc = new Map();
    for (const r of rows) {
      if (haversine(op.datum_lat, op.datum_lon, r.lat, r.lon) > radiusKm * 1000) continue;
      let e = byAc.get(r.icao24);
      if (!e) {
        e = { icao24: r.icao24, callsign: r.callsign, registration: r.registration,
          type_code: r.type_code, operator: r.operator, pts: [], spd: [] };
        byAc.set(r.icao24, e);
      }
      if (r.callsign && !e.callsign) e.callsign = r.callsign;
      e.pts.push([Number(r.lat), Number(r.lon), r.alt_m == null ? null : Math.round(r.alt_m), r.logged_at]);
      if (r.speed_ms != null) e.spd.push(Number(r.speed_ms));
    }

    // Best-effort identity enrichment from siphon's current snapshot. Covers
    // anything still airborne; aircraft that have since landed stay unresolved.
    const liveReg = new Map();
    try {
      const { data } = await axios.get(SIPHON_ADSB, { timeout: 8000 });
      for (const a of (Array.isArray(data) ? data : (data.aircraft || []))) {
        const hex = a.icao24 || a.hex;
        if (hex) liveReg.set(hex, { registration: a.registration || null, type_code: a.type_code || null, operator: a.operator || null });
      }
    } catch { /* enrichment is optional — never fail the history read on it */ }

    const tracks = [];
    for (const e of byAc.values()) {
      if (e.pts.length < minPts) continue;
      const cLat = e.pts.reduce((s, p) => s + p[0], 0) / e.pts.length;
      const cLon = e.pts.reduce((s, p) => s + p[1], 0) / e.pts.length;
      const alts = e.pts.map(p => p[2]).filter(v => v != null);
      const t0 = e.pts[0][3], t1 = e.pts[e.pts.length - 1][3];
      const mins = Math.round((new Date(t1) - new Date(t0)) / 60000);
      const avgSpd = e.spd.length ? e.spd.reduce((a, b) => a + b, 0) / e.spd.length : null;
      // Radius of gyration: mean distance of the track's own points from its
      // centroid. THIS is what separates an orbit from a transit — duration and
      // altitude alone flagged light aircraft pottering about 7km away, which
      // buried the map. A real search orbit is tightly wound.
      const spread = e.pts.reduce((acc, q) => acc + haversine(cLat, cLon, q[0], q[1]), 0) / e.pts.length;
      const minAlt = alts.length ? Math.min(...alts) : null;
      const enr = liveReg.get(e.icao24);
      if (enr) {
        if (!e.registration) e.registration = enr.registration;
        if (!e.type_code) e.type_code = enr.type_code;
        if (!e.operator) e.operator = enr.operator;
      }
      let cat = classify(e.type_code, e.operator, e.callsign);
      if (cat === 'other') cat = kinematicClass(minAlt, avgSpd, mins) || 'other';
      delete e.spd;
      const geo = e.pts; delete e.pts;
      tracks.push({
        ...e,
        points_geo: geo,
        points: geo.length,
        avg_speed_ms: avgSpd == null ? null : Math.round(avgSpd),
        spread_m: Math.round(spread),
        category: cat,
        centroid: [Number(cLat.toFixed(6)), Number(cLon.toFixed(6))],
        centroid_dist_m: Math.round(haversine(op.datum_lat, op.datum_lon, cLat, cLon)),
        min_alt_m: minAlt,
        max_alt_m: alts.length ? Math.max(...alts) : null,
        first_seen: t0, last_seen: t1, minutes_on_station: mins,
        // A search orbit is tightly wound, low, sustained, and ON the datum.
        // All four must hold — dropping the spread and proximity tests flagged
        // 22 "loiterers", most of them aircraft simply passing through the box.
        loiter: mins >= 15
          && alts.length > 0 && Math.min(...alts) < 900
          && spread <= loiterSpreadM
          && haversine(op.datum_lat, op.datum_lon, cLat, cLon) <= loiterNearM,
      });
    }
    tracks.sort((a, b) => b.points - a.points);

    res.json({
      datum: [op.datum_lat, op.datum_lon],
      window_hours: hours, radius_km: radiusKm,
      loiter_criteria: { min_minutes: 15, max_min_alt_m: 900, max_spread_m: loiterSpreadM, max_centroid_dist_m: loiterNearM },
      aircraft: tracks.length,
      loiterers: tracks.filter(t => t.loiter).length,
      total_points: tracks.reduce((s, t) => s + t.points, 0),
      tracks,
      caveat: 'ADS-B only. Aircraft not transmitting, or transmitting with position blocked, are absent. This is a floor on air activity, not a complete picture.',
    });
  } catch (err) {
    console.warn('[air] tracks query failed:', err.message);
    res.status(500).json({ error: `trail query: ${err.message}` });
  }
});

// ── Optics: what could the aircraft actually have seen? ─────────────────────
// GET /api/search/air/optics/:id?sensor=police_eo&target=child_prone&fov=wide
//
// Returns, per loiter track: footprint and GSD at the altitude actually flown,
// a Johnson detection verdict, and the UNIQUE ground area the sensor could have
// covered (grid-rasterised, so an orbit is not credited for re-flying the same
// ground). Also reports which search zones fall inside that coverage.
router.get('/optics/:id', requireTenant, async (req, res) => {
  const op = opDatum(req, res);
  if (!op) return;
  const pg = db();
  if (!pg) return res.status(503).json({ error: 'EGPK_DATABASE_URL not configured' });

  const sensorKey = String(req.query.sensor || 'police_eo');
  const sensor = optics.SENSOR_PROFILES[sensorKey];
  if (!sensor) return res.status(400).json({ error: 'unknown sensor', valid: Object.keys(optics.SENSOR_PROFILES) });
  const targetKey = String(req.query.target || 'child_prone');
  const target = optics.TARGET_PRESETS[targetKey];
  if (!target) return res.status(400).json({ error: 'unknown target', valid: Object.keys(optics.TARGET_PRESETS) });
  const fovMode = req.query.fov === 'narrow' ? 'narrow' : 'wide';
  const hfov = fovMode === 'narrow' ? sensor.hfov_narrow_deg : sensor.hfov_wide_deg;
  const depression = Number(req.query.depression_deg) || 90;
  const hours = Math.min(24 * 8, Math.max(1, Number(req.query.hours) || 72));
  const radiusKm = Math.min(50, Math.max(1, Number(req.query.radius_km) || 8));

  // Reuse the tracks endpoint's own logic by calling it internally would be
  // circular; instead re-run the same query shape here.
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos(toRad(op.datum_lat)));
  let rows;
  try {
    ({ rows } = await pg.query(
      `SELECT t.icao24, NULLIF(TRIM(t.callsign),'') AS callsign, t.lat, t.lon, t.alt_m, t.logged_at
         FROM adsb_trail_log t
        WHERE t.logged_at > now() - make_interval(hours => $1)
          AND t.lat BETWEEN $2 AND $3 AND t.lon BETWEEN $4 AND $5
          AND t.alt_m IS NOT NULL AND t.alt_m > 0 AND t.alt_m < 2000
        ORDER BY t.icao24, t.logged_at LIMIT 200000`,
      [hours, op.datum_lat - dLat, op.datum_lat + dLat, op.datum_lon - dLon, op.datum_lon + dLon]));
  } catch (err) {
    return res.status(500).json({ error: `trail query: ${err.message}` });
  }

  const byAc = new Map();
  for (const r of rows) {
    if (haversine(op.datum_lat, op.datum_lon, r.lat, r.lon) > radiusKm * 1000) continue;
    let e = byAc.get(r.icao24);
    if (!e) { e = { icao24: r.icao24, callsign: r.callsign, pts: [] }; byAc.set(r.icao24, e); }
    if (r.callsign && !e.callsign) e.callsign = r.callsign;
    e.pts.push([Number(r.lat), Number(r.lon), Number(r.alt_m)]);
  }

  const opZones = (op.zones || []).map(z => ({
    id: z.id, name: z.name, raw: z,
    geometry: typeof z.geometry === 'string' ? JSON.parse(z.geometry) : z.geometry,
  }));

  const out = [];
  for (const e of byAc.values()) {
    if (e.pts.length < 8) continue;
    const cLat = e.pts.reduce((a, q) => a + q[0], 0) / e.pts.length;
    const cLon = e.pts.reduce((a, q) => a + q[1], 0) / e.pts.length;
    const spread = e.pts.reduce((a, q) => a + haversine(cLat, cLon, q[0], q[1]), 0) / e.pts.length;
    const centroidDist = haversine(op.datum_lat, op.datum_lon, cLat, cLon);
    if (spread > 1500 || centroidDist > 3000) continue;   // same loiter test as /tracks

    const alts = e.pts.map(q => q[2]);
    const medAlt = alts.slice().sort((a, b) => a - b)[Math.floor(alts.length / 2)];
    const swaths = e.pts.map(q => optics.footprint({
      altitude_agl_m: q[2], hfov_deg: hfov, pixels_h: sensor.pixels_h, depression_deg: depression,
    }).swath_m);
    const fpMedian = optics.footprint({
      altitude_agl_m: medAlt, hfov_deg: hfov, pixels_h: sensor.pixels_h, depression_deg: depression,
    });
    const det = optics.detection(fpMedian.gsd_m, target.size_m);

    const { cells, cellM, origin } = optics.coverageCells(e.pts.map(q => [q[0], q[1]]), swaths, 25);
    const areaM2 = optics.cellsToAreaM2(cells, cellM);
    const centres = optics.cellCentres(cells, origin, cellM);

    const zoneCoverage = [];
    for (const z of opZones) {
      let inside = 0;
      for (const [la, lo] of centres) if (optics.pointInGeometry(la, lo, z.geometry)) inside++;
      if (inside > 0) {
        // 🚨 An airborne EO/IR sensor does not see through water. Over a water
        // zone the footprint covers the SURFACE and nothing beneath it, so this
        // coverage must contribute ZERO detection credit for a submerged subject.
        // Brantham is precisely this case: the one tasked asset did overfly the
        // pond, and could never have seen into it.
        const raw = z.raw || z;
        const water = podModel.isWaterZone(raw);
        // FAIL SAFE. A zone is only treated as penetrable when the terrain is
        // POSITIVELY known to be dry. Unclassified terrain is not evidence of
        // dry land — and this is not hypothetical: in this very operation Decoy
        // Pond was typed 'point_search' with no terrain class, so a permissive
        // default would credit a camera pass over the water the child was in.
        const classified = !!raw.terrain_class || !!raw.terrain_composition;
        const unknown = !water && !classified;
        zoneCoverage.push({
          zone_id: z.id, name: z.name,
          covered_m2: inside * cellM * cellM,
          water,
          terrain_unknown: unknown,
          sensor_penetrates: !water && !unknown,
          credit: water
            ? 'none — surface only; sensor cannot see beneath water'
            : unknown
              ? 'none — terrain unclassified; run terrain classification before crediting this'
              : 'surface coverage only; no credit under canopy, indoors or under vehicles',
        });
      }
    }
    zoneCoverage.sort((a, b) => b.covered_m2 - a.covered_m2);

    out.push({
      icao24: e.icao24, callsign: e.callsign,
      median_alt_m: Math.round(medAlt),
      min_alt_m: Math.round(Math.min(...alts)),
      positions: e.pts.length,
      centroid_dist_m: Math.round(centroidDist),
      spread_m: Math.round(spread),
      footprint: fpMedian,
      detection: det,
      max_detect_altitude_m: optics.maxDetectAltitude({
        hfov_deg: hfov, pixels_h: sensor.pixels_h, target_size_m: target.size_m }),
      unique_coverage_m2: areaM2,
      unique_coverage_km2: Number((areaM2 / 1e6).toFixed(3)),
      zones_touched: zoneCoverage.slice(0, 8),
    });
  }
  out.sort((a, b) => b.unique_coverage_m2 - a.unique_coverage_m2);

  res.json({
    operation_id: op.id,
    sensor: { key: sensorKey, ...sensor, hfov_deg_used: hfov, fov_mode: fovMode, depression_deg: depression },
    target: { key: targetKey, ...target },
    aircraft: out,
    credit_rule: 'Coverage is credited ONLY where terrain is positively classified as dry. '
      + 'Water and unclassified zones get no credit — an unclassified zone is not evidence of dry land.',
    water_rule: 'Coverage of a water zone is SURFACE ONLY and carries no detection '
      + 'credit for a submerged subject, whatever the GSD. Airborne EO and IR do not '
      + 'penetrate water.',
    caveat: 'UPPER BOUND ONLY. This says the sensor could have RESOLVED a target of this '
      + 'size at this altitude, over this much ground. It does NOT know where the gimbal was '
      + 'pointed, whether anyone was watching, or whether the subject was under canopy, indoors, '
      + 'under a vehicle or in water. Camera coverage must never clear a zone on its own.',
  });
});

module.exports = router;
