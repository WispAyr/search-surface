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
    showHazards, showAttractors,
    hazards, hazardLines, attractors,
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
