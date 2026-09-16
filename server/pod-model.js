// Probability of detection, cumulative coverage, and residual probability.
//
// See docs/residual-probability.md for the reasoning. The short version: a zone
// that has been searched is not a zone that is empty, and this module is what
// stops the UI from claiming otherwise.
//
// ⚠ The base values below are PLANNING DEFAULTS drawn from published SAR ranges.
// They are not validated against this team's own performance. They live in one
// table precisely so they can be argued with and replaced by real outcome data.

// ── Resource classes ────────────────────────────────────────────────────────
const RESOURCE_CLASSES = {
  trained_ground:   { label: 'Trained ground team',        subsurface: false },
  volunteer_line:   { label: 'Public volunteer line',      subsurface: false },
  dog_airscent:     { label: 'Air-scent dog',              subsurface: false },
  dog_trailing:     { label: 'Trailing dog',               subsurface: false },
  air_visual:       { label: 'Aircraft — visual',          subsurface: false },
  air_thermal:      { label: 'Aircraft — thermal',         subsurface: false },
  water_shoreline:  { label: 'Water — shoreline visual',   subsurface: false },
  water_wade:       { label: 'Water — wade / pole',        subsurface: true  },
  water_sonar:      { label: 'Water — sonar',              subsurface: true  },
  water_dive:       { label: 'Water — dive team',          subsurface: true  },
  premises_search:  { label: 'Premises / confined space',  subsurface: false },
  technical_rope:   { label: 'Technical / rope',           subsurface: false },
};

// base POD for (resource_class, method), for a RESPONSIVE subject, moderate
// cover, daylight, full coverage.
const BASE_POD = {
  trained_ground:  { grid_close: 0.80, grid_open: 0.55, hasty: 0.35, point: 0.75, confined: 0.65 },
  volunteer_line:  { grid_close: 0.55, grid_open: 0.35, hasty: 0.20, point: 0.45, confined: 0.40 },
  dog_airscent:    { area: 0.70, grid_open: 0.65, hasty: 0.45 },
  dog_trailing:    { trail: 0.50, hasty: 0.35 },
  air_visual:      { sweep: 0.45, shoreline: 0.35 },
  air_thermal:     { sweep: 0.55, shoreline: 0.45 },
  water_shoreline: { shoreline: 0.25, margins: 0.35 },
  water_wade:      { margins: 0.55, subsurface: 0.50 },
  water_sonar:     { subsurface: 0.70 },
  water_dive:      { subsurface: 0.85 },
  premises_search: { confined: 0.60, point: 0.55 },
  technical_rope:  { point: 0.70 },
};

const DEFAULT_METHOD = {
  trained_ground: 'grid_open', volunteer_line: 'grid_open', dog_airscent: 'area',
  dog_trailing: 'trail', air_visual: 'sweep', air_thermal: 'sweep',
  water_shoreline: 'shoreline', water_wade: 'subsurface', water_sonar: 'subsurface',
  water_dive: 'subsurface', premises_search: 'confined', technical_rope: 'point',
};

// ── Condition modifiers (multiplicative) ────────────────────────────────────
// `applies` narrows a modifier to the classes it can sensibly affect.
const MODIFIERS = {
  night:                { factor: 0.45, label: 'Night, no thermal',
                          skip: ['air_thermal'] },
  night_thermal:        { factor: 0.90, label: 'Night with thermal',
                          applies: ['air_thermal'] },
  dense_cover:          { factor: 0.55, label: 'Dense cover / woodland',
                          skip: ['water_sonar', 'water_dive'] },
  poor_visibility:      { factor: 0.70, label: 'Rain / poor visibility' },
  water_turbid:         { factor: 0.60, label: 'Turbid or weeded water',
                          applies: ['water_wade', 'water_sonar', 'water_dive', 'water_shoreline'] },
  // The Brantham subject was non-verbal, partially deaf and autistic. Any method
  // that leans on the subject answering is worth far less against him.
  subject_unresponsive: { factor: 0.60, label: 'Unresponsive subject (silent / non-verbal / unconscious)' },
  subject_small:        { factor: 0.75, label: 'Small subject, easily concealed' },
  subject_concealing:   { factor: 0.65, label: 'Subject likely to hide from searchers' },
};

