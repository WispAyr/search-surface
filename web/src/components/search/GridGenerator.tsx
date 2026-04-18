"use client";

import { useEffect, useRef, useState } from "react";
import bboxFn from "@turf/bbox";
import { search, searchHelpers } from "@/lib/api";
import { generateGrid } from "@/lib/gridGenerator";
import { classifyCells, processTerrain, type ProcessedTerrain } from "@/lib/terrainClassifier";
import {
  fetchTide,
  computeSearchableWindows,
  buildSearchableWindows,
  DEFAULT_THRESHOLD_M,
} from "@/lib/tideWindows";
import {
  fetchGauges,
  nearestGauge,
  gaugeStateLabel,
  gaugeSuggestPreset,
  gaugeSparkline,
  GAUGE_TREND_FILL,
  type NearestGauge,
} from "@/lib/riverGauges";
import { useSearchStore } from "@/stores/search";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { SearchOperation, GridGenerationParams } from "@/types/search";
import { X, Grid3X3, Hexagon, RotateCw, Route, Target, Dog, Plane, Waves, Loader2, AlertTriangle, Activity } from "lucide-react";

interface GridGeneratorProps {
  operation: SearchOperation;
  onRefresh?: () => void | Promise<void>;
}

const GRID_TYPES = [
  { id: "parallel", label: "Parallel Grid", icon: Grid3X3, desc: "Regular square cells over search area" },
  { id: "hex", label: "Hex Grid", icon: Hexagon, desc: "Hexagonal cells — better coverage uniformity" },
  { id: "expanding_square", label: "Expanding Square", icon: RotateCw, desc: "Spiral from datum — high priority centre" },
  { id: "route_buffer", label: "Route Corridor", icon: Route, desc: "Buffer along a travel route" },
  { id: "point", label: "Point Search", icon: Target, desc: "Circle radius from a location" },
  { id: "k9_scent", label: "K9 Scent Cone", icon: Dog, desc: "Wind-based scent cone from datum" },
  { id: "drone_lawnmower", label: "Drone Pattern", icon: Plane, desc: "Lawnmower flight path for drone coverage" },
  { id: "river_corridor", label: "River Corridor", icon: Waves, desc: "Downstream drift corridor from LKP" },
] as const;

// River velocity presets (m/s surface velocity). Field operator picks the
// best fit from memory of the water, or clicks "Use gauge" (Tier B3) when
// available. These are surface velocities — Carlson coefficient is applied
// inside the corridor builder.
const RIVER_VELOCITY_PRESETS = [
  { id: "slow_meander", label: "Slow meander (0.2 m/s)", v: 0.2 },
  { id: "pool", label: "Pool / backwater (0.4 m/s)", v: 0.4 },
  { id: "normal", label: "Normal flow (0.8 m/s)", v: 0.8 },
  { id: "fast", label: "Fast / rapids (1.5 m/s)", v: 1.5 },
  { id: "spate", label: "Spate (3.0 m/s)", v: 3.0 },
] as const;

