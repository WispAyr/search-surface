"use client";

import { useEffect, useState } from "react";
import {
  MapPin,
  UserRound,
  Gauge,
  Hash,
  AlertTriangle,
  ListChecks,
  Car,
  ChevronDown,
} from "lucide-react";
import { useSearchStore } from "@/stores/search";
import { searchHelpers } from "@/lib/api";
import type { SearchOperation } from "@/types/search";

type Profile = { label: string; rings_km: number[]; water_risk: number; notes: string };

/* ── Collapsible section ─────────────────────────────────────────────── */

type SectionId =
  | "anchor"
  | "profile"
  | "travel"
  | "w3w"
  | "osm"
  | "streets"
  | "route";

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  anchor: true,
  profile: true,
  travel: false,
  w3w: false,
  osm: true,
  streets: false,
  route: false,
};

function readOpenState(): Record<SectionId, boolean> {
  if (typeof window === "undefined") return DEFAULT_OPEN;
  try {
    const raw = localStorage.getItem("sar:sections");
    if (!raw) return DEFAULT_OPEN;
    const parsed = JSON.parse(raw) as Partial<Record<SectionId, boolean>>;
    return { ...DEFAULT_OPEN, ...parsed };
  } catch {
    return DEFAULT_OPEN;
  }
}

function Section({
  id,
  title,
  icon,
  badge,
  summary,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  summary?: React.ReactNode;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-surface-700 bg-surface-800/60 overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-700/50 transition"
        aria-expanded={open}
      >
        <span className="text-accent shrink-0">{icon}</span>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-fg-2">
          {title}
        </span>
        {badge && <span className="shrink-0">{badge}</span>}
        <ChevronDown
          size={14}
          className={`shrink-0 text-fg-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {!open && summary && (
        <div className="px-3 pb-2.5 -mt-1 text-[11px] text-fg-4">{summary}</div>
      )}
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-surface-700/70">{children}</div>
      )}
    </section>
  );
}

function CountBadge({ n, tone }: { n: number; tone: "rose" | "emerald" | "sky" | "amber" | "info" }) {
  const map = {
    rose: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    sky: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    info: "bg-accent/15 text-accent border-accent/30",
  }[tone];
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded border ${map}`}>
      {n}
    </span>
  );
}

