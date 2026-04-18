// ── Smart-grid Tier B2 — tide-gated intertidal windows ──
//
// Given an intertidal cell (classified by terrainClassifier), ask: *when* is
// it actually walkable? A cell that's sand at low tide and 3 m of water at
// high tide is a useless assignment six hours out of twelve.
//
// Input: hourly sea-level forecast from /api/search/tide (Open-Meteo MSL
// proxied server-side). Output: an array of contiguous windows where the
// predicted sea level is below a searchable threshold.
//
// The threshold is a per-op dial (default 1.5 m MSL, which roughly matches
// MLWS on the Ayrshire coast). Lower = only bottom-of-tide is counted;
// higher = more generous windows but wetter feet.

import type { TideWindow, SearchableWindows } from "@/types/search";
export type { TideWindow, SearchableWindows };

export interface TidePoint {
  t: string;   // ISO-8601 UTC
  h_m: number; // sea level above MSL, metres
}

export interface TideForecast {
  lat: number;
  lon: number;
  source: string;
  fetched_at: string;
  points: TidePoint[];
}

// Default threshold — 1.5 m MSL, which roughly matches MLWS on the Ayrshire
// coast. Operator-tunable later; for now one-size-fits-coast.
export const DEFAULT_THRESHOLD_M = 1.5;
export const TIDE_TTL_MINUTES = 30;

// Fetch once per AOI centre — callers should memoise by rounded lat/lon.
export async function fetchTide(lat: number, lon: number): Promise<TideForecast | null> {
  try {
    const r = await fetch(`/api/search/tide?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.points)) return null;
    return j as TideForecast;
  } catch {
    return null;
  }
}

// Compute contiguous runs where sea level < threshold. We interpolate around
// threshold crossings so windows don't snap only to the hourly grid — a cell
// that's searchable from 04:37 to 09:12 reads cleanly as that, not "05:00 to
// 09:00 (ish)".
export function computeSearchableWindows(
  forecast: TideForecast,
  thresholdM: number,
): TideWindow[] {
  const pts = forecast.points;
  if (pts.length < 2) return [];
  const windows: TideWindow[] = [];
  let cur: { startMs: number; endMs: number; minH: number; maxH: number } | null = null;

  const toMs = (iso: string) => new Date(iso).getTime();
  const interpCrossing = (a: TidePoint, b: TidePoint, th: number): number => {
    // Linear interpolation between two samples either side of the threshold.
    const ta = toMs(a.t), tb = toMs(b.t);
    const ha = a.h_m, hb = b.h_m;
    if (hb === ha) return ta;
    const f = (th - ha) / (hb - ha);
    return ta + f * (tb - ta);
  };

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[i - 1];
    const below = p.h_m <= thresholdM;

    if (below && !cur) {
      // Window opens. Use interpolated crossing if we came from above.
      const startMs = prev && prev.h_m > thresholdM
        ? interpCrossing(prev, p, thresholdM)
        : toMs(p.t);
      cur = { startMs, endMs: toMs(p.t), minH: p.h_m, maxH: p.h_m };
    } else if (below && cur) {
      cur.endMs = toMs(p.t);
      if (p.h_m < cur.minH) cur.minH = p.h_m;
      if (p.h_m > cur.maxH) cur.maxH = p.h_m;
    } else if (!below && cur) {
      // Window closes. Interpolate out.
      cur.endMs = prev ? interpCrossing(prev, p, thresholdM) : cur.endMs;
      windows.push({
        start_iso: new Date(cur.startMs).toISOString(),
        end_iso: new Date(cur.endMs).toISOString(),
        min_height_m: Math.round(cur.minH * 100) / 100,
        max_height_m: Math.round(cur.maxH * 100) / 100,
      });
      cur = null;
    }
  }
  if (cur) {
    windows.push({
      start_iso: new Date(cur.startMs).toISOString(),
      end_iso: new Date(cur.endMs).toISOString(),
      min_height_m: Math.round(cur.minH * 100) / 100,
      max_height_m: Math.round(cur.maxH * 100) / 100,
    });
  }
  return windows;
}

// Build the persisted wrapper from a forecast + windows pair. This is what
// gets written to the zone's `searchable_windows` column so the server and
// later UI passes can read predictions without re-fetching.
export function buildSearchableWindows(
  forecast: TideForecast | null,
  windows: TideWindow[],
  thresholdM: number,
): SearchableWindows {
  if (!forecast) {
    return {
      source: "unavailable",
      centre: null,
      threshold_m: thresholdM,
      windows: [],
      generated_at: new Date().toISOString(),
      ttl_minutes: TIDE_TTL_MINUTES,
    };
  }
  return {
    source: "open-meteo marine",
    centre: { lat: forecast.lat, lon: forecast.lon },
    threshold_m: thresholdM,
    windows,
    generated_at: forecast.fetched_at,
    ttl_minutes: TIDE_TTL_MINUTES,
  };
}

export type WindowState = "now" | "upcoming" | "past";

export interface WindowStatus {
  state: WindowState;
  window: TideWindow | null;     // the currently-active window (if state='now') or the next upcoming one
  mins_remaining: number | null; // only for state='now' — minutes until the current window ends
  mins_until: number | null;     // only for state='upcoming' — minutes until the next window begins
}

// Pick the operator-relevant window given "now". State machine is:
//  - if now falls inside a window, state=now + mins_remaining
//  - else if any future window exists, state=upcoming + mins_until (to its start)
//  - else state=past (last window already ended — next tide cycle off-forecast)
export function nextSearchableWindow(
  windows: TideWindow[],
  nowMs = Date.now(),
): WindowStatus {
  for (const w of windows) {
    const sMs = new Date(w.start_iso).getTime();
    const eMs = new Date(w.end_iso).getTime();
    if (nowMs >= sMs && nowMs <= eMs) {
      return {
        state: "now",
        window: w,
        mins_remaining: Math.max(0, Math.round((eMs - nowMs) / 60000)),
        mins_until: null,
      };
    }
  }
  const future = windows.find((w) => new Date(w.start_iso).getTime() > nowMs);
  if (future) {
    return {
      state: "upcoming",
      window: future,
      mins_remaining: null,
      mins_until: Math.round((new Date(future.start_iso).getTime() - nowMs) / 60000),
    };
  }
  return { state: "past", window: null, mins_remaining: null, mins_until: null };
}

// Compact human label — used in zone tooltips and the intertidal badge.
//   state=now      → "walkable now · 47 min left"
//   state=upcoming → "walkable 04:37–09:12 · in 2h 11m"
//   state=past     → "no walkable window in 3d forecast"
export function formatWindowStatus(st: WindowStatus): string {
  if (st.state === "past" || !st.window) {
    return "no walkable window in forecast";
  }
  const w = st.window;
  const s = new Date(w.start_iso);
  const e = new Date(w.end_iso);
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const minsToStr = (m: number): string => {
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
  };
  if (st.state === "now") {
    return `walkable now · ${minsToStr(st.mins_remaining ?? 0)} left (ends ${hhmm(e)})`;
  }
  return `walkable ${hhmm(s)}–${hhmm(e)} · in ${minsToStr(st.mins_until ?? 0)}`;
}

// Colour hint for the optional "tide state" overlay on intertidal zones.
//   now      → green tint (go now)
//   upcoming → amber tint (wait)
//   past     → grey tint (off-forecast / unusable today)
export const TIDE_STATE_FILL: Record<WindowState, string> = {
  now: "#22c55e",      // green-500
  upcoming: "#f59e0b", // amber-500 (same as intertidal base)
  past: "#6b7280",     // neutral grey
};
