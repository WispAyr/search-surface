"use client";

import { useEffect, useState, useMemo } from "react";
import { siphon, prism } from "@/lib/api";
import type { SearchOperation } from "@/types/search";
import {
  Sun, Moon, Cloud, CloudRain, Wind, Thermometer, Eye, Droplets,
  Clock, AlertTriangle, ChevronDown, ChevronUp, Compass, Timer,
  Snowflake, Zap, Dog, Gauge, Mountain, ArrowDown, ArrowUp, Radio, Activity,
} from "lucide-react";

interface ConditionsData {
  weather: any;
  sun: any;
  metar: any;
  stormWatch: any;
  windConsensus: any;
}

// Wind direction to compass label
function windDir(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Scent behaviour classification based on conditions
function scentAssessment(temp: number, humidity: number, windSpeed: number, cloudCover: number): {
  rating: string; color: string; factors: string[];
} {
  const factors: string[] = [];
  let score = 50;

  // Temperature: 5-20°C optimal for scent
  if (temp >= 5 && temp <= 20) { score += 15; factors.push("Temperature in optimal scent range"); }
  else if (temp < 0) { score -= 20; factors.push("Freezing temps suppress scent volatility"); }
  else if (temp > 25) { score -= 10; factors.push("High temp causes rapid scent dissipation"); }
  else { factors.push("Temperature marginal for scent work"); }

  // Humidity: 40-80% optimal
  if (humidity >= 40 && humidity <= 80) { score += 15; factors.push("Humidity aids scent particle suspension"); }
  else if (humidity > 90) { score -= 5; factors.push("Very high humidity — scent may pool at ground level"); }
  else if (humidity < 30) { score -= 15; factors.push("Low humidity — rapid scent evaporation"); }

  // Wind: 3-15 mph ideal for air-scent dogs
  if (windSpeed >= 3 && windSpeed <= 15) { score += 15; factors.push("Wind carries scent cone effectively"); }
  else if (windSpeed < 3) { score -= 10; factors.push("Calm air — scent pools, no directional cone"); }
  else if (windSpeed > 25) { score -= 15; factors.push("High wind shreds scent cone — trailing dogs preferred"); }
  else { score -= 5; factors.push("Moderate-high wind — reduced scent cone range"); }

  // Cloud cover: overcast better (stable air, less convection)
  if (cloudCover > 70) { score += 5; factors.push("Overcast — stable air layer holds scent low"); }
  else if (cloudCover < 20) { score -= 5; factors.push("Clear sky — thermal convection lifts scent vertically"); }

  if (score >= 70) return { rating: "Excellent", color: "text-green-400", factors };
  if (score >= 55) return { rating: "Good", color: "text-blue-400", factors };
  if (score >= 40) return { rating: "Fair", color: "text-amber-400", factors };
  return { rating: "Poor", color: "text-red-400", factors };
}

// Subject survival estimate (simplified)
function survivalAssessment(temp: number, feelsLike: number, rain: number, windSpeed: number): {
  risk: string; color: string; notes: string[];
} {
  const notes: string[] = [];
  let risk = "Low";
  let color = "text-green-400";

  if (feelsLike < 0) { risk = "Critical"; color = "text-red-400"; notes.push("Hypothermia risk — sub-zero wind chill"); }
  else if (feelsLike < 5) { risk = "High"; color = "text-orange-400"; notes.push("Hypothermia risk within 2-4 hours if immobile"); }
  else if (feelsLike < 10) { risk = "Moderate"; color = "text-amber-400"; notes.push("Hypothermia possible if wet or injured"); }
  else { notes.push("Temperature not immediately life-threatening"); }

  if (rain > 2) { notes.push("Active precipitation — accelerates heat loss"); if (risk === "Low") { risk = "Moderate"; color = "text-amber-400"; } }
  if (windSpeed > 20) { notes.push("High wind exposure — seek sheltered areas first"); }
  if (temp > 25) { notes.push("Heat exhaustion risk — check water sources"); risk = "Moderate"; color = "text-amber-400"; }

  return { risk, color, notes };
}

export function SearchConditions({ operation }: { operation: SearchOperation }) {
  const [data, setData] = useState<ConditionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    light: true, weather: true, storm: true, scent: true, survival: true, drone: true, forecast: false, detail: false,
  });

  useEffect(() => {
    let mounted = true;
    async function fetchAll() {
      try {
        const [weather, sun, metar, stormWatch, windConsensus] = await Promise.allSettled([
          siphon.weather("ayr"),
          siphon.sunPosition(),
          siphon.metar("EGPK"),
          prism.stormWatch("ayrshire"),
          prism.windConsensus("ayrshire"),
        ]);
        if (mounted) {
          setData({
            weather: weather.status === "fulfilled" ? weather.value : null,
            sun: sun.status === "fulfilled" ? sun.value : null,
            metar: metar.status === "fulfilled" ? metar.value : null,
            stormWatch: stormWatch.status === "fulfilled" ? stormWatch.value : null,
            windConsensus: windConsensus.status === "fulfilled" ? windConsensus.value : null,
          });
        }
      } catch {}
      if (mounted) setLoading(false);
    }
    fetchAll();
    const iv = setInterval(fetchAll, 120000); // refresh every 2min
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  const toggle = (key: string) => setExpanded((s) => ({ ...s, [key]: !s[key] }));

  if (loading) return <div className="p-3 text-xs text-fg-4">Loading conditions...</div>;
  if (!data) return <div className="p-3 text-xs text-fg-4">Conditions unavailable</div>;

  const w = data.weather?.forecast?.current || data.weather?.data?.forecast?.current || {};
  const sun = data.sun?.data || data.sun || {};
  const metar = data.metar?.data || data.metar || {};
  const hourly = data.weather?.forecast?.hourly || data.weather?.data?.forecast?.hourly || {};

  // Current conditions
  const temp = w.temperature_2m ?? metar.temperature_c;
  const feelsLike = w.apparent_temperature;
  const humidity = w.relative_humidity_2m ?? metar.dewpoint_c;
  const windSpeed = w.wind_speed_10m ?? metar.wind_speed;
  const windGust = w.wind_gusts_10m ?? metar.wind_gust;
  const windDirection = w.wind_direction_10m ?? metar.wind_direction;
  const visibility = w.visibility;
  const cloudCover = w.cloud_cover;
  const precipitation = w.precipitation;
  const pressure = w.surface_pressure ?? metar.pressure_hpa;

  // Light calculations
  const now = new Date();
  const sunset = sun.sunset ? new Date(sun.sunset) : null;
  const sunrise = sun.sunrise ? new Date(sun.sunrise) : null;
  const civilEnd = sun.civil_twilight_end ? new Date(sun.civil_twilight_end) : null;
  const isDaytime = sunrise && sunset && now > sunrise && now < sunset;
  const minsToSunset = sunset ? Math.round((sunset.getTime() - now.getTime()) / 60000) : null;
  const minsToCivilEnd = civilEnd ? Math.round((civilEnd.getTime() - now.getTime()) / 60000) : null;
  const dayLengthH = sun.day_length_hours;

  // Scent conditions
  const scent = temp != null && humidity != null && windSpeed != null && cloudCover != null
    ? scentAssessment(temp, humidity, windSpeed, cloudCover) : null;

  // Survival
  const survival = temp != null && feelsLike != null
    ? survivalAssessment(temp, feelsLike, precipitation || 0, windSpeed || 0) : null;

  // Forecast hours
  const forecastHours: { time: string; temp: number; wind: number; rain: number; cloud: number }[] = [];
  if (hourly?.time) {
    const nowIdx = hourly.time.findIndex((t: string) => new Date(t) >= now);
    for (let i = Math.max(0, nowIdx); i < Math.min(nowIdx + 12, hourly.time.length); i++) {
      forecastHours.push({
        time: hourly.time[i],
        temp: hourly.temperature_2m?.[i],
        wind: hourly.wind_speed_10m?.[i],
        rain: hourly.precipitation?.[i],
        cloud: hourly.cloud_cover?.[i],
      });
    }
  }

  return (
    <div className="space-y-1">
      {/* ── LIGHT & TIME ── */}
      <Section title="Light & Time" icon={<Sun size={12} />} open={expanded.light} toggle={() => toggle("light")}>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Status" value={isDaytime ? "Daylight" : "Dark"} icon={isDaytime ? <Sun size={10} className="text-amber-400" /> : <Moon size={10} className="text-blue-300" />} />
          {minsToSunset !== null && minsToSunset > 0 && (
            <Stat
              label="Sunset in"
              value={minsToSunset > 60 ? `${Math.floor(minsToSunset / 60)}h ${minsToSunset % 60}m` : `${minsToSunset}m`}
              icon={<Timer size={10} className={minsToSunset < 60 ? "text-red-400" : minsToSunset < 120 ? "text-amber-400" : "text-fg-4"} />}
              alert={minsToSunset < 60 ? "critical" : minsToSunset < 120 ? "warn" : undefined}
            />
          )}
          {minsToSunset !== null && minsToSunset <= 0 && sunrise && (
            <Stat label="Sunrise" value={sunrise.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} icon={<Sun size={10} className="text-amber-400" />} />
          )}
          {minsToCivilEnd !== null && minsToCivilEnd > 0 && (
            <Stat
              label="Usable light"
              value={minsToCivilEnd > 60 ? `${Math.floor(minsToCivilEnd / 60)}h ${minsToCivilEnd % 60}m` : `${minsToCivilEnd}m`}
              icon={<Eye size={10} />}
              sub="civil twilight"
            />
          )}
          {dayLengthH && <Stat label="Day length" value={`${dayLengthH.toFixed(1)}h`} icon={<Clock size={10} />} />}
        </div>
        {minsToSunset !== null && minsToSunset > 0 && minsToSunset < 120 && (
          <Alert level="warn">Less than 2 hours of daylight remaining. Consider night search resources.</Alert>
        )}
      </Section>

      {/* ── CURRENT WEATHER ── */}
      <Section title="Current Conditions" icon={<Cloud size={12} />} open={expanded.weather} toggle={() => toggle("weather")}>
        <div className="grid grid-cols-3 gap-2">
          {temp != null && <Stat label="Temperature" value={`${temp.toFixed(1)}°C`} icon={<Thermometer size={10} className={temp < 5 ? "text-blue-400" : temp > 25 ? "text-red-400" : "text-fg-4"} />} />}
          {feelsLike != null && <Stat label="Feels like" value={`${feelsLike.toFixed(1)}°C`} icon={<Thermometer size={10} />} sub={feelsLike < 0 ? "WIND CHILL" : undefined} alert={feelsLike < 0 ? "critical" : feelsLike < 5 ? "warn" : undefined} />}
          {humidity != null && <Stat label="Humidity" value={`${Math.round(humidity)}%`} icon={<Droplets size={10} />} />}
          {windSpeed != null && <Stat label="Wind" value={`${Math.round(windSpeed)} mph`} icon={<Wind size={10} className={windSpeed > 25 ? "text-red-400" : "text-fg-4"} />} sub={windDirection != null ? windDir(windDirection) : undefined} />}
          {windGust != null && windGust > 0 && <Stat label="Gusts" value={`${Math.round(windGust)} mph`} icon={<Wind size={10} />} alert={windGust > 40 ? "critical" : windGust > 30 ? "warn" : undefined} />}
          {windDirection != null && <Stat label="Direction" value={`${windDir(windDirection)} (${Math.round(windDirection)}°)`} icon={<Compass size={10} />} />}
          {visibility != null && <Stat label="Visibility" value={visibility >= 1000 ? `${(visibility / 1000).toFixed(1)} km` : `${visibility} m`} icon={<Eye size={10} className={visibility < 500 ? "text-red-400" : visibility < 2000 ? "text-amber-400" : "text-fg-4"} />} alert={visibility < 500 ? "critical" : visibility < 2000 ? "warn" : undefined} />}
          {cloudCover != null && <Stat label="Cloud" value={`${Math.round(cloudCover)}%`} icon={<Cloud size={10} />} />}
          {precipitation != null && <Stat label="Rain" value={`${precipitation.toFixed(1)} mm`} icon={<CloudRain size={10} className={precipitation > 2 ? "text-blue-400" : "text-fg-4"} />} />}
          {pressure != null && <Stat label="Pressure" value={`${Math.round(pressure)} hPa`} icon={<Gauge size={10} />} sub={pressure < 1000 ? "Low" : pressure > 1020 ? "High" : "Normal"} />}
        </div>
        {visibility != null && visibility < 500 && (
          <Alert level="critical">Very poor visibility ({visibility}m). Helicopter and drone ops may be grounded.</Alert>
        )}
        {windSpeed != null && windSpeed > 30 && (
          <Alert level="critical">Severe wind. Suspend drone operations. Searcher safety risk.</Alert>
        )}
        {precipitation != null && precipitation > 5 && (
          <Alert level="warn">Heavy precipitation — scent washing, hypothermia risk elevated.</Alert>
        )}
      </Section>

      {/* ── STORM INTELLIGENCE (Prism lenses) ── */}
      {(data.stormWatch?.data || data.windConsensus?.data) && (
        <Section title="Storm Intelligence" icon={<Activity size={12} />} open={expanded.storm} toggle={() => toggle("storm")}>
          <StormIntelligence stormWatch={data.stormWatch?.data} windConsensus={data.windConsensus?.data} />
        </Section>
      )}

      {/* ── K9 / SCENT CONDITIONS ── */}
      {scent && (
        <Section title="K9 Scent Conditions" icon={<Dog size={12} />} open={expanded.scent} toggle={() => toggle("scent")}>
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-lg font-bold ${scent.color}`}>{scent.rating}</span>
            <span className="text-xs text-fg-4">for air-scent dog work</span>
          </div>
          <div className="space-y-1">
            {scent.factors.map((f, i) => (
              <div key={i} className="text-[10px] text-fg-3 flex items-start gap-1.5">
                <span className="text-fg-4 mt-0.5">•</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
          {windSpeed != null && windSpeed < 3 && (
            <Alert level="info">Calm conditions — trailing dogs will outperform air-scent dogs. Use track-following strategy.</Alert>
          )}
          {windSpeed != null && windSpeed > 20 && (
            <Alert level="warn">Strong wind — scent cone fragmented. Reduce sector width, deploy trailing dogs instead.</Alert>
          )}
        </Section>
      )}

      {/* ── SUBJECT SURVIVAL ── */}
      {survival && (
        <Section title="Subject Exposure Risk" icon={<AlertTriangle size={12} />} open={expanded.survival} toggle={() => toggle("survival")}>
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-lg font-bold ${survival.color}`}>{survival.risk}</span>
          </div>
          <div className="space-y-1">
            {survival.notes.map((n, i) => (
              <div key={i} className="text-[10px] text-fg-3 flex items-start gap-1.5">
                <span className="text-fg-4 mt-0.5">•</span>
                <span>{n}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── FORECAST ── */}
      {forecastHours.length > 0 && (
        <Section title="12-Hour Forecast" icon={<Clock size={12} />} open={expanded.forecast} toggle={() => toggle("forecast")}>
          <div className="space-y-0.5">
            {forecastHours.map((h, i) => {
              const t = new Date(h.time);
              const isNight = t.getHours() < 6 || t.getHours() > 20;
              return (
                <div key={i} className={`flex items-center gap-2 text-[10px] py-1 px-1.5 rounded ${isNight ? "bg-surface-700/30" : ""}`}>
                  <span className="text-fg-4 w-12">{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="w-10">{h.temp?.toFixed(0)}°C</span>
                  <span className="w-14 flex items-center gap-1"><Wind size={8} />{h.wind?.toFixed(0)} mph</span>
                  <span className={`w-12 ${h.rain > 0.5 ? "text-blue-400" : "text-fg-4"}`}>
                    {h.rain > 0 ? `${h.rain.toFixed(1)}mm` : "—"}
                  </span>
                  <span className="text-fg-4">{h.cloud?.toFixed(0)}%</span>
                  {isNight && <Moon size={8} className="text-blue-300" />}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── RAW METAR ── */}
      {metar?.raw && (
        <Section title="METAR (EGPK)" icon={<Gauge size={12} />} open={expanded.detail} toggle={() => toggle("detail")}>
          <code className="text-[9px] text-fg-4 font-mono break-all">{metar.raw}</code>
          <div className="mt-1 text-[9px] text-fg-4">Source: Prestwick Airport — verified aviation weather</div>
        </Section>
      )}

      {/* ── DRONE CONDITIONS ── */}
      <Section title="Drone Operations" icon={<Wind size={12} />} open={expanded.drone} toggle={() => toggle("drone")}>
        <DroneConditions windSpeed={windSpeed} windGust={windGust} visibility={visibility} precipitation={precipitation} cloudCover={cloudCover} />
      </Section>
    </div>
  );
}

function DroneConditions({ windSpeed, windGust, visibility, precipitation, cloudCover }: {
  windSpeed?: number; windGust?: number; visibility?: number; precipitation?: number; cloudCover?: number;
}) {
  const issues: { level: string; msg: string }[] = [];
  let status = "GO";
  let statusColor = "text-green-400";

  if (windSpeed != null && windSpeed > 25) { status = "NO-GO"; statusColor = "text-red-400"; issues.push({ level: "critical", msg: `Wind ${Math.round(windSpeed)} mph exceeds safe limit (25 mph)` }); }
  else if (windSpeed != null && windSpeed > 15) { issues.push({ level: "warn", msg: `Moderate wind ${Math.round(windSpeed)} mph — reduced flight time, less stable footage` }); if (status === "GO") { status = "CAUTION"; statusColor = "text-amber-400"; } }

  if (windGust != null && windGust > 35) { status = "NO-GO"; statusColor = "text-red-400"; issues.push({ level: "critical", msg: `Gusts ${Math.round(windGust)} mph — unsafe for all drone types` }); }

  if (visibility != null && visibility < 500) { status = "NO-GO"; statusColor = "text-red-400"; issues.push({ level: "critical", msg: `Visibility ${visibility}m — below VLOS minimum` }); }
  else if (visibility != null && visibility < 2000) { issues.push({ level: "warn", msg: `Reduced visibility ${(visibility / 1000).toFixed(1)} km — maintain close VLOS` }); }

  if (precipitation != null && precipitation > 2) { issues.push({ level: "warn", msg: "Active rain — risk to electronics, reduced camera quality" }); if (status === "GO") { status = "CAUTION"; statusColor = "text-amber-400"; } }

  if (issues.length === 0) issues.push({ level: "info", msg: "All conditions within safe operating limits" });

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-lg font-bold ${statusColor}`}>{status}</span>
        <span className="text-xs text-fg-4">for drone operations</span>
      </div>
      <div className="space-y-1">
        {issues.map((issue, i) => (
          <div key={i} className={`text-[10px] flex items-start gap-1.5 ${issue.level === "critical" ? "text-red-300" : issue.level === "warn" ? "text-amber-300" : "text-fg-3"}`}>
            <span className="mt-0.5">•</span>
            <span>{issue.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Storm Intelligence (Prism lenses) ──

function StormIntelligence({ stormWatch, windConsensus }: { stormWatch?: any; windConsensus?: any }) {
  // Storm verdict colour mapping: settled → green, watching/partial → amber, warning/severe → red
  const stormVerdict = stormWatch?.verdict || "unknown";
  const stormScore = typeof stormWatch?.score === "number" ? stormWatch.score : null;
  const stormAlert = stormScore != null && stormScore >= 0.6 ? "critical" : stormScore != null && stormScore >= 0.3 ? "warn" : undefined;
  const stormColor = stormAlert === "critical" ? "text-red-400" : stormAlert === "warn" ? "text-amber-400" : "text-green-400";

  const windVerdict = windConsensus?.verdict || "unknown";
  const windAgree = windVerdict === "strong_agree" || windVerdict === "mostly_agree";
  const windColor = windVerdict === "disagree" ? "text-red-400" : windVerdict === "mostly_agree" ? "text-amber-400" : windAgree ? "text-green-400" : "text-fg-3";
  const dirScore = typeof windConsensus?.direction_score === "number" ? windConsensus.direction_score : null;

  return (
    <div className="space-y-2">
      {stormWatch && (
        <div className="border border-surface-700 rounded p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <AlertTriangle size={11} className={stormColor} />
              <span className="text-xs text-fg-2">Storm Watch</span>
            </div>
            <span className={`text-xs font-semibold uppercase ${stormColor}`}>{stormVerdict.replace(/_/g, " ")}</span>
          </div>
          {stormWatch.descriptor && <div className="text-[10px] text-fg-3 mb-1.5">{stormWatch.descriptor}</div>}
          <div className="grid grid-cols-3 gap-1.5">
            {stormScore != null && <Stat label="Score" value={stormScore.toFixed(2)} sub="0 calm → 1 severe" alert={stormAlert} />}
            {typeof stormWatch.pressure_tendency_3h_hpa === "number" && (
              <Stat
                label="ΔPressure 3h"
                value={`${stormWatch.pressure_tendency_3h_hpa > 0 ? "+" : ""}${stormWatch.pressure_tendency_3h_hpa.toFixed(1)} hPa`}
                icon={stormWatch.pressure_tendency_3h_hpa < -3 ? <ArrowDown size={9} className="text-red-400" /> : stormWatch.pressure_tendency_3h_hpa > 2 ? <ArrowUp size={9} /> : undefined}
                alert={stormWatch.pressure_tendency_3h_hpa < -3 ? "warn" : undefined}
              />
            )}
            {typeof stormWatch.wind_rotation_3h_deg === "number" && (
              <Stat label="Wind veer 3h" value={`${stormWatch.wind_rotation_3h_deg > 0 ? "+" : ""}${stormWatch.wind_rotation_3h_deg.toFixed(0)}°`} />
            )}
          </div>
          {stormAlert === "critical" && (
            <Alert level="critical">Storm indicators elevated — review wind/precip forecast before deploying foot teams.</Alert>
          )}
          {stormAlert === "warn" && (
            <Alert level="warn">Weather watching — conditions may deteriorate. Monitor next refresh.</Alert>
          )}
        </div>
      )}

      {windConsensus && (
        <div className="border border-surface-700 rounded p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Radio size={11} className={windColor} />
              <span className="text-xs text-fg-2">Wind Consensus</span>
            </div>
            <span className={`text-xs font-semibold uppercase ${windColor}`}>{windVerdict.replace(/_/g, " ")}</span>
          </div>
          {windConsensus.descriptor && <div className="text-[10px] text-fg-3 mb-1.5">{windConsensus.descriptor}</div>}
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            {typeof windConsensus.metar_from_deg === "number" && (
              <div className="p-1.5 rounded border border-surface-600">
                <div className="text-fg-4">Surface (METAR)</div>
                <div className="text-fg-1 font-medium">
                  {windDir(windConsensus.metar_from_deg)} {Math.round(windConsensus.metar_from_deg)}° · {Math.round(windConsensus.metar_speed_kt ?? 0)} kt
                </div>
                {windConsensus.metar_stations && <div className="text-fg-4">{windConsensus.metar_stations} stns</div>}
              </div>
            )}
            {typeof windConsensus.geostrophic_from_deg === "number" && (
              <div className="p-1.5 rounded border border-surface-600">
                <div className="text-fg-4">Upper (geostrophic)</div>
                <div className="text-fg-1 font-medium">
                  {windDir(windConsensus.geostrophic_from_deg)} {Math.round(windConsensus.geostrophic_from_deg)}° · {Math.round(windConsensus.geostrophic_speed_kt ?? 0)} kt
                </div>
                {dirScore != null && <div className="text-fg-4">dir score {(dirScore * 100).toFixed(0)}%</div>}
              </div>
            )}
          </div>
          {windVerdict === "disagree" && (
            <Alert level="warn">Surface and upper winds diverge — likely frontal boundary or turbulence aloft. Drone ops caution.</Alert>
          )}
        </div>
      )}

      <div className="text-[9px] text-fg-4 pt-1">Source: Prism storm-watch + wind-consensus lenses · refreshes 2 min</div>
    </div>
  );
}

// ── Reusable components ──

function Section({ title, icon, open, toggle, children }: {
  title: string; icon: React.ReactNode; open: boolean; toggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border border-surface-700 rounded">
      <button onClick={toggle} className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-fg-3 hover:text-fg-1 transition">
        <div className="flex items-center gap-2">{icon}{title}</div>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

function Stat({ label, value, icon, sub, alert }: {
  label: string; value: string; icon?: React.ReactNode; sub?: string; alert?: "warn" | "critical" | "info";
}) {
  const borderColor = alert === "critical" ? "border-red-500/30 bg-red-500/5" : alert === "warn" ? "border-amber-500/30 bg-amber-500/5" : "border-surface-600";
  return (
    <div className={`p-1.5 rounded border ${borderColor}`}>
      <div className="text-[9px] text-fg-4 flex items-center gap-1">{icon}{label}</div>
      <div className="text-xs font-medium text-fg-1 mt-0.5">{value}</div>
      {sub && <div className={`text-[9px] ${alert === "critical" ? "text-red-400 font-medium" : alert === "warn" ? "text-amber-400" : "text-fg-4"}`}>{sub}</div>}
    </div>
  );
}

function Alert({ level, children }: { level: "warn" | "critical" | "info"; children: React.ReactNode }) {
  const colors = {
    critical: "bg-red-500/10 border-red-500/30 text-red-300",
    warn: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    info: "bg-blue-500/10 border-blue-500/30 text-blue-300",
  };
  return (
    <div className={`mt-2 px-2 py-1.5 rounded border text-[10px] ${colors[level]}`}>
      <AlertTriangle size={10} className="inline mr-1" />
      {children}
    </div>
  );
}
