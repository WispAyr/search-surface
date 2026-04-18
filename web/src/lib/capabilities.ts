// ── Smart-grid Tier A2 — Platform capability matrix ──
//
// For each PlatformType, how good is it at searching each terrain class
// (0 = useless, 1 = ideal)? Numbers are hand-picked from SARTopo and UK SAR
// practice:
//
//  - ground/ground_k9: great on land, hopeless on open water. Can work a
//    beach at low tide so intertidal is moderate.
//  - mounted (horse): same envelope as ground but with better coverage on
//    open terrain — we don't distinguish here because terrain_class doesn't
//    encode "open vs. closed".
//  - boat_observer: ideal on water, useless on land, decent on intertidal
//    (can nose in at mid-tide).
//  - boat_sonar: water-specific — subsurface. Land = 0.
//  - diver: water, zero dry-land value.
//  - drone_visual/thermal: can fly over anything, but only "sees" what's
//    visible from above. Good on water & intertidal for spotting, moderate
//    on open land, poor in dense canopy (we don't model canopy yet so we
//    score by class only).
//  - aerial (crewed): same logic as drone_visual at this granularity.
//
// The guard that consumes this is *advisory* — match_score < 0.4 paints a
// red chip, < 0.6 amber, ≥ 0.6 nothing. We don't BLOCK the assignment
// because an IC might have good reason to send a shore crew to flag a
// half-submerged hazard.

import type { PlatformType, TerrainComposition, TerrainClass } from "@/types/search";

export interface CapabilityScore {
  land: number;
  water: number;
  intertidal: number;
}

export const CAPABILITY_MATRIX: Record<PlatformType, CapabilityScore> = {
  ground:         { land: 1.0, water: 0.0, intertidal: 0.5 },
  ground_k9:      { land: 1.0, water: 0.0, intertidal: 0.4 },
  mounted:        { land: 0.9, water: 0.0, intertidal: 0.3 },
  boat_observer:  { land: 0.0, water: 1.0, intertidal: 0.6 },
  boat_sonar:     { land: 0.0, water: 1.0, intertidal: 0.2 },
  diver:          { land: 0.0, water: 1.0, intertidal: 0.3 },
  drone_visual:   { land: 0.7, water: 0.8, intertidal: 0.9 },
  drone_thermal:  { land: 0.8, water: 0.6, intertidal: 0.9 },
  aerial:         { land: 0.7, water: 0.8, intertidal: 0.9 },
};

// Human-readable label for UI.
export const PLATFORM_LABEL: Record<PlatformType, string> = {
  ground: "Ground (foot)",
  ground_k9: "Ground + K9",
  mounted: "Mounted",
  boat_observer: "Boat — observer",
  boat_sonar: "Boat — sonar",
  diver: "Diver",
  drone_visual: "Drone — visual",
  drone_thermal: "Drone — thermal",
  aerial: "Aerial (crewed)",
};

// All platforms in display order for the <select>.
export const PLATFORM_TYPES: PlatformType[] = [
  "ground",
  "ground_k9",
  "mounted",
  "boat_observer",
  "boat_sonar",
  "diver",
  "drone_visual",
  "drone_thermal",
  "aerial",
];

// Compute the dot-product of capability vs. composition. If either is
// missing we return null — callers paint no warning (can't tell).
//
//  match_score = cap.land·comp.land + cap.water·comp.water + cap.intertidal·comp.intertidal
//
// "mixed" isn't a composition axis — it just means "no class ≥ 0.7". The
// underlying pcts still sum to 1 (± rounding), so the scalar is meaningful.
export function matchScore(
  platform: PlatformType | null | undefined,
  composition: TerrainComposition | null | undefined,
): number | null {
  if (!platform) return null;
  if (!composition) return null;
  const cap = CAPABILITY_MATRIX[platform];
  if (!cap) return null;
  const s =
    cap.land * (composition.land_pct || 0) +
    cap.water * (composition.water_pct || 0) +
    cap.intertidal * (composition.intertidal_pct || 0);
  if (!Number.isFinite(s)) return null;
  return Math.max(0, Math.min(1, s));
}

// Tier mapping for the warning chip. Thresholds picked to catch obvious
// mis-matches (e.g. ground team → 100% water zone = 0.0) without being
// noisy on borderline cases (foot team on a beach-heavy zone ≈ 0.5).
export type MatchTier = "bad" | "weak" | "ok";
export function matchTier(score: number | null | undefined): MatchTier | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score < 0.4) return "bad";
  if (score < 0.6) return "weak";
  return "ok";
}

// Short, non-sensational explanation for the warning chip. Returns null
// when no chip should show (tier = ok, or we lack data to decide).
export function matchWarning(
  platform: PlatformType | null | undefined,
  composition: TerrainComposition | null | undefined,
): { tier: MatchTier; text: string } | null {
  if (!platform) return null;
  if (!composition) return null;
  const score = matchScore(platform, composition);
  const tier = matchTier(score);
  if (tier === null || tier === "ok") return null;

  // Pick the worst dominating class to name in the warning.
  const parts: Array<{ klass: TerrainClass; pct: number }> = [
    { klass: "water", pct: composition.water_pct || 0 },
    { klass: "intertidal", pct: composition.intertidal_pct || 0 },
    { klass: "land", pct: composition.land_pct || 0 },
  ];
  parts.sort((a, b) => b.pct - a.pct);
  const dom = parts[0];
  const pctStr = `${Math.round(dom.pct * 100)}%`;
  const platformLabel = PLATFORM_LABEL[platform] || platform;

  const text =
    tier === "bad"
      ? `${pctStr} ${dom.klass} — ${platformLabel} is not suited to this zone.`
      : `${pctStr} ${dom.klass} — ${platformLabel} may struggle here.`;
  return { tier, text };
}
