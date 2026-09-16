"use client";

// Zone print sheet — one A4 per team-zone assignment, handed out on deploy.
// Carries the map, the street checklist (prefers the team's cached list so
// paper and phone stay in sync), datums, notes grid, and the team's field-app
// QR. Runs on `/zone/[id]/print?auto=1` from the operator UI so the print
// dialog fires on load.

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { search } from "@/lib/api";
import { Printer, RefreshCw, MapPin, AlertTriangle } from "lucide-react";

// Leaflet is client-only. Reuse the same lightweight ZoneMap that /field uses.
const ZoneMap = dynamic(() => import("@/app/field/[token]/ZoneMap").then((m) => m.ZoneMap), {
  ssr: false,
});

const TYPE_LABELS: Record<string, string> = {
  missing_person: "Missing Person",
  security_sweep: "Security Sweep",
  event_patrol: "Event Patrol",
  welfare_check: "Welfare Check",
  custom: "Custom",
};

type PrintContext = Awaited<ReturnType<typeof search.getZonePrintContext>>;

export default function ZonePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get("auto") === "1";

  const [data, setData] = useState<PrintContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const d = await search.getZonePrintContext(id);
        if (mounted) setData(d);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [id]);

  // Wait for the map tiles to paint before triggering print — 1.2s is enough
  // for OSM's tile grid at a zoomed-in level; below that the PDF comes out
  // half-rendered.
  useEffect(() => {
    if (autoPrint && data) {
      const t = setTimeout(() => window.print(), 1200);
      return () => clearTimeout(t);
    }
  }, [autoPrint, data]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Loading zone sheet…</div>;
  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <AlertTriangle size={28} className="mx-auto text-red-500 mb-2" />
        <div className="text-sm font-semibold">Can&apos;t load zone</div>
        <div className="text-xs text-gray-500 mt-1 break-words">{error}</div>
      </div>
    </div>
  );
  if (!data) return null;

  const { zone, operation, team, datums, streets, generated_at } = data;
  const geometry = zone.geometry || null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const fieldUrl = team ? `${origin}/field/${team.token}` : null;
  const cleared = streets.filter((s) => s.cleared_at).length;

  return (
    <div className="zone-print min-h-screen bg-white text-gray-900">
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          .no-print { display: none !important; }
          .zone-print { background: white !important; }
          .zp-section { page-break-inside: avoid; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .zp-notes-cell { min-height: 10mm; }
        }
        .zone-print { font-family: ui-sans-serif, system-ui, sans-serif; }
        .zp-notes-cell { min-height: 9mm; }
      `}</style>

      {/* Screen-only action bar */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm">
        <div className="text-sm text-gray-600">
          Zone sheet — <span className="font-medium text-gray-900">{zone.name}</span>
          {team && <span className="ml-2 text-xs text-gray-500">· {team.callsign || team.name}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded"
          >
            <Printer size={13} /> Print / Save PDF
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-5 space-y-4">
        {/* Header + QR strip */}
        <div className="zp-section border-b-2 border-gray-900 pb-3 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.15em] text-gray-500">Zone Sheet</div>
            <h1 className="text-2xl font-bold text-gray-900 mt-0.5 truncate">{zone.name}</h1>
            <div className="text-sm text-gray-700 mt-1">
              <span className="font-medium">{operation.name}</span>
              <span className="text-gray-500"> · {TYPE_LABELS[operation.type] || operation.type}</span>
            </div>
            <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              <span>Method: <span className="font-medium">{(zone.search_method || "").replace(/_/g, " ") || "—"}</span></span>
              <span>Priority: <span className="font-medium">P{zone.priority}</span></span>
              <span>Status: <span className="uppercase font-medium">{zone.status.replace(/_/g, " ")}</span></span>
              <span>POD: <span className="font-mono">{Math.round((zone.cumulative_pod || 0) * 100)}%</span></span>
              {zone.terrain_class && <span>Terrain: <span className="font-medium">{zone.terrain_class}</span></span>}
            </div>
            {team && (
              <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 rounded border border-gray-300 bg-gray-50 text-xs">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color || "#999" }} />
                <span className="font-semibold">{team.callsign || team.name}</span>
                <span className="text-gray-500">· {team.capability || "—"}</span>
              </div>
            )}
          </div>

          {fieldUrl && (
            <div className="shrink-0 text-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(fieldUrl)}`}
                alt="Team sign-in QR"
                className="w-32 h-32 border border-gray-300 rounded bg-white"
              />
              <div className="text-[9px] text-gray-500 mt-1">Team sign-in</div>
              <div className="text-[9px] text-gray-500 font-mono break-all max-w-[128px]">
                {fieldUrl.replace(/^https?:\/\//, "")}
              </div>
            </div>
          )}
        </div>

        {/* Subject card — mirrors /brief layout so paper matches screen */}
        {operation.subject_info && (() => {
          const s = operation.subject_info as Record<string, unknown>;
          const name = typeof s.name === "string" ? s.name : null;
          const age = typeof s.age === "number" ? s.age : null;
          const desc = typeof s.description === "string" ? s.description : null;
          const medical = typeof s.medical === "string" ? s.medical : null;
          const photo = typeof s.photo_url === "string" ? s.photo_url : null;
          if (!name && !desc && !photo) return null;
          return (
            <div className="zp-section p-3 bg-red-50 border border-red-200 rounded text-sm flex gap-3">
              {photo && (
                <img
                  src={photo}
                  alt={name || "Subject"}
                  className="w-20 h-20 object-cover rounded border border-red-200 shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-red-700 font-semibold mb-1 flex items-center gap-1">
                  <AlertTriangle size={11} /> Subject
                </div>
                <div>
                  {name && <span className="font-semibold">{name}</span>}
                  {age !== null && <span className="text-gray-700">, {age} y/o</span>}
                </div>
                {desc && <div className="text-gray-700 text-xs mt-1 whitespace-pre-wrap break-words">{desc}</div>}
                {medical && <div className="text-red-800 text-xs mt-1"><span className="font-semibold">Medical:</span> {medical}</div>}
              </div>
            </div>
          );
        })()}

        {/* Map + datum sidebar */}
        <div className="zp-section grid grid-cols-3 gap-3">
          <div className="col-span-2 border border-gray-300 rounded overflow-hidden" style={{ height: "95mm" }}>
            <ZoneMap
              zoneGeometry={geometry as GeoJSON.Feature | GeoJSON.Geometry | null}
              datum={operation.datum_lat != null && operation.datum_lon != null ? [operation.datum_lat, operation.datum_lon] : null}
            />
          </div>
          <div className="col-span-1 text-xs">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              <MapPin size={10} /> Reference points
            </div>
            {datums.length === 0 ? (
              <div className="text-gray-500 text-[11px]">No datums recorded.</div>
            ) : (
              <ul className="space-y-1.5">
                {datums.map((d) => (
                  <li key={d.id} className="border border-gray-200 rounded p-1.5">
                    <div className="font-medium truncate">{d.label}</div>
                    <div className="text-[10px] uppercase text-gray-500">{d.kind}</div>
                    <div className="font-mono text-[10px] text-gray-700">{d.lat.toFixed(5)}, {d.lon.toFixed(5)}</div>
                    {d.notes && <div className="text-[10px] text-gray-600 mt-0.5">{d.notes}</div>}
                  </li>
                ))}
              </ul>
            )}
            {zone.notes && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Zone notes</div>
                <div className="text-[11px] text-gray-800 whitespace-pre-wrap break-words">{zone.notes}</div>
              </div>
            )}
          </div>
        </div>

        {/* Street checklist */}
        <div className="zp-section">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-gray-900">Street checklist</h2>
            <span className="text-[11px] text-gray-500 font-mono">{cleared}/{streets.length} cleared</span>
          </div>
          {streets.length === 0 ? (
            <div className="text-xs text-gray-500 border border-gray-200 rounded p-3">
              No streets in this zone&apos;s OSM footprint. Use the notes grid below to record structures and paths manually.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
              {streets.map((s) => (
                <div key={s.name} className="flex items-center gap-2 border-b border-gray-100 py-0.5">
                  <span className="w-3 h-3 border border-gray-400 inline-flex items-center justify-center text-[10px] leading-none shrink-0">
                    {s.cleared_at ? "✓" : ""}
                  </span>
                  <span className={`truncate ${s.cleared_at ? "line-through text-gray-400" : ""}`}>{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes / field-log grid */}
        <div className="zp-section">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Field log</h2>
          <div className="border border-gray-300 rounded overflow-hidden text-xs">
            <div className="grid grid-cols-12 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-600">
              <div className="col-span-2 px-2 py-1 border-r border-gray-300">Time</div>
              <div className="col-span-2 px-2 py-1 border-r border-gray-300">Location / grid</div>
              <div className="col-span-2 px-2 py-1 border-r border-gray-300">Reporter</div>
              <div className="col-span-6 px-2 py-1">Observation / action</div>
            </div>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="grid grid-cols-12 border-t border-gray-200">
                <div className="col-span-2 px-2 py-0.5 border-r border-gray-200 zp-notes-cell" />
                <div className="col-span-2 px-2 py-0.5 border-r border-gray-200 zp-notes-cell" />
                <div className="col-span-2 px-2 py-0.5 border-r border-gray-200 zp-notes-cell" />
                <div className="col-span-6 px-2 py-0.5 zp-notes-cell" />
              </div>
            ))}
          </div>
        </div>

        <div className="text-[10px] text-gray-400 pt-3 border-t border-gray-200 flex justify-between">
          <span>Generated {new Date(generated_at).toLocaleString()}</span>
          <span>search.wispayr.online · zone {zone.id.slice(0, 8)}…</span>
        </div>
      </div>
    </div>
  );
}
