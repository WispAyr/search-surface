"use client";

// Conditions strip — compact band under the operation header. Surfaces the
// four things a SAR IC needs at a glance before every deploy/rotate decision:
//
//   1. Light remaining (sunset / civil twilight countdown) — the hardest
//      constraint in a ground SAR op. Teams must be out or extracted before
//      dark; underestimating this is the most common cause of last-light calls.
//   2. Wind — relevant to scent tracking, drone flight, rotor ops, helo LZ.
//   3. Visibility — drives search spacing + whether aerial sweeps are viable.
//   4. Precipitation / storm watch — water hazard, hypothermia risk,
//      lightning abort trigger.
//
// Intentionally skinny: one row, always visible, readable on mobile. The full
// METAR + storm detail lives in the Conditions side panel — tapping the strip
// jumps the operator there.

import { useEffect, useState } from "react";
import { siphon, prism, type MetarData, type AstroSun } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation } from "@/types/search";
import { Wind, Eye, Sunset, CloudRain, AlertTriangle, Thermometer } from "lucide-react";

const WIND_DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const windDirLabel = (deg: number) => WIND_DIRS[Math.round(deg / 22.5) % 16];

function fmtCountdown(toMs: number): string {
  const deltaMin = Math.round((toMs - Date.now()) / 60_000);
  if (deltaMin <= 0) return "now";
  const h = Math.floor(deltaMin / 60);
  const m = deltaMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

interface ConditionsStripProps {
  operation: SearchOperation;
}

export function ConditionsStrip({ operation }: ConditionsStripProps) {
  const setRightPanel = useSearchStore((s) => s.setRightPanel);
  const setMobilePanelOpen = useSearchStore((s) => s.setMobilePanelOpen);

  const [metar, setMetar] = useState<MetarData | null>(null);
  const [sun, setSun] = useState<AstroSun | null>(null);
  const [storm, setStorm] = useState<{ score?: number; verdict?: string; descriptor?: string } | null>(null);
  const [, setTick] = useState(0);

  // Prefer the operation's primary datum for sun calc — if the search is in
  // the highlands and the nearest METAR station is at sea-level Prestwick, the
  // sunset still matches local geography within ~1 minute for any reasonable
  // op radius.
  const lat = operation.datum_lat;
  const lon = operation.datum_lon;

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [m, s, st] = await Promise.allSettled([
        siphon.metar("EGPK"),
        siphon.sunPosition(lat ?? undefined, lon ?? undefined),
        prism.stormWatch("ayrshire"),
      ]);
      if (!mounted) return;
      if (m.status === "fulfilled") setMetar((m.value as any)?.data || m.value);
      if (s.status === "fulfilled") setSun((s.value as any)?.data || s.value);
      if (st.status === "fulfilled") setStorm((st.value as any)?.data || st.value);
    }
    load();
    // Refresh every 5 min — METAR updates every half hour, sun times are
    // stable for hours, but a stale strip during a 12-hour op is worse than
    // a cheap periodic refetch.
    const iv = setInterval(load, 300_000);
    return () => { mounted = false; clearInterval(iv); };
  }, [lat, lon]);

  // 60s tick so the sunset countdown ages without waiting for refetch.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!metar && !sun && !storm) return null;

  // ── Light remaining ──
  // Prefer sunset. Once sunset passes, show civil twilight (useable light
  // with caveats). After civil end, show "dark" in red.
  let lightLabel: string | null = null;
  let lightCritical = false;
  let lightUrgent = false;
  if (sun) {
    const now = Date.now();
    const sunsetMs = new Date(sun.sunset).getTime();
    const civilEndMs = new Date(sun.civil_twilight_end).getTime();
    const sunriseMs = sun.sunrise ? new Date(sun.sunrise).getTime() : null;
    // Pre-dawn: API returns the *next* sunrise + sunset, so sunset can be
    // ~18h away during the night. Only call it "Sunset in X" when sunrise
    // has already passed (i.e. we're genuinely in daylight).
    const isDaytime = sunriseMs !== null ? sunriseMs <= now && now < sunsetMs : now < sunsetMs;
    if (isDaytime) {
      lightLabel = `Sunset in ${fmtCountdown(sunsetMs)}`;
      if (sunsetMs - now < 60 * 60_000) lightUrgent = true;   // < 1 hour
      if (sunsetMs - now < 30 * 60_000) lightCritical = true; // < 30 min
    } else if (now < civilEndMs) {
      lightLabel = `Dusk · dark in ${fmtCountdown(civilEndMs)}`;
      lightUrgent = true;
      if (civilEndMs - now < 15 * 60_000) lightCritical = true;
    } else {
      // Past civil end — show sunrise time tomorrow if available.
      const sunriseMs = new Date(sun.sunrise).getTime();
      if (sunriseMs > now) {
        lightLabel = `Dark · sunrise in ${fmtCountdown(sunriseMs)}`;
      } else {
        lightLabel = "Dark";
      }
      lightCritical = true;
    }
  }

  // ── Wind ──
  const wind = metar && typeof metar.wind_speed === "number"
    ? `${windDirLabel(metar.wind_direction)} ${Math.round(metar.wind_speed)}${metar.wind_unit || "kt"}`
    : null;
  const gust = metar && typeof metar.wind_gust === "number" ? metar.wind_gust : null;
  const windCritical = gust != null && gust > 35;
  const windUrgent = !windCritical && metar != null && typeof metar.wind_speed === "number" && metar.wind_speed > 25;

  // ── Visibility ──
  const vis = metar && typeof metar.visibility_m === "number"
    ? (metar.visibility_m >= 10000 ? "10km+" : metar.visibility_m >= 1000 ? `${(metar.visibility_m / 1000).toFixed(1)}km` : `${metar.visibility_m}m`)
    : null;
  const visCritical = metar != null && typeof metar.visibility_m === "number" && metar.visibility_m < 1500;
  const visUrgent = !visCritical && metar != null && typeof metar.visibility_m === "number" && metar.visibility_m < 5000;

  // ── Temp ──
  const temp = metar && typeof metar.temperature_c === "number" ? `${Math.round(metar.temperature_c)}°` : null;
  const tempUrgent = metar != null && typeof metar.temperature_c === "number" && metar.temperature_c < 5;
  const tempCritical = metar != null && typeof metar.temperature_c === "number" && metar.temperature_c < 0;

  // ── Precip / weather phenomena ──
  const weather = (metar as any)?.weather as string[] | undefined;
  const hasPrecip = !!weather?.some((w) => /rain|snow|drizzle|sleet|hail|storm|shower/i.test(w));

  // ── Storm score ──
  const stormScore = storm && typeof storm.score === "number" ? storm.score : null;
  const stormLabel = storm?.verdict || storm?.descriptor;
  const stormUrgent = stormScore != null && stormScore >= 0.3;
  const stormCritical = stormScore != null && stormScore >= 0.6;

  const openConditions = () => {
    setRightPanel("conditions");
    setMobilePanelOpen(true);
  };

  // Order: light first (the hardest constraint), then wind, vis, temp, precip.
  return (
    <button
      onClick={openConditions}
      className="w-full flex items-center gap-3 px-3 py-1 border-b border-surface-700 bg-surface-900/70 text-[11px] overflow-x-auto scrollbar-thin text-left"
      title="Open conditions panel"
    >
      {lightLabel && (
        <Chip
          icon={<Sunset size={11} />}
          label={lightLabel}
          critical={lightCritical}
          urgent={lightUrgent}
          primary
        />
      )}
      {wind && (
        <Chip
          icon={<Wind size={11} />}
          label={`${wind}${gust ? `g${Math.round(gust)}` : ""}`}
          critical={windCritical}
          urgent={windUrgent}
        />
      )}
      {vis && (
        <Chip
          icon={<Eye size={11} />}
          label={vis}
          critical={visCritical}
          urgent={visUrgent}
        />
      )}
      {temp && (
        <Chip
          icon={<Thermometer size={11} />}
          label={temp}
          critical={tempCritical}
          urgent={tempUrgent}
        />
      )}
      {hasPrecip && weather && (
        <Chip
          icon={<CloudRain size={11} />}
          label={weather[0]}
          urgent
        />
      )}
      {stormUrgent && stormLabel && (
        <Chip
          icon={<AlertTriangle size={11} />}
          label={stormLabel}
          critical={stormCritical}
          urgent={!stormCritical}
        />
      )}
    </button>
  );
}

function Chip({
  icon,
  label,
  critical,
  urgent,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  critical?: boolean;
  urgent?: boolean;
  primary?: boolean;
}) {
  const tone = critical
    ? "text-red-300"
    : urgent
      ? "text-amber-300"
      : primary
        ? "text-fg-1"
        : "text-fg-3";
  return (
    <span className={`shrink-0 flex items-center gap-1 font-medium whitespace-nowrap ${tone}`}>
      {icon}
      {label}
    </span>
  );
}
