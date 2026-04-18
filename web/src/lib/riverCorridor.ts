// ── Smart-grid Tier B1 — River corridor (drift) generator ──
//
// A river search is not a static grid — the search area *moves* downstream
// over time. Given:
//  - an LKP (lat/lon)
//  - an OSM river network (from /api/search/osm/rivers)
//  - time-since-entry (hours)
//  - mean surface velocity (m/s)
// this module builds:
//  - a centreline (snap LKP → nearest waterway, then walk downstream)
//  - a translucent corridor polygon (buffered centreline with distance-growing
//    uncertainty capped at 100m)
//  - chainage markers every 100m along the centreline
//  - a list of collection points (weirs/dams/bridges) within the corridor
//
// Heuristics:
//  - Body velocity = v_surface × 0.3 (Carlson).  Live floaters = v × 0.7.
//  - Head-of-corridor distance = v × t × 3600 m.
//  - Corridor width = river_width + 10 m either bank + √t × 2 uncertainty term,
//    capped at 100 m half-width.
//  - Direction: OSM lines are drawn upstream→downstream by convention. We
//    trust that for v1; the UI surfaces a warning so the operator can verify
//    (a terrain/DEM elevation check is a future enhancement).
//
// All pure geometry — no network calls, no side effects. The caller feeds in
// OSM data already fetched by searchHelpers.osmRivers.

import bufferFn from "@turf/buffer";
import bboxFn from "@turf/bbox";
import { lineString, point, featureCollection } from "@turf/helpers";
import type { GeneratedZone } from "@/lib/gridGenerator";

// ── Types ──────────────────────────────────────────────────────────────

export interface RiverFeature extends GeoJSON.Feature<GeoJSON.LineString> {
  properties: {
    osm_id: number;
    waterway: string | null;
    name: string | null;
    width_m: number | null;
  };
}

export interface CollectionPointFeature extends GeoJSON.Feature<GeoJSON.Point> {
  properties: {
    osm_id: number;
    kind: string;
    name: string | null;
  };
}

export interface RiverCorridorInput {
  lkp: [number, number]; // [lat, lon]
  hours: number;          // time since entry
  velocityMs: number;     // surface velocity m/s
  floater: boolean;       // true = live floater (0.7×), false = body (0.3×)
  rivers: RiverFeature[];
  collectionPoints: CollectionPointFeature[];
}

export interface ChainagePoint {
  lon: number;
  lat: number;
  chainage_m: number; // distance from LKP along centreline
}

export interface RiverCorridorResult {
  centreline: GeoJSON.Feature<GeoJSON.LineString>;
  corridorPolygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  chainage: ChainagePoint[];
  // Collection points intersecting the corridor, with their distance from LKP.
  collectionHits: Array<{
    feature: CollectionPointFeature;
    chainage_m: number;
  }>;
  // Warnings: directional ambiguity, bad input, no network found etc.
  warnings: string[];
  // Derived parameters for display in the UI.
  params: {
    body_velocity_ms: number;
    head_distance_m: number;
    head_corridor_width_m: number;
    river_name: string | null;
  };
}

// ── Haversine distance (metres) ────────────────────────────────────────
const R_EARTH = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const la1 = toRad(aLat);
  const la2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Perpendicular distance from point P to segment AB, in metres.
// Also returns the projected point and its parametric t along AB (0..1 clamped).
function pointToSegment(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): { distM: number; projLat: number; projLon: number; t: number } {
  // Equirectangular approx — fine for sub-km segments at UK latitudes.
  const latRef = toRad((aLat + bLat) / 2);
  const ax = aLon * Math.cos(latRef);
  const ay = aLat;
  const bx = bLon * Math.cos(latRef);
  const by = bLat;
  const px = pLon * Math.cos(latRef);
  const py = pLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const projLon = (ax + t * dx) / Math.cos(latRef);
  const projLat = ay + t * dy;
  return {
    distM: haversineM(pLat, pLon, projLat, projLon),
    projLat,
    projLon,
    t,
  };
}

// ── Waterway graph ─────────────────────────────────────────────────────
//
// OSM "ways" are line segments with shared endpoint nodes at junctions. We
// don't have explicit node IDs from Overpass `out geom` — we reconstruct
// adjacency by matching endpoint coordinates within a small epsilon.

interface WayNode {
  key: string;     // rounded "lon|lat" string
  lon: number;
  lat: number;
}

interface Way {
  feature: RiverFeature;
  nodes: WayNode[];     // in drawn order
  // Whichever end matches a neighbour's start = downstream point when the
  // drawn direction is preserved.
}

