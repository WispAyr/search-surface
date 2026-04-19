"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, GeoJSON, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import { useSearchStore } from "@/stores/search";
import { searchHelpers } from "@/lib/api";

const LPB_RING_COLORS = ["#22c55e", "#eab308", "#f97316", "#ef4444"]; // 25/50/75/95%
const LPB_RING_LABELS = ["25%", "50%", "75%", "95%"];
const TRAVEL_COLORS = { foot: "#60a5fa", bike: "#a78bfa", car: "#f472b6" };
const TRAVEL_SPEEDS_KMH = { foot: 5, bike: 20, car: 60 };

type Profile = { rings_km: number[] };

interface Props {
  datumLat?: number | null;
  datumLon?: number | null;
}

export function SarOverlays({ datumLat, datumLon }: Props) {
  const {
    subjectProfileId, showLpbRings,
    travelModes, travelMinutes,
    showHazards, showAttractors, showCoastline, showLse,
    hazards, hazardLines, attractors, coastlines, lse,
    vehicleRoute,
  } = useSearchStore();

  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!subjectProfileId) { setProfile(null); return; }
    searchHelpers.profiles().then((d) => {
      setProfile(d.profiles[subjectProfileId] || null);
    }).catch(() => setProfile(null));
  }, [subjectProfileId]);

  if (!datumLat || !datumLon) return null;

  return (
    <>
      {/* ── LPB statistical rings ── */}
      {showLpbRings && profile && profile.rings_km.map((km, i) => (
        <Circle
          key={`lpb-${i}`}
          center={[datumLat, datumLon]}
          radius={km * 1000}
          pathOptions={{
            color: LPB_RING_COLORS[i],
            weight: 1.5,
            fillOpacity: 0,
            dashArray: "4,4",
          }}
        >
          <Popup>
            <strong>LPB {LPB_RING_LABELS[i]} containment</strong><br />
            {km} km from LKP
          </Popup>
        </Circle>
      ))}

      {/* ── Travel-mode isochrones (straight-line max) ── */}
      {(Object.keys(travelModes) as Array<keyof typeof travelModes>).map((mode) => {
        if (!travelModes[mode]) return null;
        const km = (TRAVEL_SPEEDS_KMH[mode] * travelMinutes) / 60;
        return (
          <Circle
            key={`travel-${mode}`}
            center={[datumLat, datumLon]}
            radius={km * 1000}
            pathOptions={{
              color: TRAVEL_COLORS[mode],
              weight: 2,
              fillColor: TRAVEL_COLORS[mode],
              fillOpacity: 0.04,
            }}
          >
            <Popup>
              <strong>{mode} · {travelMinutes} min</strong><br />
              Max reach {km.toFixed(1)} km at {TRAVEL_SPEEDS_KMH[mode]} km/h
            </Popup>
          </Circle>
        );
      })}

      {/* ── Linear hazards (rail, rivers) ── */}
      {showHazards && hazardLines.map((h, i) => (
        <Polyline
          key={`hl-${i}`}
          positions={h.coords}
          pathOptions={hazardLineStyle(h.kind)}
        >
          <Popup>
            <strong>⚠ {h.kind}</strong><br />
            {h.name || "(unnamed)"}
          </Popup>
        </Polyline>
      ))}

      {/* ── Point hazards (cliffs, quarries, mineshafts) ── */}
      {showHazards && hazards.map((h, i) => (
        <Marker
          key={`hz-${i}`}
          position={[h.lat, h.lon]}
          icon={featureIcon("hazard", h.kind)}
        >
          <Popup>
            <strong>⚠ {h.kind}</strong><br />
            {h.name || "(unnamed)"}
          </Popup>
        </Marker>
      ))}

      {/* ── Attractors ── */}
      {showAttractors && attractors.map((a, i) => (
        <Marker
          key={`at-${i}`}
          position={[a.lat, a.lon]}
          icon={featureIcon("attractor", a.kind)}
        >
          <Popup>
            <strong>{a.kind}</strong><br />
            {a.name || "(unnamed)"}
          </Popup>
        </Marker>
      ))}

      {/* ── Coastline (shoreline sweep awareness) ── */}
      {showCoastline && coastlines.map((c, i) => (
        <Polyline
          key={`cl-${i}`}
          positions={c.coords}
          pathOptions={{ color: "#0ea5e9", weight: 3, opacity: 0.85 }}
        >
          <Popup>
            <strong>Coastline</strong><br />
            {c.name || "(unnamed)"}
            <br /><span className="text-xs">Corridor-sweep zones coming soon — for now, use this as a shoreline reference.</span>
          </Popup>
        </Polyline>
      ))}

      {/* ── Life-saving equipment ── */}
      {showLse && lse.map((e, i) => (
        <Marker
          key={`lse-${i}`}
          position={[e.lat, e.lon]}
          icon={lseIcon(e.kind)}
        >
          <Popup>
            <strong>🛟 {lseLabel(e.kind)}</strong><br />
            {e.name || "(unnamed)"}
          </Popup>
        </Marker>
      ))}

      {/* ── Vehicle route ── */}
      {vehicleRoute && (
        <GeoJSON
          data={vehicleRoute}
          style={{ color: "#06b6d4", weight: 4, opacity: 0.85, dashArray: "10,5" }}
        />
      )}
    </>
  );
}

