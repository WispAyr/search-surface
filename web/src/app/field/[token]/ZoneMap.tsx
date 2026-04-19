"use client";

import { MapContainer, TileLayer, GeoJSON, CircleMarker, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  zoneGeometry?: GeoJSON.Feature | GeoJSON.Geometry | null;
  route?: GeoJSON.LineString | null;
  datum?: [number, number] | null;
  teamPosition?: [number, number] | null;
}

// Leaflet needs to be told to refit bounds when the data changes — the
// MapContainer only consumes `center`/`zoom` on first mount.
function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    try { map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 }); } catch {}
  }, [bounds, map]);
  return null;
}

// Collect [lat, lon] pairs from anything GeoJSON-ish for fitBounds.
function collectLatLngs(g: any): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  function walk(coords: any) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number") {
      if (coords.length >= 2) out.push([coords[1], coords[0]]);
      return;
    }
    for (const c of coords) walk(c);
  }
  if (!g) return out;
  if (g.type === "Feature") walk(g.geometry?.coordinates);
  else walk(g.coordinates);
  return out;
}

export function ZoneMap({ zoneGeometry, route, datum, teamPosition }: Props) {
  // Build bounds from whatever geometry we have — zone first, then route, then
  // datum. If nothing, fall back to SW Scotland default.
  const latlngs: Array<[number, number]> = [];
  if (zoneGeometry) latlngs.push(...collectLatLngs(zoneGeometry));
  if (route) latlngs.push(...collectLatLngs(route));
  if (datum) latlngs.push(datum);
  if (teamPosition) latlngs.push(teamPosition);

  const center: [number, number] = latlngs[0] || [55.46, -4.63];
  const bounds: LatLngBoundsExpression | null = latlngs.length >= 2 ? latlngs : null;

  return (
    <MapContainer
      center={center}
      zoom={14}
      scrollWheelZoom={false}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds bounds={bounds} />
      {zoneGeometry && (
        <GeoJSON
          data={zoneGeometry as any}
          style={{ color: "#22d3ee", weight: 2, fillColor: "#22d3ee", fillOpacity: 0.18 }}
        />
      )}
      {route && (
        <GeoJSON
          data={route as any}
          style={{ color: "#06b6d4", weight: 4, opacity: 0.9, dashArray: "8,6" }}
        />
      )}
      {datum && (
        <CircleMarker
          center={datum}
          radius={6}
          pathOptions={{ color: "white", weight: 2, fillColor: "#ef4444", fillOpacity: 1 }}
        />
      )}
      {teamPosition && (
        <CircleMarker
          center={teamPosition}
          radius={8}
          pathOptions={{ color: "white", weight: 2, fillColor: "#22c55e", fillOpacity: 1 }}
        />
      )}
    </MapContainer>
  );
}
