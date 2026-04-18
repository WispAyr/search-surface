import bboxFn from "@turf/bbox";
import squareGrid from "@turf/square-grid";
import hexGrid from "@turf/hex-grid";
import intersect from "@turf/intersect";
import bufferFn from "@turf/buffer";
import circleFn from "@turf/circle";
import destination from "@turf/destination";
import lengthFn from "@turf/length";
import lineSliceAlong from "@turf/line-slice-along";
import { point, lineString, polygon, featureCollection } from "@turf/helpers";
import type { GridGenerationParams } from "@/types/search";
import {
  buildRiverCorridor,
  corridorToZones,
  type RiverFeature,
  type CollectionPointFeature,
} from "@/lib/riverCorridor";

export interface GeneratedZone {
  name: string;
  geometry: GeoJSON.Feature;
  search_method: string;
  priority: number;
  poa: number;
}

/**
 * Generate search grid zones from parameters.
 * Returns an array of GeoJSON Feature zones ready for batch creation.
 */
export function generateGrid(params: GridGenerationParams): GeneratedZone[] {
  switch (params.type) {
    case "parallel":
      return generateParallelGrid(params);
    case "hex":
      return generateHexGrid(params);
    case "expanding_square":
      return generateExpandingSquare(params);
    case "route_buffer":
      return generateRouteCorridor(params);
    case "point":
      return generatePointSearch(params);
    case "k9_scent":
      return generateK9ScentCone(params);
    case "drone_lawnmower":
      return generateDroneLawnmower(params);
    case "river_corridor":
      return generateRiverCorridor(params);
    default:
      return [];
  }
}

// Tier B1 — river corridor. The caller (GridGenerator.tsx) fetches OSM rivers
// + collection points via searchHelpers.osmRivers() and passes them in on
// `params.rivers` / `params.collectionPoints`, keeping this function pure
// and synchronous so the rest of the grid pipeline's contract holds.
function generateRiverCorridor(params: GridGenerationParams): GeneratedZone[] {
  if (!params.datum) return [];
  if (!(params.hours && params.hours > 0)) return [];
  if (!(params.velocityMs && params.velocityMs > 0)) return [];
  const rivers = (params.rivers || []) as RiverFeature[];
  const collectionPoints = (params.collectionPoints || []) as CollectionPointFeature[];
  const result = buildRiverCorridor({
    lkp: params.datum,
    hours: params.hours,
    velocityMs: params.velocityMs,
    floater: !!params.floater,
    rivers,
    collectionPoints,
  });
  if ("error" in result) return [];
  return corridorToZones(result, {
    lkp: params.datum,
    hours: params.hours,
    velocityMs: params.velocityMs,
    floater: !!params.floater,
  });
}

