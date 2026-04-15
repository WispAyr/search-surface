"use client";

import { useEffect, useState } from "react";
import { useSearchStore } from "@/stores/search";
import { searchHelpers } from "@/lib/api";
import type { SearchOperation } from "@/types/search";

type Profile = { label: string; rings_km: number[]; water_risk: number; notes: string };

interface Props {
  operation: SearchOperation;
}

export function SarToolsPanel({ operation }: Props) {
  const {
    subjectProfileId, setSubjectProfile,
    showLpbRings, setShowLpbRings,
    travelModes, setTravelMode,
    travelMinutes, setTravelMinutes,
    showHazards, setShowHazards,
    showAttractors, setShowAttractors,
    hazards, attractors, setOsmFeatures,
    vehicleRoute, vehicleRouteMeta, setVehicleRoute,
    selectedZoneId,
  } = useSearchStore();

  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [streets, setStreets] = useState<Array<{ name: string; count: number }>>([]);
  const [loadingStreets, setLoadingStreets] = useState(false);
  const [streetError, setStreetError] = useState<string | null>(null);
  const [w3w, setW3w] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const datumLat = operation.datum_lat;
  const datumLon = operation.datum_lon;

  // Load profiles once
  useEffect(() => {
    setLoadingProfiles(true);
    searchHelpers.profiles()
      .then((d) => setProfiles(d.profiles))
      .catch(() => {})
      .finally(() => setLoadingProfiles(false));
  }, []);

  // Fetch w3w when datum changes
  useEffect(() => {
    if (!datumLat || !datumLon) return;
    searchHelpers.w3wFromCoords(datumLat, datumLon)
      .then((d) => setW3w(d.words))
      .catch(() => setW3w(null));
  }, [datumLat, datumLon]);

  const profile = subjectProfileId ? profiles[subjectProfileId] : null;
  const selectedZone = operation.zones?.find((z) => z.id === selectedZoneId);

  async function loadHazards() {
    if (!datumLat || !datumLon) return;
    setBusy("hazards");
    const r = 0.05; // ~5km box
    const bbox: [number, number, number, number] = [datumLat - r, datumLon - r * 1.6, datumLat + r, datumLon + r * 1.6];
    try {
      const d = await searchHelpers.osmFeatures(bbox);
      setOsmFeatures(d.hazards, d.attractors);
      setShowHazards(true);
      setShowAttractors(true);
    } catch (e) {
      alert(`Hazard fetch failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function loadStreets() {
    const zone = selectedZone;
    if (!zone?.geometry) return;
    const coords = extractPolygon(zone.geometry);
    if (!coords) return;
    setLoadingStreets(true);
    setStreetError(null);
    try {
      const d = await searchHelpers.osmStreets(coords);
      setStreets(d.streets);
    } catch (e) {
      setStreetError((e as Error).message);
    } finally {
      setLoadingStreets(false);
    }
  }

  async function buildVehicleRoute() {
    const zone = selectedZone;
    if (!zone?.geometry) return;
    const coords = extractPolygon(zone.geometry);
    if (!coords || coords.length < 3) return;
    const sampled = coords.filter((_, i) => i % Math.max(1, Math.floor(coords.length / 20)) === 0).slice(0, 20);
    setBusy("route");
    try {
      const d = await searchHelpers.vehicleRoute(sampled);
      setVehicleRoute(d.geometry, { distance_m: d.distance_m, duration_s: d.duration_s });
    } catch (e) {
      alert(`Route failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  function downloadStreetList() {
    const lines = ["Street,Segments,"];
    for (const s of streets) lines.push(`"${s.name.replace(/"/g, '""')}",${s.count},[ ]`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `streets-${selectedZone?.name || "zone"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-3 space-y-4 text-xs text-fg-2">
      {/* ── Subject profile ── */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wide text-fg-4 mb-2">Subject profile</h3>
        <select
          className="w-full bg-bg-2 border border-fg-5 rounded px-2 py-1.5 text-fg-1"
          value={subjectProfileId || ""}
          onChange={(e) => {
            const v = e.target.value || null;
            setSubjectProfile(v);
            setShowLpbRings(!!v);
          }}
          disabled={loadingProfiles}
        >
          <option value="">— Select profile —</option>
          {Object.entries(profiles).map(([id, p]) => (
            <option key={id} value={id}>{p.label}</option>
          ))}
        </select>
        {profile && (
          <div className="mt-2 p-2 bg-bg-2 rounded border border-fg-5/50">
            <div className="flex justify-between mb-1">
              <span className="text-fg-4">Rings (25/50/75/95%)</span>
              <span className="font-mono">{profile.rings_km.map((r) => `${r}km`).join(" · ")}</span>
            </div>
            {profile.water_risk > 0.15 && (
              <div className="text-amber-400">⚠ Water-feature risk: {Math.round(profile.water_risk * 100)}%</div>
            )}
            <div className="mt-1 text-fg-3">{profile.notes}</div>
            <label className="flex items-center gap-2 mt-2">
              <input type="checkbox" checked={showLpbRings} onChange={(e) => setShowLpbRings(e.target.checked)} />
              <span>Show rings on map</span>
            </label>
          </div>
        )}
      </section>

      {/* ── Travel-mode isochrones ── */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wide text-fg-4 mb-2">Travel range (simple radii)</h3>
        <div className="flex gap-2 text-[11px]">
          {(["foot", "bike", "car"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="checkbox" checked={travelModes[m]} onChange={(e) => setTravelMode(m, e.target.checked)} />
              <span className="capitalize">{m}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-fg-4">Minutes since LKP:</span>
          <input
            type="number"
            min={5} max={1440} step={5}
            value={travelMinutes}
            onChange={(e) => setTravelMinutes(parseInt(e.target.value) || 60)}
            className="w-20 bg-bg-2 border border-fg-5 rounded px-2 py-1 text-fg-1 font-mono"
          />
        </div>
        <div className="text-[10px] text-fg-4 mt-1">
          Foot ≈ 5 km/h, bike ≈ 20 km/h, car ≈ 60 km/h. Straight-line max distance; not terrain-aware.
        </div>
      </section>

      {/* ── what3words ── */}
      {datumLat && datumLon && (
        <section>
          <h3 className="text-[10px] uppercase tracking-wide text-fg-4 mb-2">what3words (primary datum)</h3>
          <div className="font-mono text-accent">{w3w ? `///${w3w}` : "—"}</div>
          {w3w && (
            <a
              href={`https://what3words.com/${w3w}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-fg-4 underline"
            >Open in what3words</a>
          )}
        </section>
      )}

      {/* ── OSM hazards / attractors ── */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wide text-fg-4 mb-2">OSM hazards & attractors</h3>
        <button
          onClick={loadHazards}
          disabled={busy === "hazards" || !datumLat}
          className="w-full px-2 py-1.5 bg-bg-2 border border-fg-5 rounded hover:bg-bg-3 disabled:opacity-40"
        >
          {busy === "hazards" ? "Loading…" : "Scan 5 km around datum"}
        </button>
        {hazards.length > 0 && (
          <div className="mt-2 space-y-1">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showHazards} onChange={(e) => setShowHazards(e.target.checked)} />
              <span className="text-rose-400">Hazards ({hazards.length})</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showAttractors} onChange={(e) => setShowAttractors(e.target.checked)} />
              <span className="text-emerald-400">Attractors ({attractors.length})</span>
            </label>
          </div>
        )}
      </section>

      {/* ── Street list ── */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wide text-fg-4 mb-2">Street list (selected zone)</h3>
        {!selectedZone ? (
          <div className="text-fg-4">Select a zone on the map first.</div>
        ) : (
          <>
            <button
              onClick={loadStreets}
              disabled={loadingStreets}
              className="w-full px-2 py-1.5 bg-bg-2 border border-fg-5 rounded hover:bg-bg-3 disabled:opacity-40"
            >
              {loadingStreets ? "Querying OSM…" : `List streets in "${selectedZone.name}"`}
            </button>
            {streetError && <div className="mt-1 text-rose-400">{streetError}</div>}
            {streets.length > 0 && (
              <>
                <div className="mt-2 max-h-40 overflow-y-auto border border-fg-5/30 rounded p-2 font-mono text-[10px]">
                  {streets.map((s) => (
                    <div key={s.name}>☐ {s.name}</div>
                  ))}
                </div>
                <button
                  onClick={downloadStreetList}
                  className="mt-2 w-full px-2 py-1.5 bg-accent/20 border border-accent/40 rounded text-accent hover:bg-accent/30"
                >
                  Download CSV checklist ({streets.length})
                </button>
              </>
            )}
          </>
        )}
      </section>

      {/* ── Vehicle route ── */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wide text-fg-4 mb-2">Vehicle search route</h3>
        {!selectedZone ? (
          <div className="text-fg-4">Select a zone to generate a driving route through it.</div>
        ) : (
          <>
            <button
              onClick={buildVehicleRoute}
              disabled={busy === "route"}
              className="w-full px-2 py-1.5 bg-bg-2 border border-fg-5 rounded hover:bg-bg-3 disabled:opacity-40"
            >
              {busy === "route" ? "Routing…" : "Generate driving route"}
            </button>
            {vehicleRoute && vehicleRouteMeta && (
              <div className="mt-2 p-2 bg-bg-2 rounded text-[11px]">
                <div>Distance: <span className="font-mono">{(vehicleRouteMeta.distance_m / 1000).toFixed(1)} km</span></div>
                <div>Duration: <span className="font-mono">{Math.round(vehicleRouteMeta.duration_s / 60)} min</span></div>
                <button
                  onClick={() => setVehicleRoute(null, null)}
                  className="mt-1 text-fg-4 underline text-[10px]"
                >Clear route</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// Extract outer ring from (MultiPolygon | Polygon | Feature) geometry as [[lat,lon], ...]
function extractPolygon(geom: unknown): Array<[number, number]> | null {
  const g = (geom as { geometry?: unknown })?.geometry ? (geom as { geometry: unknown }).geometry : geom;
  const gg = g as { type: string; coordinates: number[][][] | number[][][][] };
  if (!gg?.type) return null;
  let ring: number[][] | null = null;
  if (gg.type === "Polygon") ring = (gg.coordinates as number[][][])[0];
  else if (gg.type === "MultiPolygon") ring = (gg.coordinates as number[][][][])[0][0];
  if (!ring) return null;
  return ring.map(([lon, lat]) => [lat, lon] as [number, number]);
}