// Round coord to ~1m precision (5 dp lon, 5 dp lat) for endpoint dedupe.
function nodeKey(lon: number, lat: number): string {
  return `${lon.toFixed(5)}|${lat.toFixed(5)}`;
}

function buildWays(rivers: RiverFeature[]): Way[] {
  const ways: Way[] = [];
  for (const r of rivers) {
    const coords = r.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const nodes: WayNode[] = coords.map(([lon, lat]) => ({
      key: nodeKey(lon, lat),
      lon,
      lat,
    }));
    ways.push({ feature: r, nodes });
  }
  return ways;
}

// Build downstream adjacency: from each way's FINAL node we look up other
// ways whose FIRST node matches — those are the downstream neighbours.
// The opposite direction (first-node → other ways' last-node) is the
// upstream direction we don't follow.
function buildDownstreamAdj(ways: Way[]): Map<string, Way[]> {
  const byStartKey = new Map<string, Way[]>();
  for (const w of ways) {
    const k = w.nodes[0].key;
    const arr = byStartKey.get(k) || [];
    arr.push(w);
    byStartKey.set(k, arr);
  }
  const adj = new Map<string, Way[]>();
  for (const w of ways) {
    const endKey = w.nodes[w.nodes.length - 1].key;
    const downstream = byStartKey.get(endKey) || [];
    // Don't self-loop on the same way if it happens to start/end at same pt.
    const filtered = downstream.filter((d) => d !== w);
    adj.set(w.feature.properties.osm_id + "", filtered);
  }
  return adj;
}

// ── Snap LKP to nearest waterway segment ───────────────────────────────
interface SnapResult {
  way: Way;
  segmentIndex: number; // 0-based segment in way.nodes
  t: number;            // 0..1 within that segment
  projLat: number;
  projLon: number;
  distM: number;
}

function snapToWays(lkpLat: number, lkpLon: number, ways: Way[]): SnapResult | null {
  let best: SnapResult | null = null;
  for (const w of ways) {
    for (let i = 0; i < w.nodes.length - 1; i++) {
      const a = w.nodes[i];
      const b = w.nodes[i + 1];
      const r = pointToSegment(lkpLat, lkpLon, a.lat, a.lon, b.lat, b.lon);
      if (!best || r.distM < best.distM) {
        best = {
          way: w,
          segmentIndex: i,
          t: r.t,
          projLat: r.projLat,
          projLon: r.projLon,
          distM: r.distM,
        };
      }
    }
  }
  return best;
}

// ── Trace downstream path ──────────────────────────────────────────────
//
// Starting from the snap point, walk along the current way to its end, then
// hop to a downstream neighbour, and so on, until we've accumulated at least
// `targetLenM` metres OR hit a dead-end. At forks we take the widest
// waterway (river > canal > stream > drain) then fall back to the first.
// This is not a true flow-accumulation — we're building a reasonable
// downstream path, not solving the catchment.

const WATERWAY_RANK: Record<string, number> = {
  river: 4,
  canal: 3,
  stream: 2,
  drain: 1,
};

function pickDownstream(options: Way[], exclude: Set<string>): Way | null {
  const candidates = options.filter((w) => !exclude.has(w.feature.properties.osm_id + ""));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const ra = WATERWAY_RANK[a.feature.properties.waterway || ""] ?? 0;
    const rb = WATERWAY_RANK[b.feature.properties.waterway || ""] ?? 0;
    return rb - ra;
  });
  return candidates[0];
}

