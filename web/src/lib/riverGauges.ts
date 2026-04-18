// ── Smart-grid Tier B3 — river gauge lookup ──
//
// When an operator plans a river-corridor search, the first question is "how
// fast is it running today?" Historically that meant a phone call to SEPA,
// squinting at the EA flood-monitoring map, or an educated guess from the
// velocity presets. B3 pulls live stage from both sources into the planner so
// the operator can *see* the reading next to the velocity picker.
//
// Deliberately we do NOT auto-pick a velocity preset from gauge stage — there
// is no universal stage→velocity rating without per-site curves, and the
// `NO FABRICATED DATA` rule is hard. Instead we surface trend + stage as
// context, and the operator stays in charge of the preset.
//
// Backend: server/search-helpers.js `GET /api/search/gauges?bbox=s,w,n,e`
// merges SEPA KiWIS and EA flood-monitoring, returning the top ~15 closest
// stations with a 6h series. `partial=true` when one source failed.
//
// Cache: no client-side cache — the endpoint already caches upstream (station
// lists 24h, readings 10min). A fresh fetch per corridor change is fine.

import { searchHelpers } from "@/lib/api";

export type GaugeTrend = "rising" | "falling" | "steady" | "unknown";
export type GaugeState = "normal" | "elevated" | "high" | "spate" | "unknown";
export type GaugeSource = "SEPA" | "EA";

export interface GaugeReading {
  time: string;           // ISO-8601 UTC
  stage_m: number | null; // metres, site-specific datum
  flow_cumecs: number | null;
}

export interface RiverGauge {
  id: string;             // "sepa:36164" / "ea:E21779"
  label: string;
  lat: number;
  lon: number;
  source: GaugeSource;
  latest: GaugeReading | null;
  series: GaugeReading[]; // last ~6h, oldest first
  trend: GaugeTrend;
  state: GaugeState;
  thresholds?: { percentile_95_m?: number | null; typical_max_m?: number | null };
}

export interface GaugeFetchResult {
  gauges: RiverGauge[];
  bbox: [number, number, number, number];
  generated_at: string;
  partial: boolean;       // true if SEPA or EA (but not both) failed
  errors: string[];
}

export async function fetchGauges(
  bbox: [number, number, number, number],
): Promise<GaugeFetchResult | null> {
  try {
    const r = await searchHelpers.gauges(bbox);
    return r as GaugeFetchResult;
  } catch {
    return null;
  }
}

// Great-circle distance in metres. Same haversine the server uses for ranking
// — we duplicate it client-side so the "nearest to LKP" pick doesn't require
// another round-trip when the operator nudges the datum.
export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const la1 = toRad(aLat);
  const la2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface NearestGauge {
  gauge: RiverGauge;
  distance_m: number;
}

// Pick the closest gauge to a point (LKP). Only considers gauges with a
// non-null `latest.stage_m` — a station with no recent reading is noise.
export function nearestGauge(
  gauges: RiverGauge[],
  lat: number,
  lon: number,
): NearestGauge | null {
  let best: NearestGauge | null = null;
  for (const g of gauges) {
    if (!g.latest || g.latest.stage_m == null) continue;
    const d = haversineM(lat, lon, g.lat, g.lon);
    if (!best || d < best.distance_m) best = { gauge: g, distance_m: d };
  }
  return best;
}

// Human-friendly chip label. Examples:
//   "0.78 m · steady · Mainholm (SEPA) · 4 km · 14 min ago"
//   "2.14 m · rising · Auchendrane (SEPA) · 7 km · 8 min ago"
//   "no recent reading · Mainholm (SEPA) · 4 km"
export function gaugeStateLabel(n: NearestGauge, nowMs = Date.now()): string {
  const { gauge, distance_m } = n;
  const kmStr = distance_m < 1000
    ? `${Math.round(distance_m)} m`
    : `${(distance_m / 1000).toFixed(1)} km`;
  const src = `${gauge.label} (${gauge.source})`;
  if (!gauge.latest || gauge.latest.stage_m == null) {
    return `no recent reading · ${src} · ${kmStr}`;
  }
  const stageStr = `${gauge.latest.stage_m.toFixed(2)} m`;
  const ageMin = Math.max(0, Math.round((nowMs - new Date(gauge.latest.time).getTime()) / 60000));
  const ageStr = ageMin < 60
    ? `${ageMin} min ago`
    : ageMin < 1440
      ? `${Math.round(ageMin / 60)} h ago`
      : `${Math.round(ageMin / 1440)} d ago`;
  return `${stageStr} · ${gauge.trend} · ${src} · ${kmStr} · ${ageStr}`;
}