// 3dp (~100m) keeps a jittered LKP in the same cache; a real move invalidates.
const HAZARD_CACHE_TTL_MS = 6 * 3600_000;
function hazardCacheKey(opId: string, lat: number, lon: number) {
  return `sar:hz:${opId}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
}

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
    showCoastline, setShowCoastline,
    showLse, setShowLse,
    hazards, attractors, coastlines, lse, setOsmFeatures,
    vehicleRoute, vehicleRouteMeta, setVehicleRoute,
    selectedZoneId,
    gridDatumId, setGridDatumId,
  } = useSearchStore();

  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [streets, setStreets] = useState<Array<{ name: string; count: number }>>([]);
  const [loadingStreets, setLoadingStreets] = useState(false);
  const [streetError, setStreetError] = useState<string | null>(null);
  const [streetsQueried, setStreetsQueried] = useState(false);
  const [w3w, setW3w] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Anchor datum: the one the rings, hazard scan and w3w all resolve against.
  // Shared with the Datums panel via gridDatumId — null means the operation's primary datum.
  const selectedDatum = gridDatumId
    ? (operation.datums || []).find((d) => d.id === gridDatumId) || null
    : null;
  const datumLat = selectedDatum ? selectedDatum.lat : operation.datum_lat;
  const datumLon = selectedDatum ? selectedDatum.lon : operation.datum_lon;
  const anchorLabel = selectedDatum
    ? selectedDatum.label
    : (operation.datum_lat && operation.datum_lon ? "Primary datum" : "— none set —");

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

  // Rehydrate hazards on reload so the IC doesn't re-click mid-incident.
  useEffect(() => {
    if (!datumLat || !datumLon) return;
    const key = hazardCacheKey(operation.id, datumLat, datumLon);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || Date.now() - (parsed.savedAt || 0) > HAZARD_CACHE_TTL_MS) return;
      setOsmFeatures({
        hazards: parsed.hazards || [],
        attractors: parsed.attractors || [],
        hazardLines: parsed.hazard_lines || [],
        coastlines: parsed.coastlines || [],
        lse: parsed.lse || [],
      });
      setShowHazards(true);
      setShowAttractors(true);
      // Auto-show coastline/LSE only if the cached payload actually had them —
      // avoids adding noise to inland incidents that rehydrate pre-coast data.
      if ((parsed.coastlines || []).length) setShowCoastline(true);
      if ((parsed.lse || []).length) setShowLse(true);
    } catch { /* ignore corrupt cache */ }
    // setShow* are stable store actions — deliberately excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation.id, datumLat, datumLon]);

  const profile = subjectProfileId ? profiles[subjectProfileId] : null;
  const selectedZone = operation.zones?.find((z) => z.id === selectedZoneId);

  async function loadHazards() {
    if (!datumLat || !datumLon) return;
    setBusy("hazards");
    const r = 0.05; // ~5km box
    const bbox: [number, number, number, number] = [datumLat - r, datumLon - r * 1.6, datumLat + r, datumLon + r * 1.6];
    try {
      const d = await searchHelpers.osmFeatures(bbox);
      setOsmFeatures({
        hazards: d.hazards,
        attractors: d.attractors,
        hazardLines: d.hazard_lines,
        coastlines: d.coastlines,
        lse: d.lse,
      });
      setShowHazards(true);
      setShowAttractors(true);
      if (d.coastlines.length) setShowCoastline(true);
      if (d.lse.length) setShowLse(true);
      try {
        const key = hazardCacheKey(operation.id, datumLat, datumLon);
        localStorage.setItem(key, JSON.stringify({
          hazards: d.hazards, hazard_lines: d.hazard_lines, attractors: d.attractors,
          coastlines: d.coastlines, lse: d.lse,
          savedAt: Date.now(),
        }));
      } catch { /* quota exceeded — non-fatal */ }
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
    setStreetsQueried(false);
    try {
      const d = await searchHelpers.osmStreets(coords);
      setStreets(d.streets);
      setStreetsQueried(true);
    } catch (e) {
      const msg = (e as Error).message || "";
      const isTimeout = /504|timeout|gateway/i.test(msg);
      setStreetError(
        isTimeout
          ? "OSM query took too long. Dense urban zones can time out — try a smaller zone or retry in a moment."
          : msg
      );
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
      const msg = (e as Error).message || "";
      const isTimeout = /504|timeout|gateway/i.test(msg);
      alert(
        isTimeout
          ? "Route took too long. OSRM couldn't solve this zone in time — try a smaller zone or retry."
          : `Route failed: ${msg}`
      );
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

  const primaryAvailable = operation.datum_lat != null && operation.datum_lon != null;
  const datums = operation.datums || [];

  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>(DEFAULT_OPEN);
  // Hydrate from localStorage on mount (SSR-safe).
  useEffect(() => {
    setOpenSections(readOpenState());
  }, []);
  const toggleSection = (id: SectionId) => {
    setOpenSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem("sar:sections", JSON.stringify(next));
      } catch { /* quota — non-fatal */ }
      return next;
    });
  };
  const expandAll = () => {
    const all = Object.fromEntries(Object.keys(DEFAULT_OPEN).map((k) => [k, true])) as Record<SectionId, boolean>;
    setOpenSections(all);
    try { localStorage.setItem("sar:sections", JSON.stringify(all)); } catch {}
  };
  const collapseAll = () => {
    const none = Object.fromEntries(Object.keys(DEFAULT_OPEN).map((k) => [k, false])) as Record<SectionId, boolean>;
    setOpenSections(none);
    try { localStorage.setItem("sar:sections", JSON.stringify(none)); } catch {}
  };

  const hasScan = hazards.length > 0 || attractors.length > 0 || coastlines.length > 0 || lse.length > 0;

  return (
    <div className="p-3 space-y-2 text-xs text-fg-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between pb-1">
        <h2 className="text-[10px] uppercase tracking-wider text-fg-4 font-semibold">
          SAR tools
        </h2>
        <div className="flex items-center gap-1.5 text-[10px] text-fg-4">
          <button
            onClick={expandAll}
            className="px-1.5 py-0.5 rounded hover:text-fg-1 hover:bg-surface-700/60"
            title="Expand all sections"
          >
            Expand
          </button>
          <span className="text-fg-5">·</span>
          <button
            onClick={collapseAll}
            className="px-1.5 py-0.5 rounded hover:text-fg-1 hover:bg-surface-700/60"
            title="Collapse all sections"
          >
            Collapse
          </button>
        </div>
      </div>

      {/* ── Anchor datum ── */}
      <Section
        id="anchor"
        title="Anchor datum"
        icon={<MapPin size={14} />}
        open={openSections.anchor}
        onToggle={toggleSection}
        summary={
          datumLat != null && datumLon != null
            ? `${anchorLabel} · ${datumLat.toFixed(5)}, ${datumLon.toFixed(5)}`
            : "No datum set"
        }
      >
        <p className="text-[10px] text-fg-4 mb-2">
          Rings, hazards and w3w resolve to this point.
        </p>
        <select
          className="w-full bg-surface-900 border border-surface-600 rounded px-2 py-1.5 text-fg-1"
          value={gridDatumId ?? ""}
          onChange={(e) => setGridDatumId(e.target.value || null)}
          disabled={!primaryAvailable && datums.length === 0}
        >
          {primaryAvailable && <option value="">Primary datum</option>}
          {datums.map((d) => (
            <option key={d.id} value={d.id}>
              {d.kind.toUpperCase()} — {d.label}
            </option>
          ))}
          {!primaryAvailable && datums.length === 0 && (
            <option value="">— no datums — set one on the Datums tab</option>
          )}
        </select>
        {(datumLat != null && datumLon != null) && (
          <div className="mt-1.5 text-[10px] text-fg-4 font-mono">
            {anchorLabel} · {datumLat.toFixed(5)}, {datumLon.toFixed(5)}
          </div>
        )}
      </Section>

      {/* ── Subject profile ── */}
      <Section
        id="profile"
        title="Subject profile"
        icon={<UserRound size={14} />}
        open={openSections.profile}
        onToggle={toggleSection}
        summary={profile ? `${profile.label} · rings ${showLpbRings ? "shown" : "hidden"}` : "No profile selected"}
        badge={profile ? <CountBadge n={profile.rings_km.length} tone="info" /> : undefined}
      >
        <select
          className="w-full bg-surface-900 border border-surface-600 rounded px-2 py-1.5 text-fg-1"
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
          <div className="mt-2 p-2 bg-surface-900 rounded border border-surface-600">
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
      </Section>

      {/* ── Travel range ── */}
      <Section
        id="travel"
        title="Travel range"
        icon={<Gauge size={14} />}
        open={openSections.travel}
        onToggle={toggleSection}
        summary={
          Object.values(travelModes).some(Boolean)
            ? `${Object.entries(travelModes).filter(([, v]) => v).map(([k]) => k).join(", ")} · ${travelMinutes} min`
            : "No modes selected"
        }
      >
        <div className="flex gap-3 text-[11px]">
          {(["foot", "bike", "car"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
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
            className="w-20 bg-surface-900 border border-surface-600 rounded px-2 py-1 text-fg-1 font-mono"
          />
        </div>
        <div className="text-[10px] text-fg-4 mt-1.5">
          Foot ≈ 5 km/h, bike ≈ 20 km/h, car ≈ 60 km/h. Straight-line max distance; not terrain-aware.
        </div>
      </Section>

      {/* ── what3words ── */}
      {datumLat && datumLon && (
        <Section
          id="w3w"
          title="what3words"
          icon={<Hash size={14} />}
          open={openSections.w3w}
          onToggle={toggleSection}
          summary={w3w ? `///${w3w}` : "Loading…"}
        >
          <div className="text-[10px] text-fg-4 mb-1">{anchorLabel}</div>
          <div className="font-mono text-accent text-sm">{w3w ? `///${w3w}` : "—"}</div>
          {w3w && (
            <a
              href={`https://what3words.com/${w3w}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-fg-4 underline inline-block mt-1"
            >Open in what3words</a>
          )}
        </Section>
      )}

      {/* ── OSM hazards / attractors / coastline / LSE ── */}
      <Section
        id="osm"
        title="Hazards, attractors & shoreline"
        icon={<AlertTriangle size={14} />}
        open={openSections.osm}
        onToggle={toggleSection}
        summary={
          hasScan
            ? `H${hazards.length} · A${attractors.length} · C${coastlines.length} · L${lse.length}`
            : "Not scanned"
        }
        badge={
          hasScan ? (
            <div className="flex items-center gap-1">
              {hazards.length > 0 && <CountBadge n={hazards.length} tone="rose" />}
              {lse.length > 0 && <CountBadge n={lse.length} tone="amber" />}
            </div>
          ) : undefined
        }
      >
        <button
          onClick={loadHazards}
          disabled={busy === "hazards" || !datumLat}
          className="w-full px-2 py-1.5 bg-surface-900 border border-surface-600 rounded hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === "hazards" ? "Loading…" : `Scan 5 km around ${anchorLabel}`}
        </button>
        {hasScan && (
          <div className="mt-2 space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showHazards} onChange={(e) => setShowHazards(e.target.checked)} />
              <span className="text-rose-400 flex-1">Hazards</span>
              <CountBadge n={hazards.length} tone="rose" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showAttractors} onChange={(e) => setShowAttractors(e.target.checked)} />
              <span className="text-emerald-400 flex-1">Attractors</span>
              <CountBadge n={attractors.length} tone="emerald" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showCoastline} onChange={(e) => setShowCoastline(e.target.checked)} />
              <span className="text-sky-400 flex-1">Coastline</span>
              <CountBadge n={coastlines.length} tone="sky" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showLse} onChange={(e) => setShowLse(e.target.checked)} />
              <span className="text-amber-400 flex-1">Life-saving kit</span>
              <CountBadge n={lse.length} tone="amber" />
            </label>
          </div>
        )}
      </Section>

      {/* ── Street list ── */}
      <Section
        id="streets"
        title="Street list"
        icon={<ListChecks size={14} />}
        open={openSections.streets}
        onToggle={toggleSection}
        summary={
          !selectedZone
            ? "Select a zone first"
            : streets.length
              ? `${streets.length} street${streets.length === 1 ? "" : "s"} in "${selectedZone.name}"`
              : `Zone: "${selectedZone.name}"`
        }
        badge={streets.length > 0 ? <CountBadge n={streets.length} tone="info" /> : undefined}
      >
        {!selectedZone ? (
          <div className="text-fg-4">Select a zone on the map first.</div>
        ) : (
          <>
            <button
              onClick={loadStreets}
              disabled={loadingStreets}
              className="w-full px-2 py-1.5 bg-surface-900 border border-surface-600 rounded hover:bg-surface-700 disabled:opacity-40"
            >
              {loadingStreets ? "Querying OSM… (up to ~30s for dense zones)" : `List streets in "${selectedZone.name}"`}
            </button>
            {streetError && <div className="mt-1 text-rose-400">{streetError}</div>}
            {streetsQueried && streets.length === 0 && !streetError && (
              <div className="mt-2 px-2 py-1.5 rounded border border-surface-700 bg-surface-900 text-fg-4 text-[11px]">
                No named streets in "{selectedZone.name}" — likely open ground (moor, farmland, coast).
              </div>
            )}
            {streets.length > 0 && (
              <>
                <div className="mt-2 max-h-40 overflow-y-auto border border-surface-600 rounded p-2 font-mono text-[10px]">
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
      </Section>

      {/* ── Vehicle route ── */}
      <Section
        id="route"
        title="Vehicle search route"
        icon={<Car size={14} />}
        open={openSections.route}
        onToggle={toggleSection}
        summary={
          !selectedZone
            ? "Select a zone first"
            : vehicleRouteMeta
              ? `${(vehicleRouteMeta.distance_m / 1000).toFixed(1)} km · ${Math.round(vehicleRouteMeta.duration_s / 60)} min`
              : `Zone: "${selectedZone.name}"`
        }
      >
        {!selectedZone ? (
          <div className="text-fg-4">Select a zone to generate a driving route through it.</div>
        ) : (
          <>
            <button
              onClick={buildVehicleRoute}
              disabled={busy === "route"}
              className="w-full px-2 py-1.5 bg-surface-900 border border-surface-600 rounded hover:bg-surface-700 disabled:opacity-40"
            >
              {busy === "route" ? "Routing… (up to ~30s)" : "Generate driving route"}
            </button>
            {vehicleRoute && vehicleRouteMeta && (
              <div className="mt-2 p-2 bg-surface-900 rounded text-[11px] border border-surface-600">
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
      </Section>
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
