"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map as MLMap, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation, SearchDatum } from "@/types/search";
import type { MapPrefs } from "@/lib/api";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import { TERRAIN_FILL, compositionLabel } from "@/lib/terrainClassifier";

// Status colours mirror the 2D map so the two views read consistently.
const STATUS_COLORS: Record<string, string> = {
  unassigned: "#6b7280",
  assigned: "#3b82f6",
  in_progress: "#f59e0b",
  complete: "#22c55e",
  suspended: "#ef4444",
};

// Priority drives extrusion height: higher-probability zones stand taller so
// the operator can see at a glance where to focus. Base is 120m, cap at 900m.
const PRIORITY_HEIGHT_M: Record<number, number> = {
  1: 900,
  2: 650,
  3: 400,
  4: 240,
  5: 120,
};

const DATUM_KIND_COLORS: Record<string, string> = {
  lkp: "#ef4444",
  plp: "#f59e0b",
  sighting: "#3b82f6",
  witness: "#8b5cf6",
  other: "#64748b",
};

type BasemapId = NonNullable<MapPrefs["basemap"]>;

interface BasemapDef {
  id: BasemapId;
  label: string;
  tiles: string[];
  attribution: string;
  maxzoom?: number;
  tileSize?: number;
  background: string;
}

// Four built-in basemaps. Teams can pick whichever suits their theatre — dark
// for control rooms, satellite for terrain familiarity, OS-style for UK ground.
export const BASEMAPS: BasemapDef[] = [
  {
    id: "carto-dark",
    label: "Carto Dark",
    tiles: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    ],
    attribution: "© OpenStreetMap · © CARTO",
    background: "#0a0e1a",
  },
  {
    id: "carto-light",
    label: "Carto Light",
    tiles: [
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
    ],
    attribution: "© OpenStreetMap · © CARTO",
    background: "#f3f4f6",
  },
  {
    id: "osm",
    label: "OSM Standard",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
    ],
    attribution: "© OpenStreetMap",
    background: "#aad3df",
  },
  {
    id: "satellite",
    label: "ESRI Satellite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "© Esri, Maxar, Earthstar Geographics",
    background: "#000",
  },
  {
    id: "terrain",
    label: "Stamen Terrain",
    tiles: [
      "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png",
    ],
    attribution: "© Stadia Maps · © Stamen · © OpenStreetMap",
    background: "#cfd5cf",
  },
];