function traceDownstream(
  snap: SnapResult,
  adj: Map<string, Way[]>,
  targetLenM: number,
): { coords: Array<[number, number]>; accLen: number; widths: number[]; riverName: string | null } {
  const coords: Array<[number, number]> = [];
  const widths: number[] = [];
  let accLen = 0;
  let riverName: string | null = snap.way.feature.properties.name || null;

  // First point is the snap itself.
  coords.push([snap.projLon, snap.projLat]);
  const firstWidth = snap.way.feature.properties.width_m || defaultWidth(snap.way.feature.properties.waterway);
  widths.push(firstWidth);

  // Walk the remainder of the starting segment + subsequent segments of
  // snap.way.
  let currentWay: Way | null = snap.way;
  let nextNodeIndex = snap.segmentIndex + 1;
  const visited = new Set<string>([snap.way.feature.properties.osm_id + ""]);

  while (currentWay) {
    const nodes = currentWay.nodes;
    while (nextNodeIndex < nodes.length) {
      const prev = coords[coords.length - 1];
      const node = nodes[nextNodeIndex];
      const seg = haversineM(prev[1], prev[0], node.lat, node.lon);
      accLen += seg;
      coords.push([node.lon, node.lat]);
      const w = currentWay.feature.properties.width_m || defaultWidth(currentWay.feature.properties.waterway);
      widths.push(w);
      if (!riverName) riverName = currentWay.feature.properties.name || riverName;
      if (accLen >= targetLenM) return { coords, accLen, widths, riverName };
      nextNodeIndex++;
    }
    // End of this way — hop to downstream neighbour.
    const nextOpts = adj.get(currentWay.feature.properties.osm_id + "") || [];
    const next = pickDownstream(nextOpts, visited);
    if (!next) return { coords, accLen, widths, riverName };
    visited.add(next.feature.properties.osm_id + "");
    currentWay = next;
    // Start from node 1 of the next way — node 0 is shared with the junction
    // we just arrived at.
    nextNodeIndex = 1;
    if (!riverName) riverName = currentWay.feature.properties.name || riverName;
  }

  return { coords, accLen, widths, riverName };
}

function defaultWidth(waterway: string | null): number {
  // Mirror the Tier A terrain classifier buffer widths (× 2 for full channel).
  if (waterway === "river") return 30;
  if (waterway === "canal") return 30;
  if (waterway === "stream") return 10;
  if (waterway === "drain") return 6;
  return 10;
}

// Clip coords list to an exact downstream distance (so the corridor head is
// at the computed v×t, not the nearest OSM node beyond it).
function truncateAtDistance(coords: Array<[number, number]>, targetM: number): {
  coords: Array<[number, number]>;
  actualLen: number;
} {
  if (coords.length < 2) return { coords: coords.slice(), actualLen: 0 };
  const out: Array<[number, number]> = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    const seg = haversineM(prev[1], prev[0], cur[1], cur[0]);
    if (acc + seg >= targetM) {
      const remain = targetM - acc;
      const frac = seg > 0 ? remain / seg : 0;
      const lon = prev[0] + frac * (cur[0] - prev[0]);
      const lat = prev[1] + frac * (cur[1] - prev[1]);
      out.push([lon, lat]);
      return { coords: out, actualLen: targetM };
    }
    acc += seg;
    out.push(cur);
  }
  return { coords: out, actualLen: acc };
}

// ── Chainage markers ───────────────────────────────────────────────────
// Every `stepM` metres along the centreline emit a point with its cumulative
// distance. Used for on-scene comms ("body at km 4.2").

export function chainageMarkers(
  coords: Array<[number, number]>,
  stepM = 100,
): ChainagePoint[] {
  const markers: ChainagePoint[] = [];
  if (coords.length < 2) return markers;
  let acc = 0;
  let nextMark = stepM;
  // Always emit a marker at 0 (LKP).
  markers.push({ lon: coords[0][0], lat: coords[0][1], chainage_m: 0 });
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    const seg = haversineM(prev[1], prev[0], cur[1], cur[0]);
    if (seg <= 0) continue;
    while (acc + seg >= nextMark) {
      const remain = nextMark - acc;
      const frac = remain / seg;
      const lon = prev[0] + frac * (cur[0] - prev[0]);
      const lat = prev[1] + frac * (cur[1] - prev[1]);
      markers.push({ lon, lat, chainage_m: nextMark });
      nextMark += stepM;
    }
    acc += seg;
  }
  return markers;
}

// Distance from LKP to a collection-point feature: nearest-point along the
// centreline, then cumulative length up to that projection.
function chainageOfPoint(
  point: [number, number],
  coords: Array<[number, number]>,
): { chainage_m: number; perpDistM: number } {
  let acc = 0;
  let bestChainage = 0;
  let bestPerp = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const seg = haversineM(a[1], a[0], b[1], b[0]);
    const r = pointToSegment(point[1], point[0], a[1], a[0], b[1], b[0]);
    if (r.distM < bestPerp) {
      bestPerp = r.distM;
      bestChainage = acc + r.t * seg;
    }
    acc += seg;
  }
  return { chainage_m: bestChainage, perpDistM: bestPerp };
}

// ── Corridor polygon ───────────────────────────────────────────────────
//
// Turf's buffer is uniform along the line. To get the distance-growing
// uncertainty we buffer each segment with its own width and union — but
// turf's union isn't in the dep list, so we approximate: buffer the whole
// centreline at max-head-width. For river channel accuracy we'd union
// against the OSM water polygon — future work. For v1 this gives a crisp
// teardrop silhouette which reads well visually.

