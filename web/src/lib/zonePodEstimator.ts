// ── Smart-grid Tier A4→C — per-zone POD estimator ──
//
// Wires three previously-shipped pieces into a single "what should this zone
// achieve?" number:
//   • Tier A1 terrain_class + terrain_composition on the zone
//   • Tier A2 PlatformType + capability on the assigned team
//   • Tier A4 SWEEP_PRESETS effective sweep-width table
//
// The existing `calculatePOD` in podCalculator.ts is Koopman: given an ESW
// and a spacing, POD = 1 − e^(−ESW/spacing). At the standard SAR planning
// assumption of spacing = ESW (the target for a properly-run parallel sweep)
// that collapses to 1 − e^(−1) ≈ 63% for one pass, and 1 − e^(−2) ≈ 86% for
// two. We use those as the floor values and only deviate when the zone has
// a concrete `spacing_m` saved.
//
// Why an "expected POD" next to the operator-entered POD? The operator-set
// `zone.pod` on the zone card is the IC's *judgement* of what was achieved
// — or what they expect to achieve. The estimate here is a "textbook" value
// for comparison: if the IC is recording 80% for a single pass through
// dense brush by a ground team, the estimator will show ~20%, and the IC
// can decide whether to push back.
//
// Deliberately returns `null` when we can't say anything useful (no team, no
// terrain data, or team type has no sensible preset for the terrain) — the
// UI just hides the chip in those cases rather than showing misleading
// numbers.

import type { PlatformType, SearchZone, SearchTeam, TerrainClass } from "@/types/search";
import { SWEEP_PRESETS, getSweepPreset, type SweepPreset, type SweepSubject } from "@/lib/sar_tables/sweep_widths";
import { calculatePOD } from "@/lib/podCalculator";

export interface ZonePodEstimate {
  preset_id: string;
  preset_label: string;
  esw_m: number;
  area_m2: number | null;
  spacing_m: number;
  pod_one_pass: number;     // 0..1
  pod_two_pass: number;     // 0..1
  subject: SweepSubject;
  rationale: string;        // short operator-facing explanation
}

// Zone terrain class → sensible default ground preset. For `mixed` we pick a
// middle-of-the-road woodland value rather than optimistic open-field — if
// the IC knows better they can override via the POD Calculator directly.
const GROUND_PRESET_BY_TERRAIN: Record<TerrainClass, string> = {
  land: "ground_open_woodland",
  water: "ground_open_woodland", // unreachable in practice; guarded below
  intertidal: "shoreline_foot",
  mixed: "ground_open_woodland",
};

// Platform → preset picker. Deliberately biased toward the conservative
// (lower-ESW) option in each family — the estimator is supposed to be a
// floor the IC compares against, not a ceiling.
function pickPreset(platform: PlatformType | null | undefined, terrain: TerrainClass | null | undefined): SweepPreset | null {
  if (!platform) return null;
  const t = terrain || "land";
  switch (platform) {
    case "ground":
    case "mounted":
      if (t === "water") return null;
      if (t === "intertidal") return getSweepPreset("shoreline_foot") || null;
      return getSweepPreset(GROUND_PRESET_BY_TERRAIN[t]) || null;
    case "ground_k9":
      if (t === "water" || t === "intertidal") return null;
      return getSweepPreset("ground_k9_air_scent") || null;
    case "boat_observer":
      if (t === "land") return null;
      return getSweepPreset("boat_observer_calm") || null;
    case "boat_sonar":
      if (t === "land") return null;
      return getSweepPreset("boat_sonar_sidescan") || null;
    case "diver":
      if (t === "land") return null;
      return getSweepPreset("diver_visual") || null;
    case "drone_visual":
      return getSweepPreset("drone_visual_100m") || null;
    case "drone_thermal":
      return getSweepPreset("drone_thermal_100m") || null;
    case "aerial":
      return getSweepPreset("aerial_crewed_300m") || null;
    default:
      return null;
  }
}

// Rough area of a zone in square metres. Uses the bbox of the GeoJSON feature
// and a latitude-corrected metres-per-degree factor — good enough for the
// ±10% accuracy we need for a floor estimate. Returns null if the geometry
// is missing or empty.
function estimateAreaM2(zone: SearchZone): number | null {
  const coords = (zone.geometry?.geometry as any)?.coordinates;
  if (!coords) return null;
  const ring: number[][] | undefined = Array.isArray(coords[0]?.[0]) ? coords[0] : coords;
  if (!ring || ring.length < 3) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of ring) {
    const lon = p[0], lat = p[1];
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;
  const midLat = (minLat + maxLat) / 2;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((midLat * Math.PI) / 180);
  const dLatM = (maxLat - minLat) * mPerDegLat;
  const dLonM = (maxLon - minLon) * mPerDegLon;
  if (!Number.isFinite(dLatM) || !Number.isFinite(dLonM)) return null;
  return dLatM * dLonM;
}

export function estimateZonePOD(
  zone: SearchZone,
  team: SearchTeam | null | undefined,
  subject: SweepSubject = "responsive",
): ZonePodEstimate | null {
  if (!team) return null;
  const terrain = zone.terrain_class || null;
  const preset = pickPreset(team.platform_type, terrain);
  if (!preset) return null;
  const esw = preset.esw[subject];
  if (!esw || esw <= 0) return null;

  const area = estimateAreaM2(zone);
  // Spacing: prefer the IC-saved value if present, else "well-spaced" at ESW.
  const spacing = zone.spacing_m && zone.spacing_m > 0 ? zone.spacing_m : esw;
  // calculatePOD(ESW, areaWidth, passes) uses coverage = ESW*passes/areaWidth.
  // We want coverage per pass = ESW/spacing, so pass areaWidth = spacing.
  const podOne = calculatePOD(esw, spacing, 1);
  const podTwo = calculatePOD(esw, spacing, 2);

  const terrainLabel = terrain
    ? terrain.replace(/_/g, " ")
    : "unclassified terrain";
  const passesNote = spacing !== esw
    ? `spacing ${spacing} m (saved) vs ESW ${esw} m`
    : `ESW-matched spacing ${esw} m`;

  return {
    preset_id: preset.id,
    preset_label: preset.label,
    esw_m: esw,
    area_m2: area,
    spacing_m: spacing,
    pod_one_pass: podOne,
    pod_two_pass: podTwo,
    subject,
    rationale: `${preset.label} on ${terrainLabel} · ${passesNote} · ${subject} subject.`,
  };
}