function hazardLineStyle(kind: string): L.PathOptions {
  if (kind === "railway") {
    return { color: "#f43f5e", weight: 3, opacity: 0.85, dashArray: "8,6" };
  }
  if (kind === "water") {
    return { color: "#38bdf8", weight: 3, opacity: 0.7 };
  }
  return { color: "#f43f5e", weight: 2, opacity: 0.8 };
}

function lseLabel(kind: string): string {
  if (kind === "life_ring") return "Life ring";
  if (kind === "lifeguard_tower") return "Lifeguard tower";
  if (kind === "lifeguard_base") return "Lifeguard base";
  if (kind === "rescue_station") return "Rescue station";
  if (kind === "rescue_box") return "Rescue box";
  if (kind === "emergency_phone") return "Emergency phone";
  if (kind.startsWith("rescue_")) return `Rescue kit (${kind.slice(7).replace(/_/g, " ")})`;
  return kind;
}

function lseIcon(kind: string) {
  // Amber circle with a glyph — distinct from the square hazard/attractor pins
  // so life-saving kit reads as its own layer at a glance.
  const glyph =
    kind === "life_ring" ? "◯" :
    kind === "lifeguard_tower" || kind === "lifeguard_base" ? "L" :
    kind === "rescue_station" ? "R" :
    kind === "rescue_box" ? "▣" :
    kind === "emergency_phone" ? "☎" :
    "+";
  return L.divIcon({
    html: `<div style="width:16px;height:16px;background:#f59e0b;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:#422006;font-weight:bold;box-shadow:0 0 6px rgba(245,158,11,0.6)">${glyph}</div>`,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function featureIcon(category: "hazard" | "attractor", kind: string) {
  const color = category === "hazard" ? "#f43f5e" : "#10b981";
  const glyph =
    kind === "water" ? "~" :
    kind === "cliff" ? "▲" :
    kind === "railway" ? "═" :
    kind === "quarry" ? "◆" :
    kind === "mineshaft" ? "●" :
    kind === "playground" ? "🏁" :
    kind === "park" ? "❀" :
    kind === "shelter" ? "⌂" :
    kind === "bench" ? "▬" :
    kind === "bus_station" ? "🚌" :
    kind === "cafe" ? "☕" :
    kind === "pub" ? "🍺" :
    "•";
  return L.divIcon({
    html: `<div style="width:14px;height:14px;background:${color};border:1.5px solid white;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:9px;color:white;font-weight:bold;box-shadow:0 0 4px rgba(0,0,0,0.5)">${glyph}</div>`,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}
