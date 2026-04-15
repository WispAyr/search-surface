"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useSearchStore } from "@/stores/search";
import { AirspaceLayer } from "./AirspaceLayer";
import { SarOverlays } from "./SarOverlays";
import type { SearchOperation, SearchZone, SearchDatum } from "@/types/search";
import "leaflet/dist/leaflet.css";

const STATUS_COLORS: Record<string, string> = {
  unassigned: "#6b7280",
  assigned: "#3b82f6",
  in_progress: "#f59e0b",
  complete: "#22c55e",
  suspended: "#ef4444",
};

const PRIORITY_WEIGHTS: Record<number, number> = {
  1: 3,
  2: 2.5,
  3: 2,
  4: 1.5,
  5: 1,
};

function teamIcon(color: string) {
  return L.divIcon({
    html: `<div style="width:12px;height:12px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.5)"></div>`,
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function datumIcon() {
  return L.divIcon({
    html: `<div style="width:16px;height:16px;background:red;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(255,0,0,0.5)"></div>`,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const DATUM_KIND_COLORS: Record<string, string> = {
  lkp: "#ef4444",      // red — Last Known Position
  plp: "#f59e0b",      // amber — Possible Location
  sighting: "#3b82f6", // blue
  witness: "#8b5cf6",  // violet
  other: "#64748b",    // slate
};
const DATUM_KIND_LABELS: Record<string, string> = {
  lkp: "LKP",
  plp: "PLP",
  sighting: "Sighting",
  witness: "Witness",
  other: "",
};

function secondaryDatumIcon(kind: string, label: string) {
  const color = DATUM_KIND_COLORS[kind] || DATUM_KIND_COLORS.other;
  const badge = DATUM_KIND_LABELS[kind] || "";
  return L.divIcon({
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-50%)">
      <div style="padding:2px 6px;background:rgba(17,24,39,0.9);color:#fff;border:1px solid ${color};border-radius:4px;font-size:10px;font-family:system-ui;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis">${badge ? `<b style='color:${color}'>${badge}</b> ` : ""}${escapeHtml(label)}</div>
      <div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid ${color}"></div>
      <div style="width:10px;height:10px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.5);margin-top:-2px"></div>
    </div>`,
    className: "",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

interface SearchMapProps {
  operation: SearchOperation;
  onDatumSet?: (lat: number, lon: number) => void;
  onSecondaryDatumPick?: (lat: number, lon: number) => void;
}

export function SearchMap({ operation, onDatumSet, onSecondaryDatumPick }: SearchMapProps) {
  const {
    selectedZoneId,
    selectZone,
    settingDatum,
    setSettingDatum,
    showAirspace,
    previewZones,
    mobilePanelOpen,
    addingDatum,
    setAddingDatum,
  } = useSearchStore();

  const center: [number, number] = operation.datum_lat && operation.datum_lon
    ? [operation.datum_lat, operation.datum_lon]
    : [55.46, -4.63];

  // Defer mount via setTimeout so React 19 strict-mode's synchronous
  // double-effect finishes before we render MapContainer — the cleanup cancels
  // the pending timer so only the surviving effect actually mounts the map.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { if (!cancelled) setMounted(true); }, 50);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setMounted(false);
    };
  }, []);
  if (!mounted) return <div className="h-full w-full bg-surface-900" />;

  return (
    <div className="h-full w-full relative">
    <MapContainer
      key={operation.id}
      center={center}
      zoom={13}
      className="h-full w-full"
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        maxZoom={19}
      />

      {/* Primary datum marker */}
      {operation.datum_lat && operation.datum_lon && (
        <Marker position={[operation.datum_lat, operation.datum_lon]} icon={datumIcon()}>
          <Popup>
            <strong>Primary datum</strong>
            <br />
            {operation.datum_lat.toFixed(5)}, {operation.datum_lon.toFixed(5)}
          </Popup>
        </Marker>
      )}

      {/* Secondary datums */}
      {(operation.datums || []).map((d: SearchDatum) => (
        <Marker
          key={d.id}
          position={[d.lat, d.lon]}
          icon={secondaryDatumIcon(d.kind, d.label)}
        >
          <Popup>
            <strong>{d.label}</strong>
            <br />
            <span style={{ textTransform: "uppercase", fontSize: 10 }}>{d.kind}</span>
            <br />
            {d.lat.toFixed(5)}, {d.lon.toFixed(5)}
            {d.notes ? <><br />{d.notes}</> : null}
          </Popup>
        </Marker>
      ))}

      {/* Preview zones (pre-deploy, dashed amber overlay) */}
      {previewZones.map((pz: any, i) => {
        if (!pz?.geometry) return null;
        return (
          <GeoJSON
            key={`preview-${i}-${JSON.stringify(pz.geometry).length}`}
            data={pz.geometry}
            style={{
              color: "#f59e0b",
              weight: 2,
              fillColor: "#f59e0b",
              fillOpacity: 0.08,
              dashArray: "4,4",
            }}
          />
        );
      })}

      {/* Zone polygons */}
      {(operation.zones || []).map((zone) => (
        <ZoneLayer
          key={zone.id}
          zone={zone}
          isSelected={selectedZoneId === zone.id}
          onSelect={() => selectZone(zone.id)}
          teamColor={operation.teams?.find((t) => t.id === zone.assigned_team_id)?.color}
        />
      ))}

      {/* Team positions */}
      {(operation.teams || []).map((team) => {
        if (!team.last_lat || !team.last_lon) return null;
        return (
          <Marker
            key={team.id}
            position={[team.last_lat, team.last_lon]}
            icon={teamIcon(team.color)}
          >
            <Popup>
              <strong style={{ color: team.color }}>{team.name}</strong> ({team.callsign})
              <br />
              Status: {team.status}
              <br />
              {team.last_position_at && (
                <span className="text-xs">
                  Last update: {new Date(team.last_position_at).toLocaleTimeString()}
                </span>
              )}
            </Popup>
          </Marker>
        );
      })}

      {/* UK Airspace restrictions overlay */}
      <AirspaceLayer visible={showAirspace} />

      {/* SAR overlays (LPB rings, travel circles, hazards, route) */}
      <SarOverlays datumLat={operation.datum_lat} datumLon={operation.datum_lon} />

      {/* Click-to-set-datum handler */}
      {settingDatum && onDatumSet && (
        <DatumClickHandler onSet={(lat, lon) => {
          onDatumSet(lat, lon);
          setSettingDatum(false);
        }} />
      )}

      {/* Click-to-add-secondary-datum handler */}
      {addingDatum && onSecondaryDatumPick && (
        <DatumClickHandler onSet={(lat, lon) => {
          onSecondaryDatumPick(lat, lon);
          setAddingDatum(false);
        }} />
      )}

      <FitBounds operation={operation} />
      <InvalidateSizeOnResize trigger={mobilePanelOpen} />
    </MapContainer>

    {/* Setting datum banner */}
    {settingDatum && (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-accent text-black rounded-lg text-sm font-medium shadow-lg animate-pulse">
        Click the map to set the primary datum
      </div>
    )}
    {addingDatum && (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-amber-500 text-black rounded-lg text-sm font-medium shadow-lg animate-pulse">
        Click the map to drop a secondary datum
      </div>
    )}
    </div>
  );
}

function InvalidateSizeOnResize({ trigger }: { trigger: unknown }) {
  const map = useMap();
  useEffect(() => {
    // Run on mount and whenever trigger changes (e.g. mobile drawer open/close)
    const t = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(t);
  }, [trigger, map]);
  return null;
}

function DatumClickHandler({ onSet }: { onSet: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onSet(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function ZoneLayer({
  zone,
  isSelected,
  onSelect,
  teamColor,
}: {
  zone: SearchZone;
  isSelected: boolean;
  onSelect: () => void;
  teamColor?: string;
}) {
  const color = teamColor || STATUS_COLORS[zone.status] || "#6b7280";
  const weight = isSelected ? 4 : PRIORITY_WEIGHTS[zone.priority] || 2;
  const fillOpacity = zone.status === "complete"
    ? 0.1
    : isSelected
    ? 0.3
    : 0.15;

  if (!zone.geometry) return null;

  return (
    <GeoJSON
      key={zone.id}
      data={zone.geometry}
      style={{
        color,
        weight,
        fillColor: color,
        fillOpacity,
        dashArray: zone.status === "suspended" ? "5,5" : undefined,
      }}
      eventHandlers={{
        click: onSelect,
      }}
      onEachFeature={(feature, layer) => {
        layer.bindTooltip(
          `<b>${zone.name}</b><br/>
          ${zone.search_method.replace(/_/g, " ")}<br/>
          POD: ${Math.round(zone.cumulative_pod * 100)}%<br/>
          Status: ${zone.status}`,
          { sticky: true, className: "leaflet-tooltip-dark" }
        );
      }}
    />
  );
}

function FitBounds({ operation }: { operation: SearchOperation }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    // Only auto-fit once per mount; once zones exist and we've fit, leave the user's pan/zoom alone.
    if (fittedRef.current) return;
    const zones = (operation.zones || []).filter((z) => z.geometry);
    if (zones.length > 0) {
      try {
        const group = L.featureGroup(zones.map((z) => L.geoJSON(z.geometry as any)));
        if (group.getLayers().length > 0) {
          map.fitBounds(group.getBounds().pad(0.1));
          fittedRef.current = true;
          return;
        }
      } catch {
        // fallback to datum
      }
    }
    if (operation.datum_lat && operation.datum_lon) {
      map.setView([operation.datum_lat, operation.datum_lon], 14);
      fittedRef.current = true;
    }
  }, [operation.zones?.length, operation.datum_lat, operation.datum_lon, map]);

  return null;
}
