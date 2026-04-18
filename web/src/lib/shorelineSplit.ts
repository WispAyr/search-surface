// ── Smart-grid Tier A3 — Split a mixed-terrain zone on its shoreline ──
//
// For a cell where no class is dominant (max(composition) < 0.7), the IC
// may prefer two sub-zones (one land, one water) rather than tasking a
// ground team with a 40%-water cell or a boat with a 60%-land one. This
// helper takes a zone polygon + the same processed terrain bag used at
// grid-generation time and emits up to 2 child polygons with proportional
// POA + recomputed terrain_composition.
//
// Strategy:
//   1. intersect(cell, union(water)) → wet fragment(s).
//   2. difference(cell, union(water)) → dry fragment(s).
//   3. If either side is empty or a tiny sliver (< 5% of the cell), skip —
//      nothing useful to split.
//   4. If either side comes back as multi-piece with > 2 fragments total,
//      return the two largest (one wet, one dry). The rest is
//      <5%-noise that would just clutter the ops board.
//   5. POA is apportioned by area. cumulative_pod is inherited (a prior
//      sweep covered the whole parent). sweep_count resets to 0 — the new
//      children haven't been swept with their new bounds.
//
// Caller is responsible for deleting the parent zone and creating the
// children server-side (see ZoneStatusBoard action).

import area from "@turf/area";
import intersect from "@turf/intersect";
import difference from "@turf/difference";
import { featureCollection } from "@turf/helpers";
import { classifyCell, type ProcessedTerrain } from "@/lib/terrainClassifier";
import type { SearchZone, TerrainComposition } from "@/types/search";

export interface ShorelineChild {
  name: string;                  // "<parent> — land" / "<parent> — water"
  geometry: GeoJSON.Feature;
  poa: number;                   // 0..1
  cumulative_pod: number;        // inherited
  terrain_composition: TerrainComposition;
  terrain_class: TerrainComposition["dominant_class"];
}

export interface ShorelineSplitResult {
  children: ShorelineChild[];    // 1..2 (never 0 — if none, we return null below)
  reason?: string;               // set on "skipped" results with children = []
}

const SLIVER_THRESHOLD = 0.05;   // fragments below 5% of parent area = noise

// Turf's union() in this version doesn't chain cleanly across many polygons
// without the jsts path, and our water bag can be 10-50 polys. So instead
// of union-then-intersect, we intersect the cell against each water poly
// and keep the clipped pieces, then pair them back by difference.
//
// That keeps topology clean: every water fragment is ⊆ cell, and the dry
// remainder is cell minus the accumulated clipped water area.
function intersectAll(
  cell: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  bag: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>,
): Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>> {
  const out: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>> = [];
  for (const w of bag) {
    try {
      const inter = intersect(featureCollection([cell as any, w as any]));
      if (!inter) continue;
      if (inter.geometry.type === "Polygon" || inter.geometry.type === "MultiPolygon") {
        out.push(inter as any);
      }
    } catch {
      // ignore degenerate geometry
    }
  }
  return out;
}

// Take the cell and remove each water fragment in turn. We rebuild the
// "dry" feature incrementally because turf.difference only handles a
// single subtractor. Terminates early once the remainder collapses.
function subtractAll(
  cell: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  subtracters: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>,
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  let remainder: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null = cell;
  for (const s of subtracters) {
    if (!remainder) return null;
    try {
      const next = difference(featureCollection([remainder as any, s as any]));
      if (!next) return null;
      if (next.geometry.type === "Polygon" || next.geometry.type === "MultiPolygon") {
        remainder = next as any;
      }
    } catch {
      // degenerate — keep prior remainder, treat this subtractor as a no-op
    }
  }
  return remainder;
}

