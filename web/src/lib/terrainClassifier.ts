// ── Smart-grid Tier A1 — Per-cell terrain classification ──
//
// Given a grid cell polygon and a bag of OSM polygons/lines from the
// /api/search/osm/terrain endpoint, compute the fraction of the cell covered
// by water / intertidal / land and pick a dominant class.
//
// The classifier works entirely client-side with @turf so grid generation
// stays responsive: fetch OSM once per bbox, classify N cells against that
// cache, zero extra round-trips.
//
// Heuristics (intentionally conservative — we'd rather say "mixed" than
// mis-label open water as land):
//
//  - water polygons (natural=water, waterway=riverbank, landuse=reservoir) are
//    treated as solid water coverage.
//  - coastline LineStrings are buffered 100 m INLAND to approximate the wet
//    zone. We don't know which side of the line is sea without tracing the
//    continent, so we buffer symmetrically and rely on the natural=water
//    polygons for the seaward part. Net effect: a cell touching a coastline
//    gets at least a sliver of "water"; a cell straddling it gets a big
//    chunk. Good enough for "don't task a walker here".
//  - rivers/streams are linear — buffer by half-width:
//      river   → 15 m half-width (30 m total)
//      stream  → 5 m
//      canal   → 15 m
//      drain   → 3 m
//      ditch   → 2 m
//  - intertidal polygons (natural=beach, wetland=tidalflat, natural=shoal,
//    natural=wetland) count as intertidal.
//
// Dominant class: whichever of land_pct / water_pct / intertidal_pct exceeds
// 0.7. If none does, the cell is "mixed" — the split-on-shoreline affordance
// (A3) will offer to clip it.

import area from "@turf/area";
import bufferFn from "@turf/buffer";
import intersect from "@turf/intersect";
import { featureCollection } from "@turf/helpers";

export type TerrainClass = "land" | "water" | "intertidal" | "mixed";

export interface TerrainComposition {
  land_pct: number;
  water_pct: number;
  intertidal_pct: number;
  dominant_class: TerrainClass;
  partial?: boolean;
}

export interface TerrainFeatures {
  water: GeoJSON.FeatureCollection;
  coastline: GeoJSON.FeatureCollection;
  rivers: GeoJSON.FeatureCollection;
  intertidal: GeoJSON.FeatureCollection;
  partial?: boolean;
}

// River half-widths in metres. Conservative (smaller than the channel looks
// on the map) so we don't falsely flood dry cells.
const RIVER_HALF_WIDTH_M: Record<string, number> = {
  river: 15,
  canal: 15,
  stream: 5,
  drain: 3,
  ditch: 2,
};

// Coastline inland buffer — covers the wet strip that isn't in a natural=water
// polygon (e.g. Scottish sea lochs mapped only as coastline).
const COASTLINE_BUFFER_M = 100;

// Dominance threshold. If any class > 0.7 → dominant; else "mixed".
const DOMINANCE = 0.7;

// Safely intersect a cell and a candidate polygon (or multipolygon), returning
// the clipped area in m² or 0 on failure. Turf's intersect can throw on bad
// geometry; we swallow because one bad OSM relation shouldn't sink grid gen.
function safeIntersectArea(
  cell: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  candidate: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): number {
  try {
    const inter = intersect(featureCollection([cell as any, candidate as any]));
    if (!inter) return 0;
    return area(inter as any);
  } catch {
    return 0;
  }
}

// Convert a bag of line features (coastline, rivers) into buffered polygon
// features. Returns an array of polygon features tagged with the original
// klass tag so downstream code can choose water vs. intertidal.
function bufferLines(
  features: GeoJSON.Feature[],
  halfWidthFor: (klass: string) => number,
): Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>> {
  const out: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>> = [];
  for (const f of features) {
    if (!f.geometry || f.geometry.type !== "LineString") continue;
    const klass = (f.properties as any)?.klass || "";
    const halfM = halfWidthFor(klass);
    if (halfM <= 0) continue;
    try {
      const buffered = bufferFn(f as any, halfM / 1000, { units: "kilometers" });
      if (buffered && (buffered.geometry.type === "Polygon" || buffered.geometry.type === "MultiPolygon")) {
        out.push(buffered as any);
      }
    } catch {
      // ignore — a single degenerate line isn't worth failing the whole cell
    }
  }
  return out;
}

// Pre-process a raw terrain payload into cell-ready polygon candidates.
// Buffer the lines ONCE per AOI — callers then classify N cells against the
// same processed bag. Cheap for the grid, expensive if we re-buffered per cell.
export interface ProcessedTerrain {
  waterPolys: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>;
  intertidalPolys: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>;
  partial: boolean;
}

