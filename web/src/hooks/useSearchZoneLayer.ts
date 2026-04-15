import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { SearchOperation, SearchZone } from "@/types/search";

const STATUS_COLORS: Record<string, string> = {
  unassigned: "#6b7280",
  assigned: "#3b82f6",
  in_progress: "#f59e0b",
  complete: "#22c55e",
  suspended: "#ef4444",
};

/**
 * Renders active search operation zones as a Leaflet layer on the main map.
 * Polls /api/search/operations?status=active every 30s.
 */
export function useSearchZoneLayer() {
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = (window as any).__prismMap as L.Map | undefined;
    if (!map) return;

    const group = L.layerGroup().addTo(map);
    layerGroupRef.current = group;

    const fetchAndRender = async () => {
      try {
        const res = await fetch("/api/search/operations?status=active");
        const data = await res.json();
        const operations: SearchOperation[] = data.operations || [];

        group.clearLayers();

        for (const op of operations) {
          // Fetch full operation with zones
          const opRes = await fetch(`/api/search/operations/${op.id}`);
          const fullOp: SearchOperation = await opRes.json();

          for (const zone of fullOp.zones || []) {
            if (!zone.geometry) continue;
            const color = STATUS_COLORS[zone.status] || "#6b7280";
            const geoLayer = L.geoJSON(zone.geometry as any, {
              style: {
                color,
                weight: 2,
                fillColor: color,
                fillOpacity: zone.status === "complete" ? 0.05 : 0.12,
                dashArray: zone.status === "suspended" ? "5,5" : undefined,
              },
            });
            geoLayer.bindTooltip(
              `<b>${zone.name}</b> (${op.name})<br/>` +
              `${zone.search_method.replace(/_/g, " ")}<br/>` +
              `POD: ${Math.round(zone.cumulative_pod * 100)}% | Status: ${zone.status}`,
              { sticky: true }
            );
            group.addLayer(geoLayer);
          }

          // Team positions
          for (const team of fullOp.teams || []) {
            if (!team.last_lat || !team.last_lon) continue;
            const marker = L.circleMarker([team.last_lat, team.last_lon], {
              radius: 5,
              color: team.color || "#00d4ff",
              fillColor: team.color || "#00d4ff",
              fillOpacity: 0.8,
              weight: 2,
            });
            marker.bindTooltip(
              `<b>${team.name}</b> (${team.callsign})<br/>` +
              `${team.status} | ${team.capability}`,
              { sticky: true }
            );
            group.addLayer(marker);
          }

          // Datum marker
          if (fullOp.datum_lat && fullOp.datum_lon) {
            const datum = L.circleMarker([fullOp.datum_lat, fullOp.datum_lon], {
              radius: 7,
              color: "#ff0000",
              fillColor: "#ff0000",
              fillOpacity: 0.5,
              weight: 3,
            });
            datum.bindTooltip(`<b>Datum</b> — ${op.name}`);
            group.addLayer(datum);
          }
        }
      } catch {
        // silent
      }
    };

    fetchAndRender();
    const iv = setInterval(fetchAndRender, 30000);

    return () => {
      clearInterval(iv);
      group.clearLayers();
      map.removeLayer(group);
    };
  }, []);
}