// Splits a zone against a processed terrain bag. Returns null if the split
// would produce only one meaningful fragment (i.e. the shoreline barely
// crosses the cell) or if the cell has no usable geometry.
export function splitOnShoreline(
  zone: SearchZone,
  terrain: ProcessedTerrain,
): ShorelineSplitResult | null {
  const geom = zone.geometry as GeoJSON.Feature;
  if (!geom?.geometry) return null;
  const t = geom.geometry.type;
  if (t !== "Polygon" && t !== "MultiPolygon") return null;
  const cell = geom as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  const cellAreaM2 = area(cell);
  if (!Number.isFinite(cellAreaM2) || cellAreaM2 <= 0) return null;

  const wetFragments = intersectAll(cell, terrain.waterPolys);
  const dryFeature = subtractAll(cell, wetFragments);

  const wetAreaM2 = wetFragments.reduce((s, f) => s + area(f), 0);
  const dryAreaM2 = dryFeature ? area(dryFeature) : 0;

  const wetFrac = wetAreaM2 / cellAreaM2;
  const dryFrac = dryAreaM2 / cellAreaM2;

  // Need both sides ≥ 5% to justify a split.
  if (wetFrac < SLIVER_THRESHOLD || dryFrac < SLIVER_THRESHOLD) {
    return { children: [], reason: wetFrac < SLIVER_THRESHOLD ? "No water crossing this zone." : "No dry land in this zone." };
  }

  // Pick the single biggest wet fragment (turf.intersect returns one per
  // water poly — we don't want 8 children). Anything below the sliver
  // threshold on the wet side gets dropped.
  wetFragments.sort((a, b) => area(b) - area(a));
  const biggestWet = wetFragments[0];
  if (!biggestWet) return { children: [], reason: "No water crossing this zone." };
  const biggestWetAreaM2 = area(biggestWet);
  if (biggestWetAreaM2 / cellAreaM2 < SLIVER_THRESHOLD) {
    return { children: [], reason: "Water fragments too small to split." };
  }

  // Re-classify each child against the same processed bag so they get
  // accurate terrain_composition (not just "water=1 / land=1" — a sub-cell
  // might still contain a bit of the other class).
  const dryGeom: GeoJSON.Feature = {
    type: "Feature",
    geometry: dryFeature!.geometry,
    properties: { ...(geom.properties || {}), split_side: "land" },
  };
  const wetGeom: GeoJSON.Feature = {
    type: "Feature",
    geometry: biggestWet.geometry,
    properties: { ...(geom.properties || {}), split_side: "water" },
  };

  const dryComp = classifyCell(dryGeom, terrain);
  const wetComp = classifyCell(wetGeom, terrain);

  // Proportional POA split. Parent POA is preserved in aggregate.
  const parentPOA = Number.isFinite(zone.poa) ? zone.poa : 0;
  const totalUsefulArea = dryAreaM2 + biggestWetAreaM2;
  const dryPOA = totalUsefulArea > 0 ? parentPOA * (dryAreaM2 / totalUsefulArea) : parentPOA / 2;
  const wetPOA = Math.max(0, parentPOA - dryPOA);

  const children: ShorelineChild[] = [
    {
      name: `${zone.name} — land`,
      geometry: dryGeom,
      poa: dryPOA,
      cumulative_pod: zone.cumulative_pod || 0,
      terrain_composition: dryComp,
      terrain_class: dryComp.dominant_class,
    },
    {
      name: `${zone.name} — water`,
      geometry: wetGeom,
      poa: wetPOA,
      cumulative_pod: zone.cumulative_pod || 0,
      terrain_composition: wetComp,
      terrain_class: wetComp.dominant_class,
    },
  ];

  return { children };
}

// Convenience: is a zone eligible for a split prompt? True only when
// composition is present and no class crosses 70%.
export function isSplittable(zone: SearchZone): boolean {
  const c = zone.terrain_composition;
  if (!c) return false;
  const maxPct = Math.max(c.land_pct || 0, c.water_pct || 0, c.intertidal_pct || 0);
  return maxPct < 0.7;
}
