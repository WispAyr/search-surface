"use client";

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { search } from "@/lib/api";
import { Printer, MapPin, AlertTriangle, Users, Target, Clock, RefreshCw } from "lucide-react";

interface BriefData {
  operation: any;
  sitrep: any;
  reports: any[];
  share: { token: string; expires_at: string | null };
  generated_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  missing_person: "Missing Person",
  security_sweep: "Security Sweep",
  event_patrol: "Event Patrol",
  welfare_check: "Welfare Check",
  custom: "Custom",
};

export default function BriefPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get("print") === "1";

  const [data, setData] = useState<BriefData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const d = await search.getBrief(token);
        if (mounted) setData(d);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [token]);

  // Open the print dialog once data has rendered. Small delay so fonts/layout
  // settle; without this, the first print preview sometimes misses the SITREP.
  useEffect(() => {
    if (autoPrint && data) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [autoPrint, data]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Loading briefing…</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-sm text-red-500">Invalid or expired share link</div>;
  if (!data) return null;

  const op = data.operation;
  const zones = op.zones || [];
  const teams = op.teams || [];
  const datums = op.datums || [];
  const s = data.sitrep?.summary || {};

  const urgentReports = (data.reports || []).filter((r: any) => r.severity === "urgent" || r.severity === "critical");
  const clueReports = (data.reports || []).filter((r: any) => r.type === "clue");

  return (
    <div className="brief-page min-h-screen bg-white text-gray-900">
      {/* Print-only stylesheet — keeps one screen-optimised render and a clean */}
      {/* paper layout without needing CSS modules. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          .no-print { display: none !important; }
          .brief-page { background: white !important; }
          .brief-section { page-break-inside: avoid; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .brief-page { font-family: ui-sans-serif, system-ui, sans-serif; }
      `}</style>

      {/* Action bar — screen only */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm">
        <div className="text-sm text-gray-600">
          Briefing — <span className="font-medium text-gray-900">{op.name}</span>
          {data.share.expires_at && (
            <span className="ml-2 text-xs text-gray-500">expires {new Date(data.share.expires_at).toLocaleString()}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
            aria-label="Refresh"
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

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
        {/* Header */}
        <div className="brief-section border-b-2 border-gray-900 pb-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-gray-500">SAR Briefing</div>
              <h1 className="text-2xl font-bold text-gray-900 mt-0.5">{op.name}</h1>
              <div className="text-sm text-gray-600 mt-1">
                {TYPE_LABELS[op.type] || op.type} · <span className="uppercase font-medium">{op.status}</span>
              </div>
            </div>
            <div className="text-right text-[11px] text-gray-500">
              <div>Generated {new Date(data.generated_at).toLocaleString()}</div>
              {op.created_at && <div>Opened {new Date(op.created_at).toLocaleString()}</div>}
            </div>
          </div>

          {op.subject_info && (op.subject_info.name || op.subject_info.description) && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm">
              <div className="text-[10px] uppercase tracking-wider text-red-700 font-semibold mb-1 flex items-center gap-1">
                <AlertTriangle size={11} /> Subject
              </div>
              <div>
                {op.subject_info.name && <span className="font-semibold">{op.subject_info.name}</span>}
                {op.subject_info.age && <span className="text-gray-700">, {op.subject_info.age} y/o</span>}
              </div>
              {op.subject_info.description && <div className="text-gray-700 text-xs mt-1">{op.subject_info.description}</div>}
            </div>
          )}
        </div>

        {/* Key numbers */}
        <div className="brief-section grid grid-cols-4 gap-2">
          <KPI label="Zones" value={`${s.complete ?? 0}/${s.total_zones ?? zones.length}`} sub="complete" />
          <KPI label="Avg POD" value={`${Math.round((s.avg_pod ?? 0) * 100)}%`} />
          <KPI label="Teams" value={`${s.deployed_teams ?? 0}/${s.total_teams ?? teams.length}`} sub="deployed" />
          <KPI label="Clues" value={String(s.clue_count ?? 0)} accent={(s.clue_count ?? 0) > 0} />
        </div>

        {/* Datums */}
        {datums.length > 0 && (
          <div className="brief-section">
            <SectionTitle icon={<MapPin size={13} />} title="Reference Points" />
            <div className="border border-gray-200 rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-1.5">Label</th>
                    <th className="text-left px-3 py-1.5">Kind</th>
                    <th className="text-left px-3 py-1.5">Coordinates</th>
                    <th className="text-left px-3 py-1.5">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {datums.map((d: any) => (
                    <tr key={d.id} className="border-t border-gray-200">
                      <td className="px-3 py-1.5 font-medium">{d.label}</td>
                      <td className="px-3 py-1.5 text-xs uppercase text-gray-600">{d.kind}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{d.lat.toFixed(5)}, {d.lon.toFixed(5)}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-600">{d.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Zones */}
        {zones.length > 0 && (
          <div className="brief-section">
            <SectionTitle icon={<Target size={13} />} title="Search Zones" />
            <div className="border border-gray-200 rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-1.5">Name</th>
                    <th className="text-left px-3 py-1.5">Method</th>
                    <th className="text-left px-3 py-1.5">Priority</th>
                    <th className="text-left px-3 py-1.5">Status</th>
                    <th className="text-left px-3 py-1.5">POD</th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map((z: any) => (
                    <tr key={z.id} className="border-t border-gray-200">
                      <td className="px-3 py-1.5 font-medium">{z.name}</td>
                      <td className="px-3 py-1.5 text-xs">{(z.search_method || "").replace(/_/g, " ")}</td>
                      <td className="px-3 py-1.5 text-xs">P{z.priority}</td>
                      <td className="px-3 py-1.5 text-xs uppercase">{z.status.replace(/_/g, " ")}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{Math.round((z.cumulative_pod || 0) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Teams */}
        {teams.length > 0 && (
          <div className="brief-section">
            <SectionTitle icon={<Users size={13} />} title="Teams" />
            <div className="border border-gray-200 rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-1.5">Name</th>
                    <th className="text-left px-3 py-1.5">Callsign</th>
                    <th className="text-left px-3 py-1.5">Capability</th>
                    <th className="text-left px-3 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t: any) => (
                    <tr key={t.id} className="border-t border-gray-200">
                      <td className="px-3 py-1.5 font-medium">{t.name}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{t.callsign || "—"}</td>
                      <td className="px-3 py-1.5 text-xs">{t.capability || "—"}</td>
                      <td className="px-3 py-1.5 text-xs uppercase">{t.status.replace(/_/g, " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Clue reports */}
        {clueReports.length > 0 && (
          <div className="brief-section">
            <SectionTitle icon={<AlertTriangle size={13} />} title={`Clues (${clueReports.length})`} />
            <div className="space-y-1.5">
              {clueReports.map((r: any) => (
                <div key={r.id} className="p-2 border border-amber-200 bg-amber-50 rounded text-sm">
                  <div className="text-xs text-gray-600">{new Date(r.created_at).toLocaleString()} · {r.team_name || "Unknown"}{r.grid_ref ? ` · ${r.grid_ref}` : ""}</div>
                  <div>{r.description || "—"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Urgent reports */}
        {urgentReports.length > 0 && (
          <div className="brief-section">
            <SectionTitle icon={<AlertTriangle size={13} />} title={`Urgent Reports (${urgentReports.length})`} />
            <div className="space-y-1.5">
              {urgentReports.map((r: any) => (
                <div key={r.id} className="p-2 border border-red-200 bg-red-50 rounded text-sm">
                  <div className="text-xs text-gray-600">{new Date(r.created_at).toLocaleString()} · {r.team_name || "Unknown"} · {r.type}</div>
                  <div>{r.description || "—"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SITREP text */}
        {data.sitrep?.text && (
          <div className="brief-section">
            <SectionTitle icon={<Clock size={13} />} title="SITREP" />
            <pre className="text-xs font-mono whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded p-3 text-gray-800">
              {data.sitrep.text}
            </pre>
          </div>
        )}

        <div className="text-[10px] text-gray-400 pt-4 border-t border-gray-200">
          Read-only briefing — search.wispayr.online · token {data.share.token.slice(0, 12)}…
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="border border-gray-300 rounded p-2 text-center bg-gray-50">
      <div className={`text-xl font-bold ${accent ? "text-red-600" : "text-gray-900"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-2 border-b border-gray-200 pb-1">
      {icon}{title}
    </h2>
  );
}