function generateParallelGrid(params: GridGenerationParams): GeneratedZone[] {
  if (!params.bounds) return [];
  const cellSize = (params.cellSizeM || 500) / 1000; // turf uses km
  const bx = bboxFn(polygon([params.bounds.coordinates[0]]));
  const grid = squareGrid(bx, cellSize, { units: "kilometers" });

  // Clip to bounds polygon
  const boundsFeature = polygon(params.bounds.coordinates);
  const clipped = grid.features
    .map((cell) => {
      try {
        const intersection = intersect(
          featureCollection([cell, boundsFeature])
        );
        return intersection;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return clipped.map((feat, i) => ({
    name: `Grid ${String.fromCharCode(65 + Math.floor(i / 26))}${(i % 26) + 1}`,
    geometry: feat as GeoJSON.Feature,
    search_method: "parallel_grid",
    priority: 3,
    poa: 0,
  }));
}

function generateHexGrid(params: GridGenerationParams): GeneratedZone[] {
  if (!params.bounds) return [];
  const cellSize = (params.cellSizeM || 500) / 1000;
  const bx = bboxFn(polygon([params.bounds.coordinates[0]]));
  const grid = hexGrid(bx, cellSize, { units: "kilometers" });

  const boundsFeature = polygon(params.bounds.coordinates);
  const clipped = grid.features
    .map((cell) => {
      try {
        return intersect(featureCollection([cell, boundsFeature]));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return clipped.map((feat, i) => ({
    name: `Hex ${i + 1}`,
    geometry: feat as GeoJSON.Feature,
    search_method: "parallel_grid",
    priority: 3,
    poa: 0,
  }));
}

function generateExpandingSquare(params: GridGenerationParams): GeneratedZone[] {
  if (!params.datum) return [];
  const [lat, lon] = params.datum;
  const legM = params.legM || 200;
  const maxLegs = params.maxLegs || 12;
  const zones: GeneratedZone[] = [];

  // Generate expanding square waypoints, then create strip polygons
  let currentLat = lat;
  let currentLon = lon;
  let legNumber = 1;

  for (let i = 0; i < maxLegs && legNumber <= maxLegs; i++) {
    const legLen = Math.ceil(legNumber / 2) * legM;
    const bearing = (legNumber - 1) % 4 * 90; // 0, 90, 180, 270

    const start = point([currentLon, currentLat]);
    const end = destination(start, legLen / 1000, bearing, { units: "kilometers" });
    const [endLon, endLat] = end.geometry.coordinates;

    // Create a buffer strip around this leg
    const line = lineString([[currentLon, currentLat], [endLon, endLat]]);
    const buf = bufferFn(line, (legM / 2) / 1000, { units: "kilometers" });

    if (buf) {
      zones.push({
        name: `Spiral ${legNumber}`,
        geometry: buf,
        search_method: "expanding_square",
        priority: Math.min(5, Math.ceil(legNumber / 3)),
        poa: Math.max(0, 1 - legNumber * 0.08),
      });
    }

    currentLat = endLat;
    currentLon = endLon;
    legNumber++;
  }

  return zones;
}

function generateRouteCorridor(params: GridGenerationParams): GeneratedZone[] {
  if (!params.route) return [];
  const bufferM = params.bufferM || 100;
  const line = lineString(params.route.coordinates);
  const buffered = bufferFn(line, bufferM / 1000, { units: "kilometers" });

  if (!buffered) return [];

  // Split into segments if route is long
  const routeLen = lengthFn(line, { units: "kilometers" });
  const segmentKm = (params.cellSizeM || 500) / 1000;

  if (routeLen <= segmentKm * 2) {
    return [{
      name: "Corridor",
      geometry: buffered,
      search_method: "route_corridor",
      priority: 2,
      poa: 0,
    }];
  }

  const segments: GeneratedZone[] = [];
  const numSegments = Math.ceil(routeLen / segmentKm);
  for (let i = 0; i < numSegments; i++) {
    const start = i * segmentKm;
    const end = Math.min((i + 1) * segmentKm, routeLen);
    try {
      const sliced = lineSliceAlong(line, start, end, { units: "kilometers" });
      const segBuf = bufferFn(sliced, bufferM / 1000, { units: "kilometers" });
      if (segBuf) {
        segments.push({
          name: `Corridor ${i + 1}`,
          geometry: segBuf,
          search_method: "route_corridor",
          priority: 2,
          poa: 0,
        });
      }
    } catch {
      // skip invalid segments
    }
  }
  return segments;
}

function generatePointSearch(params: GridGenerationParams): GeneratedZone[] {
  if (!params.datum) return [];
  const [lat, lon] = params.datum;
  const radiusM = params.radiusM || 500;
  const center = point([lon, lat]);
  const searchCircle = circleFn(center, radiusM / 1000, { units: "kilometers", steps: 64 });

  return [{
    name: "Point Search Area",
    geometry: searchCircle,
    search_method: "point_search",
    priority: 1,
    poa: 1,
  }];
}

/**
 * K9 Scent Cone — generates a fan-shaped zone downwind from the datum.
 * Wind direction = where wind comes FROM. Scent travels downwind.
 * The cone widens with distance based on wind speed.
 */
function generateK9ScentCone(params: GridGenerationParams): GeneratedZone[] {
  if (!params.datum) return [];
  const [lat, lon] = params.datum;
  const windFrom = params.windDirection || 270;
  const windSpd = params.windSpeed || 10;
  const rangeM = params.scentRangeM || 400;

  // Scent travels DOWNWIND (opposite of wind direction)
  const downwind = (windFrom + 180) % 360;
  // Cone spread angle: wider in light winds, narrower in strong
  const halfAngle = windSpd < 5 ? 60 : windSpd < 10 ? 45 : windSpd < 20 ? 30 : 20;

  const center = point([lon, lat]);
  const zones: GeneratedZone[] = [];

  // Generate cone as a polygon: datum → arc of points at range
  const conePoints: [number, number][] = [[lon, lat]];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const angle = downwind - halfAngle + (2 * halfAngle * i) / steps;
    const dest = destination(center, rangeM / 1000, angle, { units: "kilometers" });
    conePoints.push(dest.geometry.coordinates as [number, number]);
  }
  conePoints.push([lon, lat]); // close polygon

  const coneFeature = polygon([conePoints]);
  zones.push({
    name: "Scent Cone — Primary",
    geometry: coneFeature,
    search_method: "sector",
    priority: 1,
    poa: 0.6,
  });

  // Inner high-probability zone (first third of range)
  const innerPoints: [number, number][] = [[lon, lat]];
  for (let i = 0; i <= steps; i++) {
    const angle = downwind - halfAngle + (2 * halfAngle * i) / steps;
    const dest = destination(center, (rangeM / 3) / 1000, angle, { units: "kilometers" });
    innerPoints.push(dest.geometry.coordinates as [number, number]);
  }
  innerPoints.push([lon, lat]);

  zones.push({
    name: "Scent Cone — High Probability",
    geometry: polygon([innerPoints]),
    search_method: "sector",
    priority: 1,
    poa: 0.8,
  });

  // Upwind check zone (small circle upwind of datum — subject may be upwind)
  const upwindDest = destination(center, (rangeM / 4) / 1000, windFrom, { units: "kilometers" });
  const upwindCircle = circleFn(upwindDest, (rangeM / 6) / 1000, { units: "kilometers", steps: 32 });
  zones.push({
    name: "Upwind Check",
    geometry: upwindCircle,
    search_method: "sector",
    priority: 2,
    poa: 0.2,
  });

  return zones;
}

/**
 * Drone Lawnmower — generates ONE zone per drone with embedded flight plan.
 * Each zone contains the lawnmower waypoints as a LineString in properties,
 * plus flight duration estimate based on speed and distance.
 * Multi-drone splits the area into sectors (pie slices or strips).
 */
function generateDroneLawnmower(params: GridGenerationParams): GeneratedZone[] {
  if (!params.datum) return [];
  const [lat, lon] = params.datum;
  const radiusM = params.radiusM || 500;
  const altM = params.droneAltM || 50;
  const overlap = (params.droneOverlap || 20) / 100;
  const numDrones = params.droneCount || 1;
  const droneSpeedMs = 8; // ~8 m/s typical search speed (~29 km/h)

  // Camera footprint width at altitude (assuming ~80° FOV for DJI Mavic/Matrice)
  const fovRad = (80 * Math.PI) / 180;
  const footprintM = 2 * altM * Math.tan(fovRad / 2);
  const stripSpacingM = footprintM * (1 - overlap);

  const center = point([lon, lat]);
  const zones: GeneratedZone[] = [];

  for (let d = 0; d < numDrones; d++) {
    // For multi-drone: divide area into parallel strips (not pie slices)
    // Each drone gets a band of the search area
    const bandWidthM = (2 * radiusM) / numDrones;
    const bandOffsetM = -radiusM + d * bandWidthM + bandWidthM / 2;

    // Generate lawnmower waypoints for this drone's sector
    const waypoints: [number, number][] = [];
    const numPasses = Math.ceil(bandWidthM / stripSpacingM);
    const passLengthM = 2 * radiusM; // full diameter passes

    for (let p = 0; p < numPasses; p++) {
      const stripOffset = bandOffsetM - bandWidthM / 2 + p * stripSpacingM + stripSpacingM / 2;

      // Offset perpendicular to north (east-west strips, north-south passes)
      const stripCenterPt = destination(center, stripOffset / 1000, 90, { units: "kilometers" });

      // Pass endpoints (north to south or south to north, alternating)
      const passStart = destination(stripCenterPt, radiusM / 1000, p % 2 === 0 ? 0 : 180, { units: "kilometers" });
      const passEnd = destination(stripCenterPt, radiusM / 1000, p % 2 === 0 ? 180 : 0, { units: "kilometers" });

      waypoints.push(passStart.geometry.coordinates as [number, number]);
      waypoints.push(passEnd.geometry.coordinates as [number, number]);
    }

    // Calculate flight distance and duration
    let totalDistanceM = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const from = point(waypoints[i - 1]);
      const to = point(waypoints[i]);
      totalDistanceM += lengthFn(lineString([waypoints[i - 1], waypoints[i]]), { units: "kilometers" }) * 1000;
    }
    const flightTimeSec = totalDistanceM / droneSpeedMs;
    const flightTimeMin = Math.ceil(flightTimeSec / 60);

    // Create the coverage zone polygon (the band this drone covers)
    let zoneGeometry;
    if (numDrones === 1) {
      // Single drone: full circle
      zoneGeometry = circleFn(center, radiusM / 1000, { units: "kilometers", steps: 64 });
    } else {
      // Multi-drone: rectangular band
      const bandLeft = destination(center, (bandOffsetM - bandWidthM / 2) / 1000, 90, { units: "kilometers" });
      const bandRight = destination(center, (bandOffsetM + bandWidthM / 2) / 1000, 90, { units: "kilometers" });
      const tl = destination(bandLeft, radiusM / 1000, 0, { units: "kilometers" });
      const bl = destination(bandLeft, radiusM / 1000, 180, { units: "kilometers" });
      const tr = destination(bandRight, radiusM / 1000, 0, { units: "kilometers" });
      const br = destination(bandRight, radiusM / 1000, 180, { units: "kilometers" });
      zoneGeometry = polygon([[
        tl.geometry.coordinates as [number, number],
        tr.geometry.coordinates as [number, number],
        br.geometry.coordinates as [number, number],
        bl.geometry.coordinates as [number, number],
        tl.geometry.coordinates as [number, number],
      ]]);
    }

    // Embed flight plan data in the zone properties
    if (zoneGeometry && zoneGeometry.properties) {
      zoneGeometry.properties = {
        ...zoneGeometry.properties,
        drone_flight_plan: {
          drone_index: d + 1,
          waypoints,
          waypoint_count: waypoints.length,
          altitude_m: altM,
          speed_ms: droneSpeedMs,
          strip_spacing_m: Math.round(stripSpacingM),
          footprint_m: Math.round(footprintM),
          overlap_pct: Math.round(overlap * 100),
          total_distance_m: Math.round(totalDistanceM),
          total_distance_km: Math.round(totalDistanceM / 100) / 10,
          estimated_flight_min: flightTimeMin,
          num_passes: numPasses,
        },
      };
    }

    const droneLabel = numDrones > 1 ? `Drone ${d + 1}` : "Drone";
    zones.push({
      name: `${droneLabel} — ${flightTimeMin}min, ${Math.round(totalDistanceM / 100) / 10}km, ${numPasses} passes`,
      geometry: zoneGeometry as GeoJSON.Feature,
      search_method: "parallel_grid",
      priority: 2,
      poa: 0,
    });
  }

  return zones;
}

// ── OS Grid Reference conversion (WGS84 → BNG) ──
export function toOSGridRef(lat: number, lon: number, digits = 6): string {
  // Simplified WGS84 → OSGB36 → BNG grid reference
  // Uses Helmert transform approximation
  const a = 6377563.396; // Airy 1830 semi-major axis
  const b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = (49 * Math.PI) / 180;
  const lon0 = (-2 * Math.PI) / 180;
  const N0 = -100000;
  const E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);

  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;

  const sinLat = Math.sin(latR);
  const cosLat = Math.cos(latR);
  const tanLat = Math.tan(latR);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const Ma = (1 + n + (5 / 4) * n * n + (5 / 4) * n * n * n) * (latR - lat0);
  const Mb = (3 * n + 3 * n * n + (21 / 8) * n * n * n) * Math.sin(latR - lat0) * Math.cos(latR + lat0);
  const Mc = ((15 / 8) * n * n + (15 / 8) * n * n * n) * Math.sin(2 * (latR - lat0)) * Math.cos(2 * (latR + lat0));
  const Md = (35 / 24) * n * n * n * Math.sin(3 * (latR - lat0)) * Math.cos(3 * (latR + lat0));
  const M = b * F0 * (Ma - Mb + Mc - Md);

  const dLon = lonR - lon0;
  const I = M + N0;
  const II = (nu / 2) * sinLat * cosLat;
  const III = (nu / 24) * sinLat * Math.pow(cosLat, 3) * (5 - tanLat * tanLat + 9 * eta2);
  const IIIA = (nu / 720) * sinLat * Math.pow(cosLat, 5) * (61 - 58 * tanLat * tanLat + Math.pow(tanLat, 4));
  const IV = nu * cosLat;
  const V = (nu / 6) * Math.pow(cosLat, 3) * (nu / rho - tanLat * tanLat);
  const VI = (nu / 120) * Math.pow(cosLat, 5) * (5 - 18 * tanLat * tanLat + Math.pow(tanLat, 4) + 14 * eta2 - 58 * tanLat * tanLat * eta2);

  const N = I + II * dLon * dLon + III * Math.pow(dLon, 4) + IIIA * Math.pow(dLon, 6);
  const E = E0 + IV * dLon + V * Math.pow(dLon, 3) + VI * Math.pow(dLon, 5);

  // Convert to grid reference
  if (E < 0 || E > 700000 || N < 0 || N > 1300000) return "";

  const e100k = Math.floor(E / 100000);
  const n100k = Math.floor(N / 100000);
  const l1 = 19 - n100k - (19 - n100k) % 5 + Math.floor((e100k + 10) / 5);
  const l2 = ((19 - n100k) * 5) % 25 + (e100k % 5);
  let letter1 = String.fromCharCode(l1 + 65);
  let letter2 = String.fromCharCode(l2 + 65);
  if (l1 > 7) letter1 = String.fromCharCode(l1 + 66);
  if (l2 > 7) letter2 = String.fromCharCode(l2 + 66);

  const eStr = String(Math.floor(E % 100000)).padStart(5, "0");
  const nStr = String(Math.floor(N % 100000)).padStart(5, "0");
  const d = digits / 2;

  return `${letter1}${letter2} ${eStr.slice(0, d)} ${nStr.slice(0, d)}`;
}
