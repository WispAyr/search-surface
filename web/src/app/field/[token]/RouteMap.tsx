"use client";

import { MapContainer, TileLayer, GeoJSON, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  geometry: GeoJSON.LineString;
  datum?: [number, number] | null;
}

export function RouteMap({ geometry, datum }: Props) {
  // Center on the first coord of the route (fallback to datum, then Ayr).
  const first = geometry?.coordinates?.[0];
  const center: [number, number] = first
    ? [first[1], first[0]]
    : datum
      ? datum
      : [55.46, -4.63];

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
      <GeoJSON
        data={geometry}
        style={{ color: "#06b6d4", weight: 4, opacity: 0.9, dashArray: "8,6" }}
      />
      {datum && (
        <CircleMarker
          center={datum}
          radius={6}
          pathOptions={{ color: "white", weight: 2, fillColor: "#ef4444", fillOpacity: 1 }}
        />
      )}
    </MapContainer>
  );
}
