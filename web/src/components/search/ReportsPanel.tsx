"use client";

import { useEffect } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import type { SearchReport, Severity } from "@/types/search";
import { AlertTriangle, Check, MapPin, Camera, Radio, Heart, HelpCircle, Flag } from "lucide-react";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  clue: <Flag size={12} className="text-red-400" />,
  area_clear: <Check size={12} className="text-green-400" />,
  hazard: <AlertTriangle size={12} className="text-amber-400" />,
  assist: <HelpCircle size={12} className="text-red-400" />,
  welfare: <Heart size={12} className="text-blue-400" />,
  photo: <Camera size={12} className="text-purple-400" />,
  checkin: <MapPin size={12} className="text-fg-4" />,
  sitrep: <Radio size={12} className="text-accent" />,
};

const SEVERITY_COLORS: Record<Severity, string> = {
  info: "border-l-surface-600",
  warn: "border-l-amber-500",
  urgent: "border-l-orange-500",
  critical: "border-l-red-500",
};

export function ReportsPanel({ operationId }: { operationId: string }) {
  const { reports, setReports } = useSearchStore();

  useEffect(() => {
    search.listReports(operationId).then((d: any) => setReports(d.reports || [])).catch(() => {});
  }, [operationId]);

  const handleAcknowledge = async (reportId: string) => {
    try {
      await search.acknowledgeReport(operationId, reportId);
      setReports(reports.map((r) => (r.id === reportId ? { ...r, acknowledged: true } : r)));
    } catch {}
  };

  const nonCheckin = reports.filter((r) => r.type !== "checkin");

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-fg-4 uppercase tracking-wider">Field Reports</h3>
        <span className="text-xs text-fg-4">{nonCheckin.length} reports</span>
      </div>

      {nonCheckin.length === 0 ? (
        <p className="text-xs text-fg-4 py-4 text-center">No reports yet</p>
      ) : (
        <div className="space-y-1.5">
          {nonCheckin.map((r) => (
            <div
              key={r.id}
              className={`p-2.5 bg-surface-800 border border-surface-700 border-l-2 ${
                SEVERITY_COLORS[r.severity]
              } rounded text-xs`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {TYPE_ICONS[r.type]}
                  <span className="font-medium capitalize">{r.type.replace(/_/g, " ")}</span>
                  {r.team_name && (
                    <span className="text-fg-4">— {r.team_name}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!r.acknowledged && r.severity !== "info" && (
                    <button
                      onClick={() => handleAcknowledge(r.id)}
                      className="px-1.5 py-0.5 bg-accent/10 text-accent rounded hover:bg-accent/20 text-[10px]"
                    >
                      ACK
                    </button>
                  )}
                  {r.acknowledged && (
                    <Check size={10} className="text-green-400" />
                  )}
                  <span className="text-fg-4">
                    {new Date(r.created_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              {r.description && (
                <p className="mt-1 text-fg-3">{r.description}</p>
              )}

              <div className="mt-1.5 flex items-center gap-3 text-[10px] text-fg-4">
                {r.lat && (
                  <span className="flex items-center gap-0.5">
                    <MapPin size={8} />
                    {r.lat.toFixed(4)}, {r.lon?.toFixed(4)}
                  </span>
                )}
                {r.grid_ref && <span>Grid: {r.grid_ref}</span>}
                {r.photo_url && (
                  <a href={r.photo_url} target="_blank" className="text-accent hover:underline">
                    View photo
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
