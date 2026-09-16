// What could the aircraft actually have SEEN?
//
// ADS-B gives position and altitude. From altitude + a sensor spec you can derive
// the ground footprint and the ground sample distance (GSD), and from GSD you can
// say whether a target of a given size was theoretically resolvable at all.
//
// 🚨 THIS IS AN UPPER BOUND, AND THE DISTINCTION MATTERS ENORMOUSLY.
// It answers "could the sensor have resolved a target in this area", NOT "did
// anyone look at it". Specifically it does NOT know:
//   - where the gimbal was actually pointed (ADS-B carries no sensor pointing)
//   - whether anyone was watching the downlink, or watching attentively
//   - whether the target was under canopy, in a shed, under a car, or in water
// Treating "inside the footprint" as "searched" is the Decoy Pond mistake wearing
// a different hat. Coverage computed here must never clear a zone on its own.

const DEG = Math.PI / 180;

// ── Sensor profiles ─────────────────────────────────────────────────────────
// hfov/vfov are the WIDE and NARROW ends of the usable zoom range. Search work
// lives somewhere between: wide covers ground fast but resolves nothing; narrow
// resolves well but crawls. That trade is the whole story of air search.
const SENSOR_PROFILES = {
  broadcast_hd: {
    label: 'Broadcast gimbal (news camera ship)',
    pixels_h: 1920, pixels_v: 1080,
    hfov_wide_deg: 32, hfov_narrow_deg: 2.0,
    note: 'Framed for television, not for search. Operators hold wide, aesthetic shots '
      + 'of the scene; nobody is running a search pattern. Treat any coverage as incidental.',
  },
  police_eo: {
    label: 'Police / NPAS EO (daylight)',
    pixels_h: 1920, pixels_v: 1080,
    hfov_wide_deg: 30, hfov_narrow_deg: 1.2,
    note: 'Tasked search sensor with a trained operator and a downlink.',
  },
  thermal_640: {
    label: 'Thermal IR 640x512 (typical airborne)',
    pixels_h: 640, pixels_v: 512,
    hfov_wide_deg: 24, hfov_narrow_deg: 2.5,
    note: 'Detects heat contrast, not detail. Far coarser GSD than EO, but works at '
      + 'night and can pick a warm body out of cold ground — the reason night air '
      + 'search is worth flying at all. Useless through canopy or under water.',
  },
  thermal_1280: {
    label: 'Thermal IR 1280x1024 (high-end)',
    pixels_h: 1280, pixels_v: 1024,
    hfov_wide_deg: 24, hfov_narrow_deg: 2.0,
    note: 'Modern high-resolution airborne thermal.',
  },
};

// Johnson criteria — cycles across the target's critical dimension needed for
// each task. Detection = "something is there", not "it is a child".
const JOHNSON_CYCLES = { detect: 1.0, recognise: 3.0, identify: 6.0 };

// A standing 3-year-old is ~0.95m; prone or curled in cover is ~0.5m, and that is
// the case that actually matters in a search.
const TARGET_PRESETS = {
  child_standing: { label: 'Small child, standing', size_m: 0.95 },
  child_prone: { label: 'Small child, prone or curled', size_m: 0.5 },
  adult_standing: { label: 'Adult, standing', size_m: 1.75 },
  adult_prone: { label: 'Adult, prone', size_m: 0.6 },
};

/**
 * Ground footprint and GSD for one sensor setting at one altitude.
 * depression_deg: 90 = straight down (nadir). Lower angles look further out and
 * degrade GSD sharply, because slant range grows as 1/sin.
 */
function footprint({ altitude_agl_m, hfov_deg, pixels_h, depression_deg = 90 }) {
  const h = Math.max(1, Number(altitude_agl_m) || 0);
  const dep = Math.min(90, Math.max(5, depression_deg));
  const slant = h / Math.sin(dep * DEG);
  const swath_m = 2 * slant * Math.tan((hfov_deg * DEG) / 2);
  const gsd_m = swath_m / pixels_h;
  return {
    altitude_agl_m: Math.round(h),
    depression_deg: dep,
    slant_range_m: Math.round(slant),
    hfov_deg,
    swath_m: Number(swath_m.toFixed(1)),
    gsd_m: Number(gsd_m.toFixed(3)),
  };
}

/** Johnson assessment of a GSD against a target size. */
function detection(gsd_m, target_size_m) {
  const cyclesAcross = target_size_m / (2 * gsd_m); // 1 cycle = 2 pixels
  const out = { cycles_across_target: Number(cyclesAcross.toFixed(2)) };
  for (const [task, need] of Object.entries(JOHNSON_CYCLES)) {
    out[task] = cyclesAcross >= need;
    out[`${task}_max_gsd_m`] = Number((target_size_m / (2 * need)).toFixed(3));
  }
  return out;
}

/**
 * The altitude at which a given sensor setting stops being able to detect the
 * target. This is the number an air-ops planner actually wants.
 */
function maxDetectAltitude({ hfov_deg, pixels_h, target_size_m, task = 'detect' }) {
  const maxGsd = target_size_m / (2 * JOHNSON_CYCLES[task]);
  // gsd = 2*h*tan(fov/2)/px  →  h = gsd*px / (2*tan(fov/2))
  const h = (maxGsd * pixels_h) / (2 * Math.tan((hfov_deg * DEG) / 2));
  return Math.round(h);
}

/**
 * Grid-based unique ground coverage along a track. An orbit re-covers the same
 * ground repeatedly, so swath x path-length wildly overstates it; rasterising
 * onto a grid and counting distinct cells does not.
 */
function coverageCells(points, swathByIndex, cellM = 25) {
  if (!points.length) return { cells: new Set(), cellM, origin: null };
  const lat0 = points[0][0], lon0 = points[0][1];
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(lat0 * DEG) || 1;
  const cells = new Set();
  for (let i = 0; i < points.length; i++) {
    const [lat, lon] = points[i];
    const r = Math.max(cellM / 2, (swathByIndex[i] || 0) / 2);
    const x0 = ((lon - lon0) * mPerDegLon), y0 = ((lat - lat0) * mPerDegLat);
    const steps = Math.min(120, Math.ceil(r / cellM));
    for (let dx = -steps; dx <= steps; dx++) {
      for (let dy = -steps; dy <= steps; dy++) {
        if (Math.hypot(dx * cellM, dy * cellM) > r) continue;
        cells.add(`${Math.round((x0 + dx * cellM) / cellM)},${Math.round((y0 + dy * cellM) / cellM)}`);
      }
    }
  }
  return { cells, cellM, origin: { lat0, lon0, mPerDegLat, mPerDegLon } };
}

function cellsToAreaM2(cells, cellM) { return cells.size * cellM * cellM; }

/** Convert grid cells back to lat/lon centres, for zone intersection. */
function cellCentres(cells, origin, cellM) {
  const out = [];
  for (const key of cells) {
    const [cx, cy] = key.split(',').map(Number);
    out.push([
      origin.lat0 + (cy * cellM) / origin.mPerDegLat,
      origin.lon0 + (cx * cellM) / origin.mPerDegLon,
    ]);
  }
  return out;
}

/** Ray-casting point-in-polygon. ring is [[lon,lat],...] (GeoJSON order). */
function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lat, lon, geom) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return pointInRing(lat, lon, geom.coordinates[0]);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => pointInRing(lat, lon, p[0]));
  return false;
}

module.exports = {
  SENSOR_PROFILES, JOHNSON_CYCLES, TARGET_PRESETS,
  footprint, detection, maxDetectAltitude,
  coverageCells, cellsToAreaM2, cellCentres, pointInGeometry,
};
