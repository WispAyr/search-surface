"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { siphon } from "@/lib/api";

const TYPE_COLORS: Record<string, string> = {
  CTR: "#0066ff",
  ATZ: "#0099cc",
  TMA: "#6633cc",
  CTA: "#6633cc",
  Danger_Area: "#ffaa00",
  Restricted_Area: "#ff6600",
  Prohibited_Area: "#ff0000",
  MATZ: "#336699",
  FRZ: "#cc0066",
};

const TYPE_LABELS: Record<string, string> = {
  CTR: "Control Zone",
  ATZ: "Aerodrome Traffic Zone",
  TMA: "Terminal Manoeuvring Area",
  CTA: "Control Area",
  Danger_Area: "Danger Area",
  Restricted_Area: "Restricted Area",
  Prohibited_Area: "Prohibited Area",
  MATZ: "Military ATZ",
  FRZ: "Flight Restriction Zone",
};

interface AirspaceLayerProps {
  visible: boolean;
}

export function AirspaceLayer({ visible }: AirspaceLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [zones, setZones] = useState<any[]>([]);
  const [error, setError] = useState(false);

  // Fetch airspace data
  useEffect(() => {
    siphon.ukAirspace()
      .then((data: any) => {
        const features = data?.features || data?.data?.features || [];
        setZones(features);
      })
      .catch(() => setError(true));
  }, []);

  // Render/hide layer
  useEffect(() => {
    if (!map) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!visible || zones.length === 0) return;

    const group = L.layerGroup();

    for (const feature of zones) {
      const props = feature.properties || {};
      const zoneType = props.type || "Unknown";
      const color = TYPE_COLORS[zoneType] || "#999999";
      const typeLabel = TYPE_LABELS[zoneType] || zoneType;

      try {
        const geoLayer = L.geoJSON(feature, {
          style: {
            color,
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.08,
            dashArray: zoneType.includes("Danger") ? "6,4" : undefined,
          },
        });

        const tooltip = [
          `<b>${props.name || "Unknown"}</b>`,
          `Type: ${typeLabel}`,
          props.class ? `Class: ${props.class}` : null,
          props.lower_limit ? `Lower: ${props.lower_limit}` : null,
          props.upper_limit ? `Upper: ${props.upper_limit}` : null,
          props.frequency ? `Freq: ${props.frequency}` : null,
          props.remarks ? `<br/><i>${props.remarks}</i>` : null,
        ].filter(Boolean).join("<br/>");

        geoLayer.bindTooltip(tooltip, { sticky: true });
        group.addLayer(geoLayer);
      } catch {
        // Skip invalid geometries
      }
    }

    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, visible, zones]);

  return null;
}

/**
 * Check if a point falls within any restricted airspace zone.
 * Returns list of conflicting zones with ATC contact info.
 */
export function checkAirspaceConflicts(
  lat: number,
  lon: number,
  zones: any[]
): { name: string; type: string; atc_unit: string; atc_freq: string; rules: string }[] {
  const conflicts: any[] = [];

  for (const feature of zones) {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom) continue;

    // Simple point-in-polygon check
    if (geom.type === "Polygon" && geom.coordinates?.[0]) {
      if (pointInPolygon([lon, lat], geom.coordinates[0])) {
        conflicts.push({
          name: props.name || "Unknown",
          type: props.type || "Unknown",
          atc_unit: props.controlling_authority || props.name || "",
          atc_freq: props.frequency || "",
          rules: props.remarks || "",
        });
      }
    }
  }

  return conflicts;
}

function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
