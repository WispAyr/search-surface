"use client";

import { useEffect, useState } from "react";
import { search } from "@/lib/api";
import { generateGrid } from "@/lib/gridGenerator";
import { useSearchStore } from "@/stores/search";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { SearchOperation, GridGenerationParams } from "@/types/search";
import { X, Grid3X3, Hexagon, RotateCw, Route, Target, Dog, Plane } from "lucide-react";

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
  const [preview, setPreview] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

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

  const handleGenerate = () => {
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
    }

    const zones = generateGrid(params);
    setPreview(zones);
    setPreviewZones(zones as any);
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
    if (preview.length > 0 && datum) handleGenerate();
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
          <div className="p-2 bg-surface-700/50 rounded text-xs text-fg-3">
            Generated <strong className="text-fg-1">{preview.length}</strong> zones
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={!datum && gridType !== "route_buffer"}
            className="flex-1 px-3 py-2 bg-surface-700 hover:bg-surface-600 text-sm rounded transition disabled:opacity-50"
          >
            Preview
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