export function processTerrain(raw: TerrainFeatures): ProcessedTerrain {
  const waterPolys: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>> = [];
  const intertidalPolys: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>> = [];

  // Solid water polygons pass through untouched.
  for (const f of raw.water?.features || []) {
    if (f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")) {
      waterPolys.push(f as any);
    }
  }
  // Intertidal polygons.
  for (const f of raw.intertidal?.features || []) {
    if (!f.geometry) continue;
    if (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") {
      intertidalPolys.push(f as any);
    }
  }
  // Coastlines → buffered strip → water.
  for (const strip of bufferLines(raw.coastline?.features || [], () => COASTLINE_BUFFER_M)) {
    waterPolys.push(strip);
  }
  // Rivers/streams → buffered strip → water.
  for (const strip of bufferLines(
    raw.rivers?.features || [],
    (klass) => RIVER_HALF_WIDTH_M[klass] ?? 0,
  )) {
    waterPolys.push(strip);
  }

  return {
    waterPolys,
    intertidalPolys,
    partial: !!raw.partial,
  };
}

// Clamp + round pcts to 3 dp so storage is compact and comparisons are stable.
function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return Math.round(n * 1000) / 1000;
}

// Classify a single cell.
//  - cell: any Feature with Polygon | MultiPolygon geometry.
//  - terrain: processed bag from processTerrain().
export function classifyCell(
  cell: GeoJSON.Feature,
  terrain: ProcessedTerrain,
): TerrainComposition {
  if (!cell?.geometry || (cell.geometry.type !== "Polygon" && cell.geometry.type !== "MultiPolygon")) {
    return { land_pct: 1, water_pct: 0, intertidal_pct: 0, dominant_class: "land", partial: terrain.partial };
  }
  const cellArea = area(cell);
  if (!Number.isFinite(cellArea) || cellArea <= 0) {
    return { land_pct: 1, water_pct: 0, intertidal_pct: 0, dominant_class: "land", partial: terrain.partial };
  }

  let waterM2 = 0;
  for (const w of terrain.waterPolys) {
    waterM2 += safeIntersectArea(cell as any, w);
    // Early-out: once water fully covers the cell, further clipping just
    // wastes CPU and turf calls.
    if (waterM2 >= cellArea) { waterM2 = cellArea; break; }
  }

  // Intertidal is only counted on the *dry* portion of the cell — if a pixel
  // is already flagged as water (e.g. a river running across a beach polygon)
  // we don't double-count. Cheap approximation: clamp intertidal ≤ 1 - water.
  let intertidalM2 = 0;
  if (waterM2 < cellArea) {
    for (const t of terrain.intertidalPolys) {
      intertidalM2 += safeIntersectArea(cell as any, t);
    }
  }

  const water_pct_raw = waterM2 / cellArea;
  const intertidal_pct_raw = Math.min(intertidalM2 / cellArea, 1 - water_pct_raw);
  const land_pct_raw = Math.max(0, 1 - water_pct_raw - intertidal_pct_raw);

  const water_pct = clamp01(water_pct_raw);
  const intertidal_pct = clamp01(intertidal_pct_raw);
  const land_pct = clamp01(land_pct_raw);

  let dominant_class: TerrainClass;
  if (water_pct >= DOMINANCE) dominant_class = "water";
  else if (intertidal_pct >= DOMINANCE) dominant_class = "intertidal";
  else if (land_pct >= DOMINANCE) dominant_class = "land";
  else dominant_class = "mixed";

  return {
    land_pct,
    water_pct,
    intertidal_pct,
    dominant_class,
    partial: terrain.partial || undefined,
  };
}

// Convenience: classify many cells against one processed terrain bag.
export function classifyCells(
  cells: GeoJSON.Feature[],
  terrain: ProcessedTerrain,
): TerrainComposition[] {
  return cells.map((c) => classifyCell(c, terrain));
}

// ── Colour helpers shared between SearchMap (Leaflet) and SearchMap3D ──
// Kept in the same file so the classifier and its visual language can't drift.
// Hex values pulled from Tailwind's blue-500 / amber-400 / neutral grey for
// coherence with status colours elsewhere in the app.
export const TERRAIN_FILL: Record<TerrainClass, string> = {
  land: "#6b7280",       // neutral — existing unassigned grey
  water: "#3b82f6",      // blue-500
  intertidal: "#f59e0b", // amber-500
  mixed: "#a855f7",      // purple-500 — catches the eye for "consider splitting"
};

// Human-readable badge text for tooltips.
export function compositionLabel(c: TerrainComposition | null | undefined): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.land_pct > 0.01) parts.push(`land ${Math.round(c.land_pct * 100)}%`);
  if (c.water_pct > 0.01) parts.push(`water ${Math.round(c.water_pct * 100)}%`);
  if (c.intertidal_pct > 0.01) parts.push(`intertidal ${Math.round(c.intertidal_pct * 100)}%`);
  return parts.join(" · ");
}