// Colour hint for gauge chips, keyed by trend. Kept subtle — a corridor panel
// is already dense; we don't want the gauge screaming over the warnings.
export const GAUGE_TREND_FILL: Record<GaugeTrend, string> = {
  rising: "#3b82f6",   // blue-500 — water's coming up, operator should watch
  falling: "#84cc16",  // lime-500 — water's easing
  steady: "#6b7280",   // neutral grey
  unknown: "#6b7280",
};

// Operator hint — *suggestion* only. Maps gauge trend/stage to a preset id
// the operator may choose to apply, with a rationale. We never mutate the
// form from here; the caller decides.
//
// Rules (deliberately conservative — we don't have rating curves):
//   trend=rising        → "fast" preset, rationale cites rising stage
//   trend=falling       → "normal" preset, rationale cites falling stage
//   trend=steady/unknown → no suggestion — operator's call from local memory
export interface GaugeSuggestion {
  preset_id: "slow_meander" | "pool" | "normal" | "fast" | "spate" | null;
  rationale: string;
}

// Build a normalised polyline for an inline SVG sparkline. Takes the gauge's
// series (oldest-first, stage_m nullable) and maps it into the supplied box.
// Returns the polyline points plus min/max/delta hints so the caller can
// render a hover title like "0.77 → 0.82 m over 6h (+0.05)".
//   - Drops nulls first; if <2 points remain, returns null (don't draw a line).
//   - Y axis is autoscaled with a tiny (2%) padding so flat traces still show.
//   - X is evenly spaced by index — we assume the backend's 15-min cadence
//     is roughly regular; occasional missing samples distort by <5% and
//     aren't worth the cost of timestamp-based spacing for a 40×14 sparkline.
export interface SparklineData {
  points: string;              // "x,y x,y ..." for <polyline>
  min_m: number;
  max_m: number;
  delta_m: number;             // last - first
  sample_count: number;
}

export function gaugeSparkline(
  gauge: RiverGauge,
  width = 48,
  height = 14,
  pad = 1,
): SparklineData | null {
  const rows = gauge.series.filter((r) => r.stage_m != null) as Array<{ stage_m: number }>;
  if (rows.length < 2) return null;
  const ys = rows.map((r) => r.stage_m);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 0.02; // avoid div-by-zero; 2cm minimum band
  const padded = span * 1.02;
  const midBase = (min + max) / 2 - padded / 2;
  const innerH = height - 2 * pad;
  const innerW = width - 2 * pad;
  const step = rows.length > 1 ? innerW / (rows.length - 1) : 0;
  const points = rows.map((r, i) => {
    const x = pad + i * step;
    // Flip Y — SVG origin is top-left.
    const y = pad + innerH - ((r.stage_m - midBase) / padded) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return {
    points,
    min_m: min,
    max_m: max,
    delta_m: ys[ys.length - 1] - ys[0],
    sample_count: rows.length,
  };
}

export function gaugeSuggestPreset(gauge: RiverGauge): GaugeSuggestion {
  if (!gauge.latest || gauge.latest.stage_m == null) {
    return { preset_id: null, rationale: "no recent reading — pick from local knowledge" };
  }
  const stage = gauge.latest.stage_m.toFixed(2);
  if (gauge.trend === "rising") {
    return {
      preset_id: "fast",
      rationale: `stage rising at ${stage} m — water's coming up, consider a faster preset`,
    };
  }
  if (gauge.trend === "falling") {
    return {
      preset_id: "normal",
      rationale: `stage falling at ${stage} m — likely easing off, normal-flow baseline`,
    };
  }
  return {
    preset_id: null,
    rationale: `stage steady at ${stage} m — pick from local knowledge of the water`,
  };
}
