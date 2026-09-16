"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { AirTrack } from "@/lib/api";
import { useAirActivity } from "@/hooks/useAirActivity";
import { useSearchStore } from "@/stores/search";
import { AIR_CAT_COLORS as CAT_COLORS, AIR_CAT_LABELS as CAT_LABELS, airIdent } from "@/lib/airGeo";

// Why this layer exists: a helicopter's LOITER CENTROID marks where the crews
// thought the subject might be. It is the one read on the search picture that we
// do not generate ourselves, so it is worth showing next to our own POA.


function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function trackPopup(t: AirTrack) {
  const ident = airIdent(t);
  return `<div style="min-width:210px">
    <div style="font-weight:600">${esc(ident)}${t.callsign && t.registration ? ` <span style="opacity:.6">${esc(t.callsign)}</span>` : ""}</div>
    <div style="opacity:.75;font-size:11px;margin-bottom:6px">${esc(CAT_LABELS[t.category] || t.category)}${t.type_code ? ` · ${esc(t.type_code)}` : ""}</div>
    <div style="font-size:11px;line-height:1.7">
      <b>${t.centroid_dist_m} m</b> from datum (loiter centroid)<br>
      ${t.minutes_on_station} min on station · ${t.points} positions<br>
      ${t.min_alt_m != null ? `min alt <b>${t.min_alt_m} m</b> (${Math.round(t.min_alt_m * 3.28084)} ft)<br>` : ""}
      <span style="opacity:.7">${esc(fmtTime(t.first_seen))} → ${esc(fmtTime(t.last_seen))}</span>
    </div>
  </div>`;
}

interface Props {
  operationId: string;
  visible: boolean;
  /** History window in hours. */
  hours?: number;
  radiusKm?: number;
  onSummary?: (s: { live: number; ofInterest: number; loiterers: number; stale: boolean }) => void;
}

export function AirActivityLayer({ operationId, visible, hours = 48, radiusKm = 8, onSummary }: Props) {
  const map = useMap();
  const trackLayer = useRef<L.LayerGroup | null>(null);
  const liveLayer = useRef<L.LayerGroup | null>(null);
  // Same hook the 3D map uses — one poll, one payload, no drift between views.
  const { tracks, live, error: err } = useAirActivity(operationId, visible, { hours, radiusKm });
  const hiddenAircraft = useSearchStore((st) => st.hiddenAircraft);
  const airFocus = useSearchStore((st) => st.airFocus);
  const setAirFocus = useSearchStore((st) => st.setAirFocus);
  const hiddenAir = useMemo(() => new Set(hiddenAircraft), [hiddenAircraft]);

  useEffect(() => {
    if (!airFocus) return;
    map.flyTo([airFocus[0], airFocus[1]], airFocus[2], { duration: 0.8 });
    setAirFocus(null);
  }, [map, airFocus, setAirFocus]);

  const summary = useMemo(() => ({
    live: live?.count ?? 0,
    ofInterest: live?.of_interest ?? 0,
    loiterers: tracks?.loiterers ?? 0,
    stale: !!err,
  }), [live, tracks, err]);

  useEffect(() => { onSummary?.(summary); }, [summary, onSummary]);

  // ── Draw history ──
  // Legibility note: 1.8px lines at 0.8 opacity were invisible over ESRI
  // satellite — the operator toggled the layer on and saw nothing. Every line
  // now gets a dark CASING underneath, which is the standard cartographic fix
  // for drawing over imagery of unknown brightness.
  useEffect(() => {
    if (trackLayer.current) { map.removeLayer(trackLayer.current); trackLayer.current = null; }
    if (!visible || !tracks) return;
    const g = L.layerGroup();
    // Loiterers last so they sit above the transit clutter.
    const ordered = [...tracks.tracks].sort((a, b) => Number(a.loiter) - Number(b.loiter));
    for (const t of ordered) {
      if (hiddenAir.has(t.icao24)) continue;
      const color = CAT_COLORS[t.category] || CAT_COLORS.other;
      const line = t.points_geo.map((p) => [p[0], p[1]] as [number, number]);
      if (line.length < 2) continue;

      L.polyline(line, {
        color: "#000",
        weight: t.loiter ? 6 : 3,
        opacity: t.loiter ? 0.55 : 0.3,
        interactive: false,
      }).addTo(g);
      L.polyline(line, {
        color,
        weight: t.loiter ? 3 : 1.5,
        opacity: t.loiter ? 1 : 0.55,
        interactive: t.loiter,
      }).addTo(g).bindPopup(trackPopup(t));

      if (t.loiter) {
        L.circleMarker(t.centroid, {
          radius: 9, color: "#fff", weight: 3, fillColor: color, fillOpacity: 1,
        }).addTo(g)
          .bindPopup(trackPopup(t))
          // Permanent label: the operator should be able to read WHICH aircraft
          // and how far off the datum it sat without hunting for a hover target.
          .bindTooltip(`${airIdent(t)} · ${t.centroid_dist_m} m`,
            { direction: "top", opacity: 0.95, permanent: true, className: "air-loiter-label" });
      }
    }
    g.addTo(map);
    trackLayer.current = g;
    return () => { if (trackLayer.current) { map.removeLayer(trackLayer.current); trackLayer.current = null; } };
  }, [map, visible, tracks, hiddenAir]);

  // ── Frame the activity the first time the layer is switched on ──
  // The default operation view is ~500m across; the orbits span kilometres, so
  // without this the layer renders correctly and entirely off-screen.
  const framedRef = useRef(false);
  useEffect(() => {
    if (!visible) { framedRef.current = false; return; }
    if (framedRef.current || !tracks) return;
    const pts: [number, number][] = [];
    for (const t of tracks.tracks) {
      if (!t.loiter) continue;
      pts.push([t.centroid[0], t.centroid[1]]);
      for (const p of t.points_geo) pts.push([p[0], p[1]]);
    }
    if (pts.length < 2) return;
    framedRef.current = true;
    try {
      const b = L.latLngBounds(pts);
      // Only move if the activity is not already comfortably in view.
      if (!map.getBounds().contains(b)) map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
    } catch { /* bad geometry — leave the view alone */ }
  }, [map, visible, tracks]);

  // ── Draw live ──
  useEffect(() => {
    if (liveLayer.current) { map.removeLayer(liveLayer.current); liveLayer.current = null; }
    if (!visible || !live) return;
    const g = L.layerGroup();
    for (const a of live.aircraft) {
      if (a.on_ground) continue;
      const color = CAT_COLORS[a.category] || CAT_COLORS.other;
      const interesting = a.of_interest;
      const m = L.circleMarker([a.lat, a.lon], {
        radius: interesting ? 7 : 4,
        color: interesting ? "#fff" : color,
        weight: interesting ? 2 : 1,
        fillColor: color,
        fillOpacity: interesting ? 1 : 0.55,
      });
      const ident = airIdent(a);
      m.bindTooltip(
        `${ident}${a.type_code ? ` · ${a.type_code}` : ""} · ${(a.dist_m / 1000).toFixed(1)} km`
        + `${a.alt_m != null ? ` · ${Math.round(a.alt_m * 3.28084)} ft` : ""}`,
        { direction: "top", opacity: 0.9 },
      );
      m.addTo(g);
    }
    g.addTo(map);
    liveLayer.current = g;
    return () => { if (liveLayer.current) { map.removeLayer(liveLayer.current); liveLayer.current = null; } };
  }, [map, visible, live]);

  return null;
}