export function buildCorridorPolygon(
  centrelineCoords: Array<[number, number]>,
  riverWidthM: number,
  hours: number,
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (centrelineCoords.length < 2) return null;
  // Half-width = river half + 10 m each bank + √t × 2 uncertainty, capped at 100 m.
  const riverHalf = Math.max(5, riverWidthM / 2);
  const uncertain = Math.min(100, Math.sqrt(Math.max(0, hours)) * 2);
  const halfWidthM = Math.min(100, riverHalf + 10 + uncertain);
  const line = lineString(centrelineCoords);
  try {
    const buf = bufferFn(line, halfWidthM / 1000, { units: "kilometers" });
    if (!buf) return null;
    return buf as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  } catch {
    return null;
  }
}

// ── Entry point ────────────────────────────────────────────────────────
export function buildRiverCorridor(input: RiverCorridorInput): RiverCorridorResult | { error: string } {
  const { lkp, hours, velocityMs, floater, rivers, collectionPoints } = input;
  const warnings: string[] = [];

  if (!Array.isArray(lkp) || lkp.length !== 2) return { error: "LKP required" };
  if (!(hours > 0)) return { error: "hours must be > 0" };
  if (!(velocityMs > 0)) return { error: "velocity must be > 0 m/s" };
  const ways = buildWays(rivers || []);
  if (!ways.length) return { error: "no OSM waterways returned for bbox" };

  const snap = snapToWays(lkp[0], lkp[1], ways);
  if (!snap) return { error: "could not snap LKP to any waterway" };
  if (snap.distM > 500) {
    warnings.push(`LKP is ${Math.round(snap.distM)} m from nearest OSM waterway — verify the correct river was selected.`);
  }

  warnings.push("OSM line direction assumed upstream → downstream — verify on the map before committing.");

  // Body vs live-floater velocity coefficient.
  const coeff = floater ? 0.7 : 0.3;
  const bodyV = velocityMs * coeff;
  const headDistM = bodyV * hours * 3600;

  const adj = buildDownstreamAdj(ways);
  const traced = traceDownstream(snap, adj, headDistM);
  if (traced.coords.length < 2) return { error: "downstream trace returned too few points" };

  // Truncate precisely at head distance so the corridor is the right length.
  const { coords: truncated, actualLen } = truncateAtDistance(traced.coords, headDistM);
  if (actualLen < headDistM - 1) {
    warnings.push(`Downstream OSM network runs out at ${Math.round(actualLen)} m — corridor truncated.`);
  }
  // Weighted-mean river width along the traced segment for the corridor
  // half-width floor.
  const avgWidth = average(traced.widths);

  const corridor = buildCorridorPolygon(truncated, avgWidth, hours);
  if (!corridor) return { error: "corridor buffer failed" };

  const chainage = chainageMarkers(truncated, 100);

  // Collection points: keep only those within a loose envelope of the
  // corridor (perp distance ≤ 100 m), with their along-channel position.
  const collectionHits: RiverCorridorResult["collectionHits"] = [];
  for (const cp of collectionPoints || []) {
    const pt = cp.geometry?.coordinates;
    if (!Array.isArray(pt) || pt.length !== 2) continue;
    const { chainage_m, perpDistM } = chainageOfPoint([pt[0], pt[1]], truncated);
    if (perpDistM <= 100 && chainage_m <= actualLen + 50 && chainage_m >= -25) {
      collectionHits.push({ feature: cp, chainage_m });
    }
  }
  collectionHits.sort((a, b) => a.chainage_m - b.chainage_m);

  // Dedupe collection points that sit on top of each other (several bridges
  // at a road junction will each pick up a tag). 20 m threshold.
  const deduped: typeof collectionHits = [];
  for (const h of collectionHits) {
    const near = deduped.find((d) => {
      const [dx, dy] = [
        d.feature.geometry.coordinates[0] - h.feature.geometry.coordinates[0],
        d.feature.geometry.coordinates[1] - h.feature.geometry.coordinates[1],
      ];
      return haversineM(
        d.feature.geometry.coordinates[1],
        d.feature.geometry.coordinates[0],
        h.feature.geometry.coordinates[1],
        h.feature.geometry.coordinates[0],
      ) < 20;
    });
    if (!near) deduped.push(h);
  }

  const centrelineFeat: GeoJSON.Feature<GeoJSON.LineString> = {
    type: "Feature",
    properties: { kind: "river_corridor_centreline" },
    geometry: { type: "LineString", coordinates: truncated },
  };

  return {
    centreline: centrelineFeat,
    corridorPolygon: corridor,
    chainage,
    collectionHits: deduped,
    warnings,
    params: {
      body_velocity_ms: Math.round(bodyV * 100) / 100,
      head_distance_m: Math.round(actualLen),
      head_corridor_width_m: Math.round(Math.min(100, Math.max(5, avgWidth / 2) + 10 + Math.min(100, Math.sqrt(Math.max(0, hours)) * 2)) * 2),
      river_name: traced.riverName,
    },
  };
}

