"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useSearchStore } from "@/stores/search";
import { searchHelpers } from "@/lib/api";
import { AirspaceLayer } from "./AirspaceLayer";
import { SarOverlays } from "./SarOverlays";
import type { SearchOperation, SearchZone, SearchDatum } from "@/types/search";
import { TERRAIN_FILL, compositionLabel } from "@/lib/terrainClassifier";
import { nextSearchableWindow, formatWindowStatus, TIDE_STATE_FILL } from "@/lib/tideWindows";
import { BASEMAPS } from "./SearchMap3D";
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
    mobilePanelOpen,
    addingDatum,
    setAddingDatum,
    gridDatumId,
    mapPrefs,
  } = useSearchStore();

  // Per-user basemap — MapLayerPanel writes this; we pick the matching tile
  // source (fallback to carto-dark). Leaflet re-mounts the <TileLayer> when
  // the `key` changes, so swapping is instant rather than leaking the old
  // layer underneath.
  const basemap = BASEMAPS.find((b) => b.id === mapPrefs.basemap) || BASEMAPS[0];

  // Anchor point for SAR overlays (rings, travel radii) — follows the Datums-tab
  // selection so the user can move the rings between primary + secondary datums.
  const anchorDatum = gridDatumId
    ? (operation.datums || []).find((d) => d.id === gridDatumId) || null
    : null;
  const anchorLat = anchorDatum ? anchorDatum.lat : operation.datum_lat;
  const anchorLon = anchorDatum ? anchorDatum.lon : operation.datum_lon;

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
        key={basemap.id}
        url={basemap.tiles[0]}
        maxZoom={19}
        attribution={basemap.attribution}
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

      {/* Preview zones — dashed outlines, priority-tinted, auto-fit on appear */}
      <PreviewZonesLayer />

      {/* Tier B1 — river corridor centrelines + chainage beads + collection
          point diamonds. Reads both committed river_corridor zones and the
          in-flight Grid Generator preview so operators see chainage BEFORE
          committing. */}
      <RiverCorridorOverlay operation={operation} />

      {/* Zone polygons */}
      {(operation.zones || []).map((zone) => (
        <ZoneLayer
          key={zone.id}
          zone={zone}
          isSelected={selectedZoneId === zone.id}
          onSelect={() => selectZone(zone.id)}
          teamColor={operation.teams?.find((t) => t.id === zone.assigned_team_id)?.color}
          tideOverlay={!!mapPrefs.show_tide_overlay}
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
      <SarOverlays datumLat={anchorLat} datumLon={anchorLon} />

      {/* Hazards/attractors auto-loader — driven by map viewport when the
          Hazards toggle is on in the header */}
      <HazardsAutoLoader />


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
      <MapFlyToListener />
    </MapContainer>

    {/* Top-of-map action bar. When the map is in a pick mode, we take over the
        top-centre with a high-contrast banner + visible Cancel. When no primary
        datum exists we show an empty-state CTA that activates primary-datum
        mode directly — this is the single most common "how do I start?" blocker. */}
    {(settingDatum || addingDatum) && (
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 px-3 py-2 bg-accent text-black rounded-lg text-xs md:text-sm font-semibold shadow-xl">
        <span className="animate-pulse">●</span>
        <span>
          {settingDatum
            ? "Click the map to place the primary datum (LKP)"
            : "Click the map to drop a datum"}
        </span>
        <button
          onClick={() => {
            if (settingDatum) setSettingDatum(false);
            if (addingDatum) setAddingDatum(false);
          }}
          className="ml-1 px-2 py-0.5 bg-black/20 hover:bg-black/30 rounded text-[11px] font-medium"
        >
          Cancel
        </button>
      </div>
    )}
    {!settingDatum && !addingDatum && !operation.datum_lat && !operation.datum_lon && (
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[900] flex items-center gap-2 px-3 py-2 bg-red-500/95 text-white rounded-lg text-xs md:text-sm font-semibold shadow-xl">
        <span>No LKP yet — drop the last known position to begin.</span>
        <button
          onClick={() => setSettingDatum(true)}
          className="px-2.5 py-1 bg-white text-red-600 rounded text-[11px] font-semibold hover:bg-white/90"
        >
          Drop LKP
        </button>
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
  tideOverlay,
}: {
  zone: SearchZone;
  isSelected: boolean;
  onSelect: () => void;
  teamColor?: string;
  tideOverlay?: boolean;
}) {
  // Stroke = status/team colour (unchanged). Fill = terrain tint for
  // unassigned cells with a classification, else fall back to status colour.
  // This lets a controller scan a grid and instantly see water/intertidal
  // cells without checking tooltips.
  const strokeColor = teamColor || STATUS_COLORS[zone.status] || "#6b7280";
  const unassigned = zone.status === "unassigned" && !teamColor;
  const terrainClass = zone.terrain_class;
  // Tier B2: when the tide overlay is on AND this cell is intertidal AND it
  // has windows attached, override the amber terrain fill with the per-state
  // tide colour (green=go / amber=wait / grey=off-forecast).
  const tideWindowStatus = tideOverlay
    && terrainClass === "intertidal"
    && zone.searchable_windows
    && zone.searchable_windows.source !== "unavailable"
    ? nextSearchableWindow(zone.searchable_windows.windows)
    : null;
  const fillColor = tideWindowStatus
    ? TIDE_STATE_FILL[tideWindowStatus.state]
    : unassigned && terrainClass
      ? TERRAIN_FILL[terrainClass]
      : strokeColor;

  const weight = isSelected ? 4 : PRIORITY_WEIGHTS[zone.priority] || 2;
  // Opacity ramp so classified cells are visibly distinct from unclassified:
  //   water/intertidal 0.30 → hazard reads at a glance
  //   mixed            0.25 → "consider splitting"
  //   land             0.22 → subtle but clearly tinted (vs 0.15 unclassified)
  //   unclassified     0.15 → neutral
  const fillOpacity = zone.status === "complete"
    ? 0.1
    : isSelected
    ? 0.35
    : unassigned && (terrainClass === "water" || terrainClass === "intertidal")
    ? 0.3
    : unassigned && terrainClass === "mixed"
    ? 0.25
    : unassigned && terrainClass === "land"
    ? 0.22
    : 0.15;

  if (!zone.geometry) return null;

  const terrainBadge = zone.terrain_composition
    ? `<br/><span style="color:#9ca3af">terrain:</span> ${compositionLabel(zone.terrain_composition)}`
    : "";
  const tideBadge = zone.searchable_windows && zone.searchable_windows.source !== "unavailable"
    ? `<br/><span style="color:#9ca3af">tide:</span> ${formatWindowStatus(nextSearchableWindow(zone.searchable_windows.windows))}`
    : "";
  // Tier B3 — gauge snapshot from corridor metadata (frozen at plan time).
  const corridorMeta = (zone.geometry?.properties as any)?.corridor_metadata
    ?? zone.corridor_metadata;
  const gaugeBadge = corridorMeta?.kind === "parent" && corridorMeta.gauge_ref && corridorMeta.gauge_ref.stage_m != null
    ? `<br/><span style="color:#9ca3af">gauge:</span> ${corridorMeta.gauge_ref.stage_m.toFixed(2)} m · ${corridorMeta.gauge_ref.trend} · ${corridorMeta.gauge_ref.label}`
    : "";

  return (
    <GeoJSON
      key={`${zone.id}:${terrainClass || "-"}:${tideWindowStatus?.state ?? "-"}`}
      data={zone.geometry}
      style={{
        color: strokeColor,
        weight,
        fillColor,
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
          Status: ${zone.status}${terrainBadge}${tideBadge}${gaugeBadge}`,
          { sticky: true, className: "leaflet-tooltip-dark" }
        );
      }}
    />
  );
}

// Watches store.mapFlyTo and pans/zooms the leaflet map on demand. Other panels
// (subject timeline, reports) dispatch coords through the store rather than
// threading a map ref through React props.
function MapFlyToListener() {
  const map = useMap();
  const flyTo = useSearchStore((s) => s.mapFlyTo);
  useEffect(() => {
    if (!flyTo) return;
    const z = flyTo.zoom ?? Math.max(map.getZoom(), 15);
    map.flyTo([flyTo.lat, flyTo.lon], z, { duration: 0.6 });
  }, [flyTo?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
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

// Watches the Hazards toggle + map viewport. When enabled, fetches OSM
// hazards/attractors for the current bounds via siphon's OSM endpoint and
// refetches (debounced) after pan/zoom. Large viewports (> ~20km span) are
// skipped to avoid punishing the Overpass proxy — a small banner is shown
// asking the user to zoom in via the store's hazardsHint flag.
// Renders the preview zones produced by the Grid Generator. Styling is tinted
// by priority so the operator can see at a glance where the high-value cells
// are before committing. The first time the preview appears (or zone count
// changes) we fit the map to the preview bounds — if you generate 40 zones
// you want to see all 40, not just whatever the previous viewport happened to
// contain. Label markers at each polygon centroid show the zone name; kept
// non-interactive so they don't steal clicks from the underlying polygon.
function PreviewZonesLayer() {
  const map = useMap();
  const previewZones = useSearchStore((s) => s.previewZones);
  const tideOverlay = useSearchStore((s) => !!s.mapPrefs.show_tide_overlay);
  const lastCountRef = useRef(0);

  // Fit only when the count changes (0 → N or N → M). Including `previewZones`
  // itself in the dep array would re-fit on every unrelated store update since
  // Zustand returns fresh array references.
  useEffect(() => {
    const len = previewZones.length;
    if (len === 0) { lastCountRef.current = 0; return; }
    if (lastCountRef.current === len) return;
    lastCountRef.current = len;
    try {
      const group = L.featureGroup(
        previewZones
          .map((pz: any) => (pz?.geometry ? L.geoJSON(pz.geometry as any) : null))
          .filter(Boolean) as L.Layer[]
      );
      if (group.getLayers().length > 0) {
        map.fitBounds(group.getBounds().pad(0.2), { animate: true, duration: 0.5 });
      }
    } catch {
      // Malformed preview geometry — not worth bubbling, user can still inspect.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewZones.length, map]);

  if (previewZones.length === 0) return null;

  return (
    <>
      {previewZones.flatMap((pz: any, i: number) => {
        if (!pz?.geometry) return [];
        const priority = typeof pz.priority === "number" ? pz.priority : 3;
        const strokeColor = priorityColor(priority);
        // Preview terrain tint: once classifyCells has folded terrain_class
        // into the preview payload, fill reflects the terrain so the operator
        // sees water/intertidal BEFORE hitting Create. Without classification
        // we stay on the legacy priority-coloured dashed outline.
        const terrainClass = pz.terrain_class as
          | "land" | "water" | "intertidal" | "mixed" | undefined;
        const pzTideStatus = tideOverlay
          && terrainClass === "intertidal"
          && pz.searchable_windows
          && pz.searchable_windows.source !== "unavailable"
          ? nextSearchableWindow(pz.searchable_windows.windows)
          : null;
        const fillColor = pzTideStatus
          ? TIDE_STATE_FILL[pzTideStatus.state]
          : terrainClass
            ? TERRAIN_FILL[terrainClass]
            : strokeColor;
        const fillOpacity = terrainClass === "water" || terrainClass === "intertidal"
          ? 0.3
          : terrainClass === "mixed"
          ? 0.22
          : terrainClass === "land"
          ? 0.18
          : 0.12;
        const geom: GeoJSON.Geometry =
          (pz.geometry as GeoJSON.Feature).geometry || (pz.geometry as GeoJSON.Geometry);
        const centroid = centroidOfGeometry(geom);
        const key = `preview-${i}-${terrainClass || "-"}-${pzTideStatus?.state ?? "-"}-${JSON.stringify(pz.geometry).length}`;
        const items: any[] = [
          <GeoJSON
            key={key}
            data={pz.geometry}
            style={{
              color: strokeColor,
              weight: 2,
              fillColor,
              fillOpacity,
              dashArray: "4,4",
            }}
          />,
        ];
        if (centroid && pz.name) {
          items.push(
            <Marker
              key={`${key}-label`}
              position={centroid}
              icon={previewLabelIcon(pz.name, priority)}
              interactive={false}
            />
          );
        }
        return items;
      })}
    </>
  );
}

function priorityColor(p: number): string {
  // Priority 1 = most likely search area. Fade toward muted amber for lower
  // priority so the eye lands on high-POA cells first.
  if (p <= 1) return "#f87171"; // red-400
  if (p === 2) return "#fbbf24"; // amber-400
  if (p === 3) return "#f59e0b"; // amber-500
  if (p === 4) return "#d97706"; // amber-600
  return "#92400e"; // amber-800
}

function previewLabelIcon(name: string, priority: number): L.DivIcon {
  const color = priorityColor(priority);
  return L.divIcon({
    html: `<div style="padding:1px 5px;background:rgba(17,24,39,0.85);color:${color};border:1px solid ${color}66;border-radius:3px;font-size:10px;font-family:system-ui;font-weight:600;white-space:nowrap;transform:translate(-50%,-50%)">${escapeHtml(name)}</div>`,
    className: "",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

// Cheap arithmetic centroid from the first ring / coord list. Good enough for
// placing a label — we're not computing anything that depends on accuracy.
function centroidOfGeometry(geom: GeoJSON.Geometry): [number, number] | null {
  try {
    let coords: number[][] = [];
    if (geom.type === "Polygon") {
      coords = (geom.coordinates as number[][][])[0];
    } else if (geom.type === "MultiPolygon") {
      coords = (geom.coordinates as number[][][][])[0][0];
    } else if (geom.type === "LineString") {
      coords = geom.coordinates as number[][];
    } else if (geom.type === "MultiLineString") {
      coords = (geom.coordinates as number[][][]).flat();
    } else if (geom.type === "Point") {
      const c = geom.coordinates as number[];
      return [c[1], c[0]];
    } else {
      return null;
    }
    if (!coords.length) return null;
    let sx = 0;
    let sy = 0;
    for (const c of coords) {
      sx += c[0];
      sy += c[1];
    }
    return [sy / coords.length, sx / coords.length];
  } catch {
    return null;
  }
}

// Tier B1 — river corridor overlay.
//
// For every zone (committed or in-preview) with corridor_metadata of
// kind='parent' we draw:
//  - the centreline as a dashed blue LineString
//  - small numbered "bead" markers at every 100m chainage (0, 100, 200…)
//    with the km reading at km-multiples so operators can call out "body
//    seen at km 2.4" without counting dots.
//  - a red diamond at every collection point (weir/dam/bridge) inside the
//    corridor, with its chainage in the tooltip.
function RiverCorridorOverlay({ operation }: { operation: SearchOperation }) {
  const previewZones = useSearchStore((s) => s.previewZones);

  // Parent zones + their collection-point children, from both committed DB
  // state and the preview list. Preview takes priority for visual feedback.
  type ParentBundle = {
    key: string;
    centreline: Array<[number, number]>;
    chainage: Array<{ lon: number; lat: number; d: number }>;
    riverName: string | null;
  };
  type CPBundle = {
    key: string;
    lat: number;
    lon: number;
    name: string | null;
    kind: string;
    chainage_m: number;
  };

  const parents: ParentBundle[] = [];
  const collectionPts: CPBundle[] = [];

  const scan = (zones: any[], prefix: string) => {
    zones.forEach((z, i) => {
      const props = (z?.geometry as GeoJSON.Feature)?.properties || {};
      const metaInline = (props as any).corridor_metadata;
      const metaCol = (z as any).corridor_metadata;
      const meta = metaInline || metaCol;
      if (!meta) return;
      if (meta.kind === "parent" && Array.isArray(meta.centreline)) {
        parents.push({
          key: `${prefix}-parent-${i}`,
          centreline: meta.centreline,
          chainage: meta.chainage || [],
          riverName: meta.river_name || null,
        });
      } else if (meta.kind === "collection_point") {
        // Pull the representative coord from the zone polygon centroid.
        const geom: GeoJSON.Geometry =
          (z.geometry as GeoJSON.Feature).geometry || (z.geometry as GeoJSON.Geometry);
        const c = centroidOfGeometry(geom);
        if (!c) return;
        collectionPts.push({
          key: `${prefix}-cp-${i}`,
          lat: c[0],
          lon: c[1],
          name: meta.osm_name || null,
          kind: meta.collection_kind || "collection",
          chainage_m: typeof meta.chainage_m === "number" ? meta.chainage_m : 0,
        });
      }
    });
  };
  scan((operation.zones || []) as any[], "db");
  scan(previewZones as any[], "pv");

  if (parents.length === 0 && collectionPts.length === 0) return null;

  return (
    <>
      {parents.map((p) => (
        <GeoJSON
          key={p.key}
          data={{
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: p.centreline },
          } as GeoJSON.Feature}
          style={{
            color: "#38bdf8",
            weight: 2,
            dashArray: "6,4",
            opacity: 0.8,
          }}
        />
      ))}
      {parents.flatMap((p) =>
        p.chainage.map((c) => {
          const isKm = c.d > 0 && c.d % 1000 === 0;
          const isZero = c.d === 0;
          const size = isZero ? 10 : isKm ? 8 : 5;
          const color = isZero ? "#ef4444" : isKm ? "#38bdf8" : "#38bdf8";
          const label = isKm ? `${c.d / 1000} km` : isZero ? "LKP" : "";
          return (
            <Marker
              key={`${p.key}-ch-${c.d}`}
              position={[c.lat, c.lon]}
              icon={L.divIcon({
                html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%)">
                  <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:1px solid rgba(0,0,0,0.4);box-shadow:0 0 3px rgba(0,0,0,0.4)"></div>
                  ${label ? `<div style="margin-top:2px;padding:1px 4px;background:rgba(17,24,39,0.9);color:#fff;border-radius:2px;font-size:9px;font-family:system-ui;white-space:nowrap">${escapeHtml(label)}</div>` : ""}
                </div>`,
                className: "",
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              })}
              interactive={false}
            />
          );
        })
      )}
      {collectionPts.map((cp) => (
        <Marker
          key={cp.key}
          position={[cp.lat, cp.lon]}
          icon={L.divIcon({
            html: `<div style="width:12px;height:12px;background:#ef4444;border:2px solid #fff;transform:rotate(45deg) translate(-50%,-50%);transform-origin:top left;box-shadow:0 0 4px rgba(239,68,68,0.7)"></div>`,
            className: "",
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          })}
        >
          <Popup>
            <strong style={{ color: "#ef4444", textTransform: "uppercase" }}>{cp.kind}</strong>
            {cp.name && <> — {cp.name}</>}
            <br />
            <span className="text-xs">Chainage: {cp.chainage_m < 1000 ? `${Math.round(cp.chainage_m)} m` : `${(cp.chainage_m / 1000).toFixed(2)} km`}</span>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

function HazardsAutoLoader() {
  const map = useMap();
  const { showHazards, showAttractors, setOsmFeatures, setHazardsHint } = useSearchStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeyRef = useRef<string>("");

  const active = showHazards || showAttractors;

  useEffect(() => {
    if (!active) {
      setHazardsHint(null);
      return;
    }

    const fetchBounds = async () => {
      const b = map.getBounds();
      const south = b.getSouth();
      const west = b.getWest();
      const north = b.getNorth();
      const east = b.getEast();

      // Rough span in km. Overpass struggles past ~20km on foot-level hazards.
      const latSpanKm = (north - south) * 111;
      const lonSpanKm = (east - west) * 111 * Math.cos(((north + south) / 2) * Math.PI / 180);
      const maxSpanKm = Math.max(latSpanKm, lonSpanKm);
      if (maxSpanKm > 20) {
        setHazardsHint(`Zoom in to load hazards (current view ~${Math.round(maxSpanKm)} km)`);
        return;
      }

      // Dedup by bbox key — map.invalidateSize fires moveend too, don't re-fetch identically.
      const key = `${south.toFixed(3)}|${west.toFixed(3)}|${north.toFixed(3)}|${east.toFixed(3)}`;
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;

      setHazardsHint("Loading…");
      try {
        const d = await searchHelpers.osmFeatures([south, west, north, east]);
        setOsmFeatures(d.hazards, d.attractors, d.hazard_lines);
        setHazardsHint(null);
      } catch (e) {
        setHazardsHint("Hazard fetch failed");
      }
    };

    const trigger = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fetchBounds, 700);
    };

    trigger();
    map.on("moveend", trigger);
    return () => {
      map.off("moveend", trigger);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, map, setOsmFeatures, setHazardsHint]);

  return null;
}
