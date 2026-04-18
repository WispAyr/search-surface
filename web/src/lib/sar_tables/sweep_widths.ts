// ── Smart-grid Tier A4 — Sweep-width preset table ──
//
// Effective Sweep Width (ESW, a.k.a. W) values, in metres, drawn from the
// NASAR and IMRA/UKSAR tables most commonly referenced in UK SAR training.
// Values are deliberately conservative ("average searcher, average alert
// state, average weather") — an IC can and should override via the manual
// input, and a POD calculator using these values will under-promise rather
// than over-promise.
//
// Numbers are SUBJECT-type specific (responsive / unresponsive / object)
// because a shouting hiker is detectable at a totally different range than
// a body lying still under bracken. We keep the same three columns used by
// ESW_TABLE in podCalculator.ts so the UI can fall back cleanly.
//
// Keep at least 10 presets (per spec). Grouped by platform for readability
// in the dropdown; `group` drives the <optgroup>.

export type SweepSubject = "responsive" | "unresponsive" | "object";

export interface SweepPreset {
  id: string;
  label: string;
  group: "Ground" | "K9" | "Water" | "Air" | "Shoreline";
  // One entry per subject type. Metres.
  esw: Record<SweepSubject, number>;
  // Short note under the dropdown (shown when this preset is selected).
  note?: string;
}

export const SWEEP_PRESETS: SweepPreset[] = [
  // ── Ground teams ────────────────────────────────────────────────
  {
    id: "ground_open_field",
    label: "Ground — open field / pasture",
    group: "Ground",
    esw: { responsive: 80, unresponsive: 20, object: 12 },
    note: "Flat, short grass, <100m line-of-sight unbroken.",
  },
  {
    id: "ground_open_woodland",
    label: "Ground — open woodland",
    group: "Ground",
    esw: { responsive: 40, unresponsive: 10, object: 6 },
    note: "Mature trees, light undergrowth, ~30m horizontal visibility.",
  },
  {
    id: "ground_dense_brush",
    label: "Ground — dense brush / young conifer",
    group: "Ground",
    esw: { responsive: 7, unresponsive: 3, object: 2 },
    note: "Thicket, bramble, dense rhododendron — arm's-length detection only.",
  },
  {
    id: "ground_moorland",
    label: "Ground — heather / moorland",
    group: "Ground",
    esw: { responsive: 60, unresponsive: 15, object: 10 },
    note: "Upland heather, peat hags — subjects can disappear into grips.",
  },
  {
    id: "ground_urban",
    label: "Ground — urban / suburban streets",
    group: "Ground",
    esw: { responsive: 60, unresponsive: 15, object: 8 },
    note: "House-to-house checks, doors knocked, gardens peeked.",
  },

  // ── K9 ──────────────────────────────────────────────────────────
  {
    id: "ground_k9_air_scent",
    label: "K9 — air-scent (open terrain)",
    group: "K9",
    esw: { responsive: 50, unresponsive: 50, object: 5 },
    note: "Conditioned air-scent dog, favourable wind, 5–10 min upwind of subject.",
  },
  {
    id: "ground_k9_trailing",
    label: "K9 — trailing (on-lead)",
    group: "K9",
    esw: { responsive: 15, unresponsive: 15, object: 0 },
    note: "Scent-article followed, not area-search; ESW here is cross-track.",
  },

  // ── Water ───────────────────────────────────────────────────────
  {
    id: "boat_observer_calm",
    label: "Boat — observer (calm water)",
    group: "Water",
    esw: { responsive: 100, unresponsive: 30, object: 20 },
    note: "2-up RIB, polarised glasses, swell <0.5m, clear water.",
  },
  {
    id: "boat_observer_choppy",
    label: "Boat — observer (choppy)",
    group: "Water",
    esw: { responsive: 40, unresponsive: 15, object: 8 },
    note: "F4+ wind, white caps — submerged targets very hard to pick out.",
  },
  {
    id: "boat_sonar_sidescan",
    label: "Boat — side-scan sonar",
    group: "Water",
    esw: { responsive: 0, unresponsive: 50, object: 50 },
    note: "Towed fish, 50m swath per side, slow pass; subsurface only.",
  },
  {
    id: "boat_sonar_downscan",
    label: "Boat — down-scan sonar",
    group: "Water",
    esw: { responsive: 0, unresponsive: 10, object: 10 },
    note: "Transducer on transom — narrow beam, shallow water only.",
  },
  {
    id: "diver_visual",
    label: "Diver — visual line",
    group: "Water",
    esw: { responsive: 0, unresponsive: 2, object: 2 },
    note: "Silty UK water; arc-sweep from jackstay, visibility ~2m.",
  },

  // ── Air ─────────────────────────────────────────────────────────
  {
    id: "drone_visual_100m",
    label: "Drone — visual @ 100m AGL",
    group: "Air",
    esw: { responsive: 15, unresponsive: 15, object: 10 },
    note: "4K sensor, daylight, open terrain; halve in moderate tree cover.",
  },
  {
    id: "drone_thermal_100m",
    label: "Drone — thermal @ 100m AGL",
    group: "Air",
    esw: { responsive: 40, unresponsive: 40, object: 5 },
    note: "Dusk/night, ambient <10°C; body contrast drops sharply in rain.",
  },
  {
    id: "aerial_crewed_300m",
    label: "Aerial — crewed @ 300m AGL",
    group: "Air",
    esw: { responsive: 80, unresponsive: 60, object: 15 },
    note: "Helicopter observer, daylight, open ground.",
  },

  // ── Shoreline ───────────────────────────────────────────────────
  {
    id: "shoreline_foot",
    label: "Shoreline — foot patrol at low tide",
    group: "Shoreline",
    esw: { responsive: 100, unresponsive: 25, object: 15 },
    note: "Open beach, firm sand; halve in rocky/tidepool terrain.",
  },
];

// Looking up by id (e.g. from a saved zone preference).
export function getSweepPreset(id: string): SweepPreset | undefined {
  return SWEEP_PRESETS.find((p) => p.id === id);
}

// Group in stable order for <optgroup> rendering.
export const SWEEP_GROUPS: Array<SweepPreset["group"]> = ["Ground", "K9", "Water", "Air", "Shoreline"];