function average(xs: number[]): number {
  const finite = xs.filter((x) => Number.isFinite(x) && x > 0);
  if (!finite.length) return 10;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

// ── Preview zones builder ──────────────────────────────────────────────
//
// Turns a corridor result into the `GeneratedZone[]` shape the existing
// GridGenerator preview + batch-create pipeline expects.
//
// Zone 0: the corridor parent polygon (priority=2, poa=0.6)
// Zones 1..N: one small circle buffer per collection point (priority=1, poa=0.9)
//
// Per-zone JSON metadata is packed into `corridor_metadata` — the server
// persists it on the zone row (see Tier B1 migration in server/search-db.js).

export function corridorToZones(result: RiverCorridorResult, opts: {
  lkp: [number, number];
  hours: number;
  velocityMs: number;
  floater: boolean;
}): GeneratedZone[] {
  const zones: GeneratedZone[] = [];

  // Parent corridor zone carries the full chainage + metadata bundle.
  const parentName = result.params.river_name
    ? `River corridor — ${result.params.river_name} (${Math.round(result.params.head_distance_m / 100) / 10} km)`
    : `River corridor — ${Math.round(result.params.head_distance_m / 100) / 10} km downstream`;

  const parentMeta = {
    kind: "parent",
    lkp: opts.lkp,
    hours: opts.hours,
    velocity_ms: opts.velocityMs,
    floater: opts.floater,
    body_velocity_ms: result.params.body_velocity_ms,
    head_distance_m: result.params.head_distance_m,
    head_corridor_width_m: result.params.head_corridor_width_m,
    river_name: result.params.river_name,
    centreline: result.centreline.geometry.coordinates,
    chainage: result.chainage.map((c) => ({ lon: c.lon, lat: c.lat, d: c.chainage_m })),
    warnings: result.warnings,
  };

  zones.push({
    name: parentName,
    geometry: {
      ...result.corridorPolygon,
      properties: {
        ...(result.corridorPolygon.properties || {}),
        corridor_metadata: parentMeta,
      },
    } as GeoJSON.Feature,
    search_method: "river_corridor",
    priority: 2,
    poa: 0.6,
  });

  // One small zone per collection point. 50-m circle buffer keeps it
  // operationally meaningful — a team can stand at the weir, sweep the pool
  // below, and call cleared in one sitting.
  for (const hit of result.collectionHits) {
    const [lon, lat] = hit.feature.geometry.coordinates;
    const pt = point([lon, lat]);
    const buf = bufferFn(pt, 50 / 1000, { units: "kilometers" });
    if (!buf) continue;
    const kind = hit.feature.properties.kind;
    const name = hit.feature.properties.name;
    const label = `${kind.toUpperCase()}${name ? " " + name : ""} (${formatChainage(hit.chainage_m)})`;
    const meta = {
      kind: "collection_point",
      collection_kind: kind,
      chainage_m: Math.round(hit.chainage_m),
      parent_lkp: opts.lkp,
      osm_id: hit.feature.properties.osm_id,
      osm_name: name,
    };
    zones.push({
      name: label,
      geometry: {
        ...(buf as GeoJSON.Feature),
        properties: {
          ...((buf as GeoJSON.Feature).properties || {}),
          corridor_metadata: meta,
        },
      } as GeoJSON.Feature,
      search_method: "river_collection_point",
      priority: 1,
      poa: 0.9,
    });
  }

  return zones;
}

function formatChainage(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(Math.round(m / 10) / 100).toFixed(2)} km`;
}

// Convenience: fit-bounds helper used by map components.
export function corridorBbox(result: RiverCorridorResult): [number, number, number, number] | null {
  try {
    return bboxFn(featureCollection([result.centreline as any, result.corridorPolygon as any])) as [number, number, number, number];
  } catch {
    return null;
  }
}