function basemapById(id: BasemapId): BasemapDef {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

interface SearchMap3DProps {
  operation: SearchOperation;
  onDatumSet?: (lat: number, lon: number) => void;
  onSecondaryDatumPick?: (lat: number, lon: number) => void;
}

export function SearchMap3D({ operation, onDatumSet, onSecondaryDatumPick }: SearchMap3DProps) {
  const {
    mapPrefs,
    settingDatum,
    setSettingDatum,
    addingDatum,
    setAddingDatum,
    selectedZoneId,
    selectZone,
  } = useSearchStore();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const readyRef = useRef(false);
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const popupRef = useRef<Popup | null>(null);

  // Keep click handlers fresh without re-binding.
  const onDatumSetRef = useRef(onDatumSet);
  const onSecondaryRef = useRef(onSecondaryDatumPick);
  useEffect(() => { onDatumSetRef.current = onDatumSet; }, [onDatumSet]);
  useEffect(() => { onSecondaryRef.current = onSecondaryDatumPick; }, [onSecondaryDatumPick]);
  const settingDatumRef = useRef(settingDatum);
  const addingDatumRef = useRef(addingDatum);
  useEffect(() => { settingDatumRef.current = settingDatum; }, [settingDatum]);
  useEffect(() => { addingDatumRef.current = addingDatum; }, [addingDatum]);
  const selectZoneRef = useRef(selectZone);
  useEffect(() => { selectZoneRef.current = selectZone; }, [selectZone]);

  // ── Feature collections ──────────────────────────────────────
  const zonesFC: FeatureCollection<Polygon, any> = useMemo(() => {
    const feats: Feature<Polygon, any>[] = [];
    for (const z of operation.zones || []) {
      const g = (z.geometry as any)?.geometry || z.geometry;
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
      const statusColor = STATUS_COLORS[z.status] || "#6b7280";
      // Terrain tint only applies to unassigned cells — once a team's on it,
      // the team/status colour wins so the controller can see assignment.
      const assignedColor = operation.teams?.find((t) => t.id === z.assigned_team_id)?.color;
      const unassigned = z.status === "unassigned" && !assignedColor;
      const terrainClass = z.terrain_class;
      const color = assignedColor
        || (unassigned && terrainClass ? TERRAIN_FILL[terrainClass] : statusColor);
      const heightM = PRIORITY_HEIGHT_M[z.priority] || 200;
      // Selection bump gives the chosen zone a visible lift above its siblings.
      const lift = z.id === selectedZoneId ? 200 : 0;
      const polys: Polygon[] = g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][]).map((c) => ({ type: "Polygon" as const, coordinates: c }))
        : [{ type: "Polygon" as const, coordinates: (g.coordinates as number[][][]) }];
      for (const poly of polys) {
        feats.push({
          type: "Feature",
          geometry: poly,
          properties: {
            id: z.id,
            name: z.name,
            status: z.status,
            priority: z.priority,
            color,
            heightM: heightM + lift,
            podPct: Math.round((z.cumulative_pod || 0) * 100),
            method: (z.search_method || "").replace(/_/g, " "),
            selected: z.id === selectedZoneId ? 1 : 0,
            terrainClass: terrainClass || null,
            terrainLabel: compositionLabel(z.terrain_composition),
          },
        });
      }
    }
    return { type: "FeatureCollection", features: feats };
  }, [operation.zones, selectedZoneId]);

  const zoneLabelsFC: FeatureCollection<Point, any> = useMemo(() => {
    const feats: Feature<Point, any>[] = [];
    for (const z of operation.zones || []) {
      const g = (z.geometry as any)?.geometry || z.geometry;
      if (!g?.coordinates) continue;
      const ring = g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])[0]?.[0]
        : (g.coordinates as number[][][])[0];
      if (!ring?.length) continue;
      let sx = 0, sy = 0;
      for (const c of ring) { sx += c[0]; sy += c[1]; }
      feats.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [sx / ring.length, sy / ring.length] },
        properties: { id: z.id, name: z.name, podPct: Math.round((z.cumulative_pod || 0) * 100) },
      });
    }
    return { type: "FeatureCollection", features: feats };
  }, [operation.zones]);

  const datumsFC: FeatureCollection<Point, any> = useMemo(() => {
    const feats: Feature<Point, any>[] = [];
    if (operation.datum_lat != null && operation.datum_lon != null) {
      feats.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [operation.datum_lon, operation.datum_lat] },
        properties: { id: "primary", label: "Primary (LKP)", kind: "lkp", color: DATUM_KIND_COLORS.lkp, isPrimary: 1 },
      });
    }
    for (const d of operation.datums || []) {
      feats.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [d.lon, d.lat] },
        properties: {
          id: d.id, label: d.label, kind: d.kind,
          color: DATUM_KIND_COLORS[d.kind] || DATUM_KIND_COLORS.other,
          isPrimary: 0,
        },
      });
    }
    return { type: "FeatureCollection", features: feats };
  }, [operation.datum_lat, operation.datum_lon, operation.datums]);

  const teamsFC: FeatureCollection<Point, any> = useMemo(() => {
    const feats: Feature<Point, any>[] = [];
    for (const t of operation.teams || []) {
      if (t.last_lat == null || t.last_lon == null) continue;
      feats.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [t.last_lon, t.last_lat] },
        properties: {
          id: t.id, name: t.name, callsign: t.callsign || "",
          color: t.color || "#00d4ff", status: t.status,
        },
      });
    }
    return { type: "FeatureCollection", features: feats };
  }, [operation.teams]);

  // ── Style builder ─────────────────────────────────────────────
  // Rebuilt when the user swaps basemap. We keep sources/layers declarative so
  // a full setStyle() restores everything without manually re-adding each one.
  const buildStyle = (basemapId: BasemapId): maplibregl.StyleSpecification => {
    const bm = basemapById(basemapId);
    return {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        basemap: {
          type: "raster",
          tiles: bm.tiles,
          tileSize: bm.tileSize ?? 256,
          maxzoom: bm.maxzoom ?? 19,
          attribution: bm.attribution,
        },
        "terrain-dem": {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 15,
          encoding: "terrarium",
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": bm.background } },
        { id: "basemap", type: "raster", source: "basemap" },
        {
          id: "hillshade",
          type: "hillshade",
          source: "terrain-dem",
          paint: {
            "hillshade-shadow-color": basemapId === "carto-light" ? "#334155" : "#0a0e1a",
            "hillshade-highlight-color": "#5eead4",
            "hillshade-accent-color": "#0891b2",
            "hillshade-exaggeration": 0.5,
            "hillshade-illumination-direction": 315,
          },
          layout: { visibility: "visible" },
        },
      ],
    };
  };

  // Wire empty operational sources + layers after a style (re)load.
  const installOperationalLayers = (map: MLMap) => {
    const emptyFC = { type: "FeatureCollection" as const, features: [] };
    map.addSource("zones", { type: "geojson", data: emptyFC });
    map.addSource("zone-labels", { type: "geojson", data: emptyFC });
    map.addSource("datums", { type: "geojson", data: emptyFC });
    map.addSource("teams", { type: "geojson", data: emptyFC });

    // Flat zone outline / fill — always visible, 3D extrusion rides on top.
    map.addLayer({
      id: "zone-fill",
      type: "fill",
      source: "zones",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 },
    });
    map.addLayer({
      id: "zone-outline",
      type: "line",
      source: "zones",
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["case", ["==", ["get", "selected"], 1], 3, 1.5],
        "line-opacity": 0.85,
      },
    });

    // 3D extrusion — toggled with mapPrefs.extrude_zones.
    map.addLayer({
      id: "zone-extrusion",
      type: "fill-extrusion",
      source: "zones",
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["get", "heightM"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.55,
      },
    });

    map.addLayer({
      id: "zone-label",
      type: "symbol",
      source: "zone-labels",
      layout: {
        "text-field": ["concat", ["get", "name"], "\n", ["get", "podPct"], "% POD"],
        "text-size": 11,
        "text-offset": [0, 0],
        "text-anchor": "center",
        "text-allow-overlap": false,
        "text-font": ["Open Sans Regular"],
      },
      paint: {
        "text-color": "#f8fafc",
        "text-halo-color": "rgba(0,0,0,0.8)",
        "text-halo-width": 1.4,
      },
    });

    // Datums — rendered as ringed dots with labels above.
    map.addLayer({
      id: "datum-halo",
      type: "circle",
      source: "datums",
      paint: {
        "circle-radius": ["case", ["==", ["get", "isPrimary"], 1], 16, 12],
        "circle-color": ["get", "color"],
        "circle-opacity": 0.18,
        "circle-blur": 0.5,
      },
    });
    map.addLayer({
      id: "datum-dot",
      type: "circle",
      source: "datums",
      paint: {
        "circle-radius": ["case", ["==", ["get", "isPrimary"], 1], 7, 5],
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "datum-label",
      type: "symbol",
      source: "datums",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, -1.4],
        "text-anchor": "bottom",
        "text-font": ["Open Sans Regular"],
      },
      paint: {
        "text-color": "#f8fafc",
        "text-halo-color": "rgba(0,0,0,0.85)",
        "text-halo-width": 1.4,
      },
    });

    // Teams — coloured pucks that follow last reported position.
    map.addLayer({
      id: "team-halo",
      type: "circle",
      source: "teams",
      paint: {
        "circle-radius": 12,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.25,
        "circle-blur": 0.6,
      },
    });
    map.addLayer({
      id: "team-dot",
      type: "circle",
      source: "teams",
      paint: {
        "circle-radius": 6,
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "team-label",
      type: "symbol",
      source: "teams",
      layout: {
        "text-field": ["coalesce", ["get", "callsign"], ["get", "name"]],
        "text-size": 10,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-font": ["Open Sans Regular"],
      },
      paint: {
        "text-color": "#e5e7eb",
        "text-halo-color": "rgba(0,0,0,0.85)",
        "text-halo-width": 1.2,
      },
    });
  };

  // ── Map init ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const start: [number, number] = operation.datum_lat && operation.datum_lon
      ? [operation.datum_lon, operation.datum_lat]
      : [-4.63, 55.46];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(mapPrefs.basemap),
      center: start,
      zoom: 12,
      pitch: mapPrefs.show_3d ? mapPrefs.pitch : 0,
      attributionControl: false,
      maxPitch: 75,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

    const onLoad = () => {
      installOperationalLayers(map);
      try {
        map.setTerrain({
          source: "terrain-dem",
          exaggeration: mapPrefs.show_terrain ? mapPrefs.exaggeration : 0,
        });
      } catch {}

      // Click-to-pick — primary datum wins if both modes happen to be set.
      map.on("click", (e) => {
        if (settingDatumRef.current && onDatumSetRef.current) {
          onDatumSetRef.current(e.lngLat.lat, e.lngLat.lng);
          setSettingDatum(false);
          return;
        }
        if (addingDatumRef.current && onSecondaryRef.current) {
          onSecondaryRef.current(e.lngLat.lat, e.lngLat.lng);
          setAddingDatum(false);
          return;
        }
      });

      // Zone click → select + popup.
      map.on("click", "zone-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        if (settingDatumRef.current || addingDatumRef.current) return;
        const p = f.properties as any;
        selectZoneRef.current(p.id);
        if (popupRef.current) popupRef.current.remove();
        const terrainLine = p.terrainLabel
          ? `<div style="color:#9ca3af;"><span style="color:#cbd5e1">terrain:</span> ${escapeHtml(p.terrainLabel)}</div>`
          : "";
        popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 12 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-size:11px;line-height:1.55;color:#e5e7eb;min-width:160px;">
              <div style="font-weight:600;color:#fff;margin-bottom:2px;">${escapeHtml(p.name ?? "")}</div>
              <div style="color:#9ca3af;">${escapeHtml(p.method ?? "")} · priority ${p.priority}</div>
              <div>POD: ${p.podPct}% · ${escapeHtml(p.status ?? "")}</div>
              ${terrainLine}
            </div>`
          )
          .addTo(map);
      });

      map.on("mouseenter", "zone-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "zone-fill", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "datum-dot", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "datum-dot", () => { map.getCanvas().style.cursor = ""; });

      // Street-lens: debounced pointer → store. The subscribing StreetLens
      // component handles the fetch (and only while the layer toggle is on).
      let lensTimer: number | null = null;
      const setLensPoint = (lat: number | null, lon: number | null) => {
        const { mapPrefs, setStreetLensPoint } = useSearchStore.getState();
        if (!mapPrefs.show_street_lens) return;
        setStreetLensPoint(lat !== null && lon !== null ? [lat, lon] : null);
      };
      map.on("mousemove", (e) => {
        if (lensTimer !== null) window.clearTimeout(lensTimer);
        lensTimer = window.setTimeout(() => setLensPoint(e.lngLat.lat, e.lngLat.lng), 180);
      });
      map.on("mouseout", () => {
        if (lensTimer !== null) window.clearTimeout(lensTimer);
        setLensPoint(null, null);
      });

      readyRef.current = true;
      setMapReady(true);
    };

    if (map.loaded()) onLoad();
    else map.on("load", onLoad);

    mapRef.current = map;

    // MapLibre occasionally initialises before the flex container has its
    // final size — the canvas ends up 0×0 and stays transparent even though
    // tiles load. A ResizeObserver on the container reliably kicks it into
    // rendering once layout settles.
    const ro = new ResizeObserver(() => {
      try { map.resize(); } catch {}
    });
    ro.observe(containerRef.current);

    return () => {
      readyRef.current = false;
      setMapReady(false);
      ro.disconnect();
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Basemap switch: full restyle, then re-install layers ──
  const lastBasemapRef = useRef<BasemapId>(mapPrefs.basemap);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (lastBasemapRef.current === mapPrefs.basemap) return;
    lastBasemapRef.current = mapPrefs.basemap;
    map.setStyle(buildStyle(mapPrefs.basemap));
    map.once("styledata", () => {
      if (!map.getSource("zones")) installOperationalLayers(map);
      try {
        map.setTerrain({
          source: "terrain-dem",
          exaggeration: mapPrefs.show_terrain ? mapPrefs.exaggeration : 0,
        });
      } catch {}
      applyAllLayerVisibility();
      pushAllSources();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapPrefs.basemap, mapReady]);

  // ── Push sources whenever data changes ──
  const pushAllSources = () => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("zones") as maplibregl.GeoJSONSource | undefined)?.setData(zonesFC as any);
    (map.getSource("zone-labels") as maplibregl.GeoJSONSource | undefined)?.setData(zoneLabelsFC as any);
    (map.getSource("datums") as maplibregl.GeoJSONSource | undefined)?.setData(datumsFC as any);
    (map.getSource("teams") as maplibregl.GeoJSONSource | undefined)?.setData(teamsFC as any);
  };

  useEffect(() => { if (mapReady) pushAllSources(); /* eslint-disable-next-line */ }, [zonesFC, zoneLabelsFC, datumsFC, teamsFC, mapReady]);

  // ── Apply layer visibility from prefs ──
  const applyAllLayerVisibility = () => {
    const map = mapRef.current;
    if (!map) return;
    const show = (id: string, v: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
    };
    show("hillshade", mapPrefs.show_hillshade);
    show("zone-extrusion", mapPrefs.show_3d && mapPrefs.extrude_zones);
    show("zone-label", mapPrefs.show_zone_labels);
    show("datum-halo", mapPrefs.show_datums);
    show("datum-dot", mapPrefs.show_datums);
    show("datum-label", mapPrefs.show_datums);
    show("team-halo", mapPrefs.show_teams);
    show("team-dot", mapPrefs.show_teams);
    show("team-label", mapPrefs.show_teams);
  };

  useEffect(() => { if (mapReady) applyAllLayerVisibility(); /* eslint-disable-next-line */ }, [
    mapPrefs.show_3d, mapPrefs.show_hillshade, mapPrefs.extrude_zones,
    mapPrefs.show_zone_labels, mapPrefs.show_datums, mapPrefs.show_teams, mapReady,
  ]);

  // ── 3D toggle: pitch + terrain exaggeration ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const targetPitch = mapPrefs.show_3d ? mapPrefs.pitch : 0;
    const exaggeration = mapPrefs.show_terrain && mapPrefs.show_3d ? mapPrefs.exaggeration : 0;
    try { map.setTerrain({ source: "terrain-dem", exaggeration }); } catch {}
    map.easeTo({ pitch: targetPitch, duration: 600 });
  }, [mapPrefs.show_3d, mapPrefs.pitch, mapPrefs.show_terrain, mapPrefs.exaggeration, mapReady]);

  // ── Fit bounds once ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || fittedRef.current) return;
    const pts: [number, number][] = [];
    if (operation.datum_lat != null && operation.datum_lon != null) {
      pts.push([operation.datum_lon, operation.datum_lat]);
    }
    for (const z of operation.zones || []) {
      const g = (z.geometry as any)?.geometry || z.geometry;
      if (!g?.coordinates) continue;
      const ring = g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])[0]?.[0]
        : (g.coordinates as number[][][])[0];
      if (ring) for (const c of ring) pts.push([c[0], c[1]]);
    }
    if (pts.length === 0) return;
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    map.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 80, duration: 600, maxZoom: 14, pitch: mapPrefs.show_3d ? mapPrefs.pitch : 0 },
    );
    fittedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation.zones?.length, operation.datum_lat, operation.datum_lon, mapReady]);

  // ── Fly-to from other panels ──
  const flyTo = useSearchStore((s) => s.mapFlyTo);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !flyTo) return;
    map.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: flyTo.zoom ?? Math.max(map.getZoom(), 14), duration: 700 });
  }, [flyTo?.nonce, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full w-full relative">
      <div ref={containerRef} className="h-full w-full" style={{ background: basemapById(mapPrefs.basemap).background }} />

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

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
