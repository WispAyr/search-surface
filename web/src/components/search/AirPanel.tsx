"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Crosshair, Radio, RefreshCw, Plane, AlertTriangle } from "lucide-react";
import type { SearchOperation } from "@/types/search";
import type { AirTrack, AirLiveAircraft } from "@/lib/api";
import { useAirActivity } from "@/hooks/useAirActivity";
import { useSearchStore } from "@/stores/search";
import { AIR_CAT_COLORS, AIR_CAT_LABELS, airIdent } from "@/lib/airGeo";

function fmtWindow(a: string, b: string) {
  const f = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-GB", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch { return iso; }
  };
  return `${f(a)} → ${f(b)}`;
}

function TrackRow({ t, hidden, onToggle, onFocus }: {
  t: AirTrack; hidden: boolean; onToggle: () => void; onFocus: () => void;
}) {
  const color = AIR_CAT_COLORS[t.category] || AIR_CAT_COLORS.other;
  return (
    <div className={`border-b border-surface-700 px-3 py-2.5 ${hidden ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-sm text-fg-1 font-medium truncate">{airIdent(t)}</span>
        {t.loiter && (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/20 text-accent shrink-0">
            orbit
          </span>
        )}
        <span className="flex-1" />
        <button onClick={onFocus} className="text-fg-4 hover:text-accent p-0.5" title="Zoom to this track">
          <Crosshair size={13} />
        </button>
        <button onClick={onToggle} className="text-fg-4 hover:text-accent p-0.5"
          title={hidden ? "Show on map" : "Hide from map"}>
          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      <div className="mt-1 ml-4 text-[10px] text-fg-4 leading-relaxed">
        <div>{AIR_CAT_LABELS[t.category] || t.category}{t.type_code ? ` · ${t.type_code}` : ""}</div>
        <div className="flex flex-wrap gap-x-3">
          <span>{t.centroid_dist_m} m from datum</span>
          <span>{t.minutes_on_station} min</span>
          {t.min_alt_m != null && <span>min {t.min_alt_m} m ({Math.round(t.min_alt_m * 3.28084)} ft)</span>}
          {t.spread_m != null && <span>spread {t.spread_m} m</span>}
        </div>
        <div className="opacity-70">{fmtWindow(t.first_seen, t.last_seen)}</div>
      </div>
    </div>
  );
}

function LiveRow({ a, onFocus }: { a: AirLiveAircraft; onFocus: () => void }) {
  const color = AIR_CAT_COLORS[a.category] || AIR_CAT_COLORS.other;
  return (
    <div className="border-b border-surface-700 px-3 py-2 flex items-center gap-2">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-xs text-fg-1 truncate">{airIdent(a)}</span>
      {a.of_interest && <AlertTriangle size={11} className="text-amber-400 shrink-0" />}
      <span className="flex-1" />
      <span className="text-[10px] text-fg-4 tabular-nums">
        {(a.dist_m / 1000).toFixed(1)} km
        {a.alt_m != null && ` · ${Math.round(a.alt_m * 3.28084)} ft`}
      </span>
      <button onClick={onFocus} className="text-fg-4 hover:text-accent p-0.5" title="Centre on this aircraft">
        <Crosshair size={12} />
      </button>
    </div>
  );
}

export function AirPanel({ operation }: { operation: SearchOperation }) {
  const { mapPrefs, updateMapPrefs, hiddenAircraft, toggleAircraft, showAllAircraft, setAirFocus } = useSearchStore();
  const enabled = !!mapPrefs.show_air;
  const { tracks, live, error, loading } = useAirActivity(operation.id, enabled);
  const [showTransits, setShowTransits] = useState(false);

  const { loiterers, transits } = useMemo(() => {
    const all = tracks?.tracks ?? [];
    return {
      loiterers: all.filter((t) => t.loiter),
      transits: all.filter((t) => !t.loiter),
    };
  }, [tracks]);

  const hidden = useMemo(() => new Set(hiddenAircraft), [hiddenAircraft]);

  return (
    <div className="text-xs">
      <div className="px-3 py-2.5 border-b border-surface-700 flex items-center gap-2">
        <Radio size={13} className={enabled ? "text-accent" : "text-fg-4"} />
        <span className="text-[10px] uppercase tracking-wider text-fg-4 font-semibold flex-1">
          Air activity · ADS-B
        </span>
        {loading && <RefreshCw size={11} className="text-fg-4 animate-spin" />}
        <button
          onClick={() => updateMapPrefs({ show_air: !enabled })}
          className={`text-[10px] px-2 py-1 rounded transition ${
            enabled ? "bg-accent/20 text-accent" : "bg-surface-700 text-fg-3 hover:text-fg-1"}`}
        >
          {enabled ? "On" : "Off"}
        </button>
      </div>

      {!enabled && (
        <div className="px-3 py-4 text-[11px] text-fg-4 leading-relaxed">
          The air layer is off, so nothing is being fetched. Turn it on to pull live ADS-B
          and the loiter history around this datum.
        </div>
      )}

      {enabled && error && <div className="px-3 py-3 text-[11px] text-red-400">{error}</div>}

      {enabled && tracks && (
        <>
          <div className="grid grid-cols-3 gap-px bg-surface-700">
            <div className="bg-surface-800 px-2 py-2">
              <div className="text-[9px] text-fg-4 uppercase tracking-wide">Orbits</div>
              <div className="text-base text-fg-1 tabular-nums">{loiterers.length}</div>
            </div>
            <div className="bg-surface-800 px-2 py-2">
              <div className="text-[9px] text-fg-4 uppercase tracking-wide">Tracks</div>
              <div className="text-base text-fg-1 tabular-nums">{tracks.aircraft}</div>
            </div>
            <div className="bg-surface-800 px-2 py-2">
              <div className="text-[9px] text-fg-4 uppercase tracking-wide">Live now</div>
              <div className="text-base text-fg-1 tabular-nums">{live?.count ?? "—"}</div>
            </div>
          </div>

          <div className="px-3 py-2 border-b border-surface-700 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-accent font-semibold flex-1">
              Loitering · {loiterers.length}
            </span>
            {hiddenAircraft.length > 0 && (
              <button onClick={showAllAircraft} className="text-[10px] text-fg-4 hover:text-accent underline">
                show all ({hiddenAircraft.length} hidden)
              </button>
            )}
          </div>
          {loiterers.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-fg-4">
              Nothing has held a tight, low orbit over this datum in the window.
            </div>
          )}
          {loiterers.map((t) => (
            <TrackRow key={t.icao24} t={t}
              hidden={hidden.has(t.icao24)}
              onToggle={() => toggleAircraft(t.icao24)}
              onFocus={() => setAirFocus([t.centroid[0], t.centroid[1], 14])} />
          ))}

          <button onClick={() => setShowTransits((v) => !v)}
            className="w-full px-3 py-2 border-b border-surface-700 text-left text-[10px] uppercase tracking-wider text-fg-4 font-semibold hover:text-fg-2">
            Transits · {transits.length} {showTransits ? "▾" : "▸"}
          </button>
          {showTransits && transits.map((t) => (
            <TrackRow key={t.icao24} t={t}
              hidden={hidden.has(t.icao24)}
              onToggle={() => toggleAircraft(t.icao24)}
              onFocus={() => setAirFocus([t.centroid[0], t.centroid[1], 13])} />
          ))}

          <div className="px-3 py-2 border-b border-surface-700 flex items-center gap-2">
            <Plane size={11} className="text-fg-4" />
            <span className="text-[10px] uppercase tracking-wider text-fg-4 font-semibold">
              Live contacts · {live?.aircraft.filter((a) => !a.on_ground).length ?? 0}
            </span>
          </div>
          {(live?.aircraft ?? []).filter((a) => !a.on_ground).slice(0, 25).map((a) => (
            <LiveRow key={a.icao24} a={a}
              onFocus={() => setAirFocus([a.lat, a.lon, 13])} />
          ))}

          <div className="px-3 py-3 text-[10px] text-fg-4 leading-relaxed border-t border-surface-700">
            An orbit is a track that stayed tight, low and near the datum — spread under
            {" "}{tracks.loiter_criteria?.max_spread_m ?? 1500} m and centred within
            {" "}{tracks.loiter_criteria?.max_centroid_dist_m ?? 3000} m. Everything else is a transit.
            {" "}ADS-B only: aircraft not transmitting, or transmitting with position blocked, are absent.
          </div>
        </>
      )}
    </div>
  );
}