const CORRELATION_DECAY = 0.7;   // per repeat of the same (class, method)
const DEFAULT_CLEAR_POD = 0.70;  // cumulative POD needed to mark complete
const DEFAULT_POA_OUTSIDE = 0.15;

const WATER_METHODS = new Set(['river_corridor', 'river_collection_point']);

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

/**
 * Effective POD for a single sweep, with a full derivation trail.
 * priorSameMethod = how many earlier sweeps of this zone used the same
 * (resource_class, method) pair — these are NOT independent looks.
 */
function computePod({ resource_class, method, conditions = [], coverage = 1, priorSameMethod = 0 }) {
  const cls = BASE_POD[resource_class];
  if (!cls) return { pod: 0, basis: { error: `unknown resource_class: ${resource_class}` } };
  const m = method || DEFAULT_METHOD[resource_class];
  const base = cls[m];
  if (base == null) {
    return { pod: 0, basis: { error: `resource_class ${resource_class} cannot perform method ${m}`,
      available: Object.keys(cls) } };
  }

  const applied = [];
  let factor = 1;
  for (const c of conditions) {
    const mod = MODIFIERS[c];
    if (!mod) continue;
    if (mod.applies && !mod.applies.includes(resource_class)) continue;
    if (mod.skip && mod.skip.includes(resource_class)) continue;
    factor *= mod.factor;
    applied.push({ key: c, label: mod.label, factor: mod.factor });
  }

  const cov = clamp01(Number(coverage) || 0);
  const corr = Math.pow(CORRELATION_DECAY, Math.max(0, priorSameMethod));
  const pod = clamp01(base * factor * cov * corr);

  return {
    pod: Number(pod.toFixed(4)),
    basis: {
      base, method: m, resource_class,
      modifiers: applied,
      modifier_product: Number(factor.toFixed(4)),
      coverage: cov,
      prior_same_method: priorSameMethod,
      correlation_penalty: Number(corr.toFixed(4)),
      note: priorSameMethod > 0
        ? 'Repeat of a method already used here — discounted, because the same method tends to miss the same places.'
        : undefined,
    },
  };
}

/** Cumulative POD over independent-ish sweeps: 1 - Π(1 - pod_i). */
function cumulativePod(sweeps) {
  let miss = 1;
  for (const s of sweeps) miss *= (1 - clamp01(Number(s.pod) || 0));
  return Number((1 - miss).toFixed(4));
}

/** How many earlier sweeps used this same class+method. */
function priorSameMethodCount(sweeps, resource_class, method) {
  const m = method || DEFAULT_METHOD[resource_class];
  return sweeps.filter(s => s.resource_class === resource_class
    && (s.method || DEFAULT_METHOD[s.resource_class]) === m).length;
}

/**
 * Does this zone need the subsurface gate?
 *
 * ⚠ Do NOT trust search_method alone. In the Brantham operation the single most
 * consequential water feature — Decoy Pond, where the child was found — was
 * typed as 'point_search' by the person building the plan, and so would have
 * escaped the water gate entirely. An operator remembering to pick the right
 * label is exactly the kind of dependency this module exists to remove.
 *
 * terrain_class is derived from OSM/terrain analysis, not from a dropdown, so
 * it is the more reliable signal. Any of these is enough:
 *   - a water search_method was chosen
 *   - the zone is explicitly flagged high_consequence
 *   - terrain analysis says the ground is water or intertidal
 *   - terrain composition shows a meaningful water fraction
 */
const WATER_TERRAIN = new Set(['water', 'intertidal']);
const WATER_FRACTION_GATE = 0.1;

function isWaterZone(zone) {
  if (!zone) return false;
  if (WATER_METHODS.has(zone.search_method)) return true;
  if (zone.high_consequence) return true;
  if (WATER_TERRAIN.has(zone.terrain_class)) return true;
  let comp = zone.terrain_composition;
  if (typeof comp === 'string') { try { comp = JSON.parse(comp); } catch { comp = null; } }
  if (comp && typeof comp === 'object') {
    const wet = (Number(comp.water) || 0) + (Number(comp.intertidal) || 0);
    if (wet >= WATER_FRACTION_GATE) return true;
  }
  return false;
}