export function GridGenerator({ operation, onRefresh }: GridGeneratorProps) {
  const { toggleGridGenerator, setPreviewZones, gridDatumId, setGridDatumId, setSettingDatum } = useSearchStore();
  useEscapeKey(toggleGridGenerator);
  const [gridType, setGridType] = useState<string>("parallel");
  const [cellSize, setCellSize] = useState(500);
  const [radius, setRadius] = useState(500);
  const [maxLegs, setMaxLegs] = useState(12);
  const [legSize, setLegSize] = useState(200);
  const [windDirection, setWindDirection] = useState(270);
  const [windSpeed, setWindSpeed] = useState(10);
  const [scentRangeM, setScentRangeM] = useState(400);
  const [droneCount, setDroneCount] = useState(1);
  const [droneAltM, setDroneAltM] = useState(50);
  const [droneOverlap, setDroneOverlap] = useState(20);
  // River corridor (Tier B1) state
  const [riverHours, setRiverHours] = useState(3);
  const [riverVelocity, setRiverVelocity] = useState(0.8);
  const [riverFloater, setRiverFloater] = useState(false);
  const [riverFetching, setRiverFetching] = useState(false);
  const [riverWarnings, setRiverWarnings] = useState<string[]>([]);
  const [riverError, setRiverError] = useState<string | null>(null);
  // Tier B3 — nearest river gauge. Fetched on operator demand (button), not
  // automatically; auto-fetch would hit SEPA/EA on every LKP nudge.
  const [gaugeLookup, setGaugeLookup] = useState<NearestGauge | null>(null);
  const [gaugeFetching, setGaugeFetching] = useState(false);
  const [gaugeError, setGaugeError] = useState<string | null>(null);
  const [gaugePartial, setGaugePartial] = useState(false);
  const [preview, setPreview] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [classifying, setClassifying] = useState(false);
  // Cache processed terrain per rounded bbox so regenerating with tweaked
  // params doesn't hit Overpass again. Ref so it survives re-renders.
  const terrainCacheRef = useRef<Map<string, ProcessedTerrain>>(new Map());

  // Resolve datum: selected secondary datum takes precedence, else primary datum
  const selectedSecondary = gridDatumId
    ? (operation.datums || []).find((d) => d.id === gridDatumId)
    : null;
  const datum: [number, number] | null = selectedSecondary
    ? [selectedSecondary.lat, selectedSecondary.lon]
    : operation.datum_lat && operation.datum_lon
      ? [operation.datum_lat, operation.datum_lon]
      : null;
  const datumLabel = selectedSecondary
    ? `${selectedSecondary.kind.toUpperCase()} — ${selectedSecondary.label}`
    : datum
      ? "Primary datum"
      : "No datum";

  // Tier B3 — operator-triggered gauge lookup. Builds a ~20km bbox around the
  // LKP (big enough to catch the nearest SEPA/EA station on most UK rivers,
  // small enough to avoid flooding the response with irrelevant stations) and
  // picks the closest gauge with a live reading.
  const handleLookupGauge = async () => {
    if (!datum) return;
    setGaugeFetching(true);
    setGaugeError(null);
    try {
      const dDeg = 20000 / 111000; // ≈ 0.18°
      const dLon = dDeg / Math.cos((datum[0] * Math.PI) / 180);
      const bbox: [number, number, number, number] = [
        datum[0] - dDeg,
        datum[1] - dLon,
        datum[0] + dDeg,
        datum[1] + dLon,
      ];
      const res = await fetchGauges(bbox);
      if (!res) { setGaugeError("Gauge service unreachable"); setGaugeLookup(null); return; }
      setGaugePartial(res.partial);
      const nearest = nearestGauge(res.gauges, datum[0], datum[1]);
      if (!nearest) {
        setGaugeError("No gauges with recent readings within 20 km");
        setGaugeLookup(null);
        return;
      }
      setGaugeLookup(nearest);
    } catch (err: any) {
      setGaugeError(err?.message || "Gauge lookup failed");
      setGaugeLookup(null);
    } finally {
      setGaugeFetching(false);
    }
  };

  const handleGenerate = async () => {
    if (!datum && gridType !== "route_buffer") return;

    const params: GridGenerationParams = { type: gridType as any };

    switch (gridType) {
      case "parallel":
      case "hex": {
        // Create a bounding box around datum
        const d = cellSize * 5 / 111000; // approx degrees
        params.bounds = {
          type: "Polygon",
          coordinates: [[
            [datum![1] - d, datum![0] - d],
            [datum![1] + d, datum![0] - d],
            [datum![1] + d, datum![0] + d],
            [datum![1] - d, datum![0] + d],
            [datum![1] - d, datum![0] - d],
          ]],
        };
        params.cellSizeM = cellSize;
        break;
      }
      case "expanding_square":
        params.datum = datum!;
        params.legM = legSize;
        params.maxLegs = maxLegs;
        break;
      case "point":
        params.datum = datum!;
        params.radiusM = radius;
        break;
      case "k9_scent":
        params.type = "k9_scent";
        params.datum = datum!;
        params.windDirection = windDirection;
        params.windSpeed = windSpeed;
        params.scentRangeM = scentRangeM;
        break;
      case "drone_lawnmower":
        params.type = "drone_lawnmower";
        params.datum = datum!;
        params.cellSizeM = cellSize;
        params.droneCount = droneCount;
        params.droneAltM = droneAltM;
        params.droneOverlap = droneOverlap;
        params.radiusM = radius;
        break;
      case "river_corridor": {
        // We need the OSM waterway network + collection points for a bbox
        // around the LKP. Scale the fetch bbox by the maximum possible head
        // distance (v × t × 3600 × floater-coefficient) plus a 25% safety
        // margin so the downstream trace has room to breathe.
        const maxCoeff = riverFloater ? 0.7 : 0.3;
        const maxDistM = riverVelocity * riverHours * 3600 * maxCoeff * 1.25;
        // Convert metres to degrees (rough — fine at UK latitudes).
        const dLat = Math.max(0.01, maxDistM / 111000);
        const dLon = Math.max(0.01, maxDistM / (111000 * Math.cos((datum![0] * Math.PI) / 180)));
        // Overpass cap is 0.2 sq-deg; keep well under that.
        const dLatC = Math.min(dLat, 0.2);
        const dLonC = Math.min(dLon, 0.2);
        const s = datum![0] - dLatC;
        const n = datum![0] + dLatC;
        const w = datum![1] - dLonC;
        const e = datum![1] + dLonC;

        try {
          setRiverFetching(true);
          setRiverError(null);
          setRiverWarnings([]);
          const res = await searchHelpers.osmRivers([s, w, n, e]);
          params.datum = datum!;
          params.hours = riverHours;
          params.velocityMs = riverVelocity;
          params.floater = riverFloater;
          params.rivers = res.rivers.features as any;
          params.collectionPoints = res.collection_points.features as any;
        } catch (err: any) {
          setRiverError(err?.message || "Failed to fetch OSM waterways");
          setRiverFetching(false);
          return;
        } finally {
          setRiverFetching(false);
        }
        break;
      }
    }

    const zones = generateGrid(params);
    // Surface corridor-generator warnings/errors. Zones[0] is the parent corridor
    // polygon and carries the warnings on its corridor_metadata.
    if (gridType === "river_corridor") {
      if (zones.length === 0) {
        setRiverError("No corridor generated — LKP may be too far from any OSM waterway, or no downstream network is available.");
      } else {
        const parentProps = (zones[0].geometry?.properties as any) || {};
        const meta = parentProps.corridor_metadata;
        if (meta?.warnings) setRiverWarnings(meta.warnings);
        // Tier B3 — freeze the current gauge snapshot onto the parent corridor
        // metadata so the zone card shows what the operator was looking at at
        // plan time, not what the gauge reads later.
        if (meta?.kind === "parent" && gaugeLookup?.gauge.latest) {
          const g = gaugeLookup.gauge;
          meta.gauge_ref = {
            id: g.id,
            label: g.label,
            source: g.source,
            stage_m: g.latest!.stage_m,
            trend: g.trend,
            observed_at: g.latest!.time,
            distance_m: Math.round(gaugeLookup.distance_m),
          };
        }
      }
    }
    // Show zones immediately (uncoloured by terrain) so the operator isn't
    // waiting on Overpass before they see anything. Classification folds in
    // when it completes — a second setPreview pass.
    setPreview(zones);
    setPreviewZones(zones as any);

    if (zones.length === 0) return;

    // Only classify gridded/area patterns — a scent cone or route corridor
    // already targets a known context and cell-level terrain labels are noise.
    const eligible = gridType === "parallel" || gridType === "hex"
      || gridType === "point" || gridType === "drone_lawnmower"
      || gridType === "expanding_square";
    if (!eligible) return;

    try {
      setClassifying(true);
      // Compute the union bbox of all generated cells as a single FC — one
      // Overpass fetch covers every cell in the preview.
      const allFc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: zones.map((z) => z.geometry as GeoJSON.Feature),
      };
      const [w, s, e, n] = bboxFn(allFc as any);
      // Guard: Overpass caps at 0.2 sq-deg. If the grid is enormous we skip
      // classification rather than lying.
      if (!Number.isFinite(s) || !Number.isFinite(w) || (n - s) * (e - w) > 0.19) {
        setClassifying(false);
        return;
      }

      // Round to 3 dp for cache keying — sub-grid tweaks share a cache entry.
      const key = [s, w, n, e].map((v) => v.toFixed(3)).join(",");
      let processed = terrainCacheRef.current.get(key);
      if (!processed) {
        const raw = await searchHelpers.osmTerrain([s, w, n, e]);
        processed = processTerrain({
          water: raw.water,
          coastline: raw.coastline,
          rivers: raw.rivers,
          intertidal: raw.intertidal,
          partial: raw.partial,
        });
        terrainCacheRef.current.set(key, processed);
      }

      const classed = classifyCells(zones.map((z) => z.geometry as GeoJSON.Feature), processed);
      const merged = zones.map((z, i) => ({
        ...z,
        terrain_class: classed[i].dominant_class,
        terrain_composition: classed[i],
      }));
      setPreview(merged);
      setPreviewZones(merged as any);

      // Tier B2: if any cell is intertidal, fetch the tide forecast for the
      // bbox centre and attach the resulting window set to every intertidal
      // cell. One fetch per generation — tide state doesn't vary across a
      // ~0.2 sq-deg AOI in a meaningful way.
      const hasIntertidal = classed.some((c) => c.dominant_class === "intertidal");
      if (hasIntertidal) {
        const centreLat = (s + n) / 2;
        const centreLon = (w + e) / 2;
        const forecast = await fetchTide(centreLat, centreLon);
        const windows = forecast
          ? computeSearchableWindows(forecast, DEFAULT_THRESHOLD_M)
          : [];
        const sw = buildSearchableWindows(forecast, windows, DEFAULT_THRESHOLD_M);
        const withTide = merged.map((z, i) =>
          classed[i].dominant_class === "intertidal"
            ? { ...z, searchable_windows: sw }
            : z,
        );
        setPreview(withTide);
        setPreviewZones(withTide as any);
      }
    } catch (err) {
      // Classification failure is non-fatal — the user still gets the grid,
      // just without terrain tints. Log for debugging; don't block.
      console.warn("[smart-grid] terrain classification failed:", err);
    } finally {
      setClassifying(false);
    }
  };

  const handleCreate = async () => {
    if (preview.length === 0) return;
    setCreating(true);
    try {
      await search.createZonesBatch(operation.id, preview);
      setPreviewZones([]);
      if (onRefresh) await onRefresh();
      toggleGridGenerator();
    } finally {
      setCreating(false);
    }
  };

  // Clear preview zones when panel unmounts so stale previews don't linger
  useEffect(() => {
    return () => setPreviewZones([]);
  }, [setPreviewZones]);

  // Re-preview when the anchor datum changes so the polygons on the map
  // follow the dropdown — avoids the "changed anchor, now blank" trap.
  useEffect(() => {
    if (preview.length > 0 && datum) { handleGenerate().catch(() => {}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridDatumId]);

  return (
    <div className="fixed bottom-4 left-4 right-4 md:right-auto z-[1000] md:w-[380px] max-h-[85vh] overflow-y-auto bg-surface-800 border border-surface-600 rounded-xl shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Grid3X3 size={16} className="text-accent" />
          Grid Generator
        </h3>
        <button onClick={toggleGridGenerator} className="text-fg-4 hover:text-fg-1">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Datum selector — choose which datum this pattern is anchored to */}
        {((operation.datums || []).length > 0 || datum) && (
          <div>
            <label className="block text-xs text-fg-4 mb-1">Anchor datum</label>
            <select
              value={gridDatumId ?? "__primary__"}
              onChange={(e) => {
                const v = e.target.value;
                setGridDatumId(v === "__primary__" ? null : v);
                // Preview auto-regenerates on anchor change (effect below) so
                // the user doesn't lose their parameter tuning to a dropdown tap.
              }}
              className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
            >
              {operation.datum_lat && operation.datum_lon && (
                <option value="__primary__">Primary datum</option>
              )}
              {(operation.datums || []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.kind.toUpperCase()} — {d.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-fg-4 mt-1">Using: {datumLabel}</p>
          </div>
        )}

        {/* Grid type selector */}
        <div className="grid grid-cols-2 gap-2">
          {GRID_TYPES.map((gt) => (
            <button
              key={gt.id}
              onClick={() => { setGridType(gt.id); setPreview([]); }}
              className={`p-2 rounded text-xs text-left transition ${
                gridType === gt.id
                  ? "bg-accent/10 border border-accent/30 text-accent"
                  : "bg-surface-700 border border-surface-600 text-fg-3 hover:text-fg-1"
              }`}
            >
              <gt.icon size={14} className="mb-1" />
              <div className="font-medium">{gt.label}</div>
            </button>
          ))}
        </div>

        {/* Parameters */}
        {(gridType === "parallel" || gridType === "hex") && (
          <div>
            <label className="block text-xs text-fg-4 mb-1">Cell size (metres)</label>
            <input
              type="number"
              value={cellSize}
              onChange={(e) => setCellSize(parseInt(e.target.value) || 500)}
              className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
            />
          </div>
        )}

        {gridType === "expanding_square" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-fg-4 mb-1">Leg size (m)</label>
              <input
                type="number"
                value={legSize}
                onChange={(e) => setLegSize(parseInt(e.target.value) || 200)}
                className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-4 mb-1">Max legs</label>
              <input
                type="number"
                value={maxLegs}
                onChange={(e) => setMaxLegs(parseInt(e.target.value) || 12)}
                className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
              />
            </div>
          </div>
        )}

        {gridType === "point" && (
          <div>
            <label className="block text-xs text-fg-4 mb-1">Radius (metres)</label>
            <input
              type="number"
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value) || 500)}
              className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
            />
          </div>
        )}

        {gridType === "k9_scent" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-fg-4 mb-1">Wind direction (°)</label>
                <input type="number" value={windDirection} onChange={(e) => setWindDirection(parseInt(e.target.value) || 0)} className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs text-fg-4 mb-1">Wind speed (mph)</label>
                <input type="number" value={windSpeed} onChange={(e) => setWindSpeed(parseInt(e.target.value) || 5)} className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-fg-4 mb-1">Scent range (metres)</label>
              <input type="number" value={scentRangeM} onChange={(e) => setScentRangeM(parseInt(e.target.value) || 400)} className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm" />
            </div>
            <p className="text-[10px] text-fg-4">Generates a scent cone downwind from the datum point. Wind direction = where wind comes FROM. Dog handler starts upwind and works into the cone.</p>
          </div>
        )}

        {gridType === "river_corridor" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-fg-4 mb-1">Time since entry (h)</label>
                <input
                  type="number"
                  step="0.25"
                  min={0}
                  value={riverHours}
                  onChange={(e) => setRiverHours(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-fg-4 mb-1">Surface velocity (m/s)</label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={riverVelocity}
                  onChange={(e) => setRiverVelocity(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-fg-4 mb-1">Velocity preset</label>
              <select
                onChange={(e) => {
                  const found = RIVER_VELOCITY_PRESETS.find((p) => p.id === e.target.value);
                  if (found) setRiverVelocity(found.v);
                }}
                value={RIVER_VELOCITY_PRESETS.find((p) => p.v === riverVelocity)?.id ?? ""}
                className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
              >
                <option value="">Custom ({riverVelocity.toFixed(2)} m/s)</option>
                {RIVER_VELOCITY_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            {/* Tier B3 — nearest river gauge. Operator clicks to fetch; the
              result informs but does not mutate the velocity preset. */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleLookupGauge}
                  disabled={!datum || gaugeFetching}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-700 hover:bg-surface-600 disabled:opacity-50 disabled:cursor-not-allowed border border-surface-600 rounded text-xs text-fg-2"
                >
                  {gaugeFetching ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
                  {gaugeLookup ? "Refresh nearest gauge" : "Use nearest gauge"}
                </button>
                {gaugePartial && (
                  <span className="text-[10px] text-amber-300" title="One of SEPA/EA failed — results may be incomplete">partial</span>
                )}
              </div>
              {gaugeError && (
                <div className="flex items-start gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{gaugeError}</span>
                </div>
              )}
              {gaugeLookup && (() => {
                const suggest = gaugeSuggestPreset(gaugeLookup.gauge);
                const trendColor = GAUGE_TREND_FILL[gaugeLookup.gauge.trend];
                const spark = gaugeSparkline(gaugeLookup.gauge, 60, 16);
                return (
                  <div className="px-3 py-2 bg-surface-700/50 rounded space-y-1">
                    <div className="flex items-center gap-2 text-[11px] text-fg-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: trendColor }}
                        aria-hidden
                      />
                      <span className="truncate flex-1">{gaugeStateLabel(gaugeLookup)}</span>
                      {spark && (
                        <svg
                          width={60}
                          height={16}
                          viewBox="0 0 60 16"
                          className="shrink-0"
                          aria-label={`Last ${spark.sample_count} readings: ${spark.min_m.toFixed(2)}–${spark.max_m.toFixed(2)} m`}
                        >
                          <polyline
                            points={spark.points}
                            fill="none"
                            stroke={trendColor}
                            strokeWidth={1.25}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        </svg>
                      )}
                    </div>
                    <div className="text-[10px] text-fg-4">{suggest.rationale}</div>
                    {suggest.preset_id && (() => {
                      const preset = RIVER_VELOCITY_PRESETS.find((p) => p.id === suggest.preset_id);
                      if (!preset) return null;
                      const alreadyApplied = Math.abs(riverVelocity - preset.v) < 0.01;
                      return alreadyApplied ? (
                        <div className="text-[10px] text-fg-4">Preset already at {preset.label}.</div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRiverVelocity(preset.v)}
                          className="text-[10px] text-accent hover:underline"
                        >
                          Apply suggestion: {preset.label}
                        </button>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-700/50 rounded">
              <label className="flex items-center gap-2 text-xs text-fg-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={riverFloater}
                  onChange={(e) => setRiverFloater(e.target.checked)}
                  className="accent-accent"
                />
                Live floater (× 0.7 drift)
              </label>
              {!riverFloater && (
                <span className="text-[10px] text-fg-4 ml-auto">body × 0.3 (Carlson)</span>
              )}
            </div>
            <p className="text-[10px] text-fg-4">
              Snaps LKP to the nearest OSM waterway and walks downstream. Corridor
              head advances at v × t × drift-coefficient; width grows with √t up
              to 100 m. Weirs/dams/bridges inside the corridor become priority-1
              sub-zones.
            </p>
            {riverFetching && (
              <div className="flex items-center gap-2 text-xs text-fg-3">
                <Loader2 size={12} className="animate-spin" />
                Fetching OSM waterways…
              </div>
            )}
            {riverError && (
              <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{riverError}</span>
              </div>
            )}
            {riverWarnings.length > 0 && (
              <div className="space-y-1">
                {riverWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] text-amber-300">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
            {preview.length > 0 && gridType === "river_corridor" && (() => {
              const meta = (preview[0].geometry?.properties as any)?.corridor_metadata;
              if (!meta || meta.kind !== "parent") return null;
              const km = (meta.head_distance_m / 1000).toFixed(2);
              const colMeta = preview.slice(1).length;
              return (
                <div className="px-3 py-2 bg-surface-700/50 rounded text-[11px] text-fg-3 space-y-0.5">
                  <div>
                    <span className="text-fg-1 font-medium">{meta.river_name || "Unnamed waterway"}</span>
                    {" · "}{km} km downstream
                  </div>
                  <div>
                    Body drift: {meta.body_velocity_ms} m/s · head width {meta.head_corridor_width_m} m
                  </div>
                  <div className="text-fg-4">
                    {colMeta} collection point{colMeta === 1 ? "" : "s"} in corridor
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {gridType === "drone_lawnmower" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-fg-4 mb-1">Drones</label>
                <select value={droneCount} onChange={(e) => setDroneCount(parseInt(e.target.value))} className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm">
                  <option value={1}>1 drone</option>
                  <option value={2}>2 drones</option>
                  <option value={3}>3 drones</option>
                  <option value={4}>4 drones</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-fg-4 mb-1">Altitude (m AGL)</label>
                <input type="number" value={droneAltM} onChange={(e) => setDroneAltM(parseInt(e.target.value) || 50)} className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-fg-4 mb-1">Search radius (m)</label>
                <input type="number" value={radius} onChange={(e) => setRadius(parseInt(e.target.value) || 500)} className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs text-fg-4 mb-1">Overlap %</label>
                <input type="number" value={droneOverlap} onChange={(e) => setDroneOverlap(parseInt(e.target.value) || 20)} min={0} max={50} className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm" />
              </div>
            </div>
            <p className="text-[10px] text-fg-4">Generates lawnmower flight strips. Multi-drone splits the area into parallel sectors. Exports as GPX/KML waypoints.</p>
          </div>
        )}

        {!datum && gridType !== "route_buffer" && (
          <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300 space-y-2">
            <p>A search grid needs an anchor. Drop a primary datum (LKP) first.</p>
            <button
              onClick={() => {
                setSettingDatum(true);
                toggleGridGenerator();
              }}
              className="w-full py-2 bg-red-500 text-white rounded text-xs font-semibold hover:bg-red-400 transition"
            >
              Drop LKP on map
            </button>
          </div>
        )}

        {/* Preview info */}
        {preview.length > 0 && (
          <div className="p-2 bg-surface-700/50 rounded text-xs text-fg-3 space-y-1">
            <div>
              Generated <strong className="text-fg-1">{preview.length}</strong> zones
              {classifying && (
                <span className="ml-2 inline-flex items-center gap-1 text-fg-4">
                  <Loader2 size={10} className="animate-spin" />
                  classifying terrain…
                </span>
              )}
            </div>
            {/* Break down by terrain class once classification has landed so the
                operator can eyeball "40% of this grid is water" before creating. */}
            {!classifying && preview.some((p: any) => p.terrain_class) && (
              <TerrainBreakdown preview={preview} />
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={(!datum && gridType !== "route_buffer") || classifying || riverFetching}
            className="flex-1 px-3 py-2 bg-surface-700 hover:bg-surface-600 text-sm rounded transition disabled:opacity-50"
          >
            {riverFetching ? "Fetching…" : "Preview"}
          </button>
          <button
            onClick={handleCreate}
            disabled={preview.length === 0 || creating}
            className="flex-1 px-3 py-2 bg-accent text-black text-sm rounded disabled:opacity-50 transition"
          >
            {creating ? "Creating..." : `Create ${preview.length} Zones`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Small breakdown chip: tallies the dominant_class of each previewed cell so
// the operator can sanity-check "did I just put half this grid in the river?"
// before hitting Create.
function TerrainBreakdown({ preview }: { preview: any[] }) {
  const counts: Record<string, number> = { land: 0, water: 0, intertidal: 0, mixed: 0 };
  for (const p of preview) {
    const k = p?.terrain_class;
    if (k && counts[k] !== undefined) counts[k] += 1;
  }
  const items: Array<{ label: string; count: number; color: string }> = [
    { label: "land", count: counts.land, color: "#6b7280" },
    { label: "water", count: counts.water, color: "#3b82f6" },
    { label: "intertidal", count: counts.intertidal, color: "#f59e0b" },
    { label: "mixed", count: counts.mixed, color: "#a855f7" },
  ].filter((x) => x.count > 0);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-surface-800/60 border border-surface-600"
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: it.color }} />
          {it.count} {it.label}
        </span>
      ))}
    </div>
  );
}