/** Has any subsurface-capable resource swept this zone? */
function hasSubsurfaceSweep(sweeps) {
  return sweeps.some(s => RESOURCE_CLASSES[s.resource_class]?.subsurface);
}

/**
 * Residual probability across an operation.
 * Stored `poa` values are treated as RELATIVE WEIGHTS and normalised to
 * (1 - poa_outside), so operators can type any scale they like.
 */
function residuals(zones, { poa_outside = DEFAULT_POA_OUTSIDE } = {}) {
  const out = clamp01(poa_outside);
  const rawTotal = zones.reduce((s, z) => s + (Number(z.poa) || 0), 0);

  // No POA set anywhere → spread evenly rather than dividing by zero.
  const initial = zones.map((z) => {
    const w = rawTotal > 0 ? (Number(z.poa) || 0) / rawTotal : (zones.length ? 1 / zones.length : 0);
    return w * (1 - out);
  });

  const weights = zones.map((z, i) => initial[i] * (1 - clamp01(Number(z.cumulative_pod) || 0)));
  const total = weights.reduce((a, b) => a + b, 0) + out;

  const rows = zones.map((z, i) => ({
    zone_id: z.id,
    name: z.name,
    status: z.status,
    search_method: z.search_method,
    poa_initial: Number(initial[i].toFixed(4)),
    cumulative_pod: Number((Number(z.cumulative_pod) || 0).toFixed(4)),
    sweep_count: z.sweep_count || 0,
    poa_current: Number((total > 0 ? weights[i] / total : 0).toFixed(4)),
    // Signed change: positive means this zone got MORE likely because others cleared.
    poa_delta: Number(((total > 0 ? weights[i] / total : 0) - initial[i]).toFixed(4)),
    water: isWaterZone(z),
  }));

  rows.sort((a, b) => b.poa_current - a.poa_current);
  rows.forEach((r, i) => { r.rank = i + 1; });

  return {
    zones: rows,
    poa_outside_current: Number((total > 0 ? out / total : out).toFixed(4)),
    poa_outside_initial: Number(out.toFixed(4)),
    searched_fraction: Number((1 - (total - out) / (1 - out || 1)).toFixed(4)),
  };
}

/**
 * Can this zone be marked complete? Returns { ok, reasons[], … } — the API
 * hands the reasons straight back to the caller rather than warning and
 * letting it be clicked through.
 */
function clearanceCheck(zone, sweeps, { clear_pod = DEFAULT_CLEAR_POD } = {}) {
  const reasons = [];
  const cum = cumulativePod(sweeps);
  const accepted = !!zone.risk_accepted_by;

  if (accepted) {
    return { ok: true, via: 'risk_accepted', cumulative_pod: cum, reasons: [],
      accepted_by: zone.risk_accepted_by, accepted_reason: zone.risk_accepted_reason };
  }
  if (!sweeps.length) {
    reasons.push('No sweep has been recorded for this zone. Record what was actually done, or accept the risk by name.');
  } else if (cum < clear_pod) {
    reasons.push(`Cumulative POD is ${(cum * 100).toFixed(0)}%, below the ${(clear_pod * 100).toFixed(0)}% threshold for this operation. `
      + `${(100 - cum * 100).toFixed(0)}% of the original probability in this zone is still unaccounted for.`);
  }
  if (isWaterZone(zone) && !hasSubsurfaceSweep(sweeps)) {
    reasons.push('Water zone with no subsurface-capable sweep (wade/pole, sonar or dive). '
      + 'A shoreline search cannot clear water — this is the Brantham case exactly.');
  }
  return { ok: reasons.length === 0, via: 'evidence', cumulative_pod: cum, reasons };
}

module.exports = {
  WATER_TERRAIN, WATER_FRACTION_GATE,
  RESOURCE_CLASSES, BASE_POD, MODIFIERS, DEFAULT_METHOD,
  DEFAULT_CLEAR_POD, DEFAULT_POA_OUTSIDE, CORRELATION_DECAY,
  computePod, cumulativePod, priorSameMethodCount, residuals,
  clearanceCheck, isWaterZone, hasSubsurfaceSweep,
};
