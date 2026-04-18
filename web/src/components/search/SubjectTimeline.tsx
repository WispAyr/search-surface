"use client";

// Subject Timeline — the missing piece for missing-person operations.
//
// Merges the three time-anchored sources into a single chronological narrative:
//   - Datums: LKP / PLP / sightings / witness statements (user-entered)
//   - subject_info.last_seen: the original reported LKP (if provided in the
//     incident wizard but never materialised as a datum)
//   - Field reports: clues, area-clears, hazards, welfare checks, photos
//
// Ordering is earliest-first so the reader can read the story of where the
// subject has been, with an elapsed-since-LKP column that shows how stale
// each clue is relative to the primary LKP. Click an entry with coordinates
// and the map pans to it.

import { useMemo } from "react";
import { MapPin, Radio, AlertTriangle, Camera, Flag, HelpCircle, CheckCircle2, Compass, Clock } from "lucide-react";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation, SearchDatum, SearchReport } from "@/types/search";

type Entry = {
  id: string;
  at: string;                    // ISO timestamp
  kind:
    | "lkp"
    | "plp"
    | "sighting"
    | "witness"
    | "datum_other"
    | "clue"
    | "hazard"
    | "photo"
    | "welfare"
    | "area_clear"
    | "checkin"
    | "assist";
  label: string;
  detail?: string;
  lat?: number | null;
  lon?: number | null;
  source: "datum" | "report" | "subject";
  severity?: string;
};

function iconFor(kind: Entry["kind"]) {
  switch (kind) {
    case "lkp": return Flag;
    case "plp": return HelpCircle;
    case "sighting": return MapPin;
    case "witness": return Radio;
    case "clue": return Flag;
    case "hazard": return AlertTriangle;
    case "photo": return Camera;
    case "welfare":
    case "checkin": return CheckCircle2;
    case "area_clear": return CheckCircle2;
    case "assist": return Compass;
    default: return MapPin;
  }
}

function accentFor(kind: Entry["kind"], severity?: string): string {
  if (severity === "critical" || severity === "urgent") return "text-red-300 border-red-500/50";
  if (kind === "lkp") return "text-red-300 border-red-500/50";
  if (kind === "plp") return "text-amber-300 border-amber-500/50";
  if (kind === "sighting") return "text-sky-300 border-sky-500/50";
  if (kind === "witness") return "text-violet-300 border-violet-500/50";
  if (kind === "clue") return "text-emerald-300 border-emerald-500/50";
  if (kind === "hazard") return "text-orange-300 border-orange-500/50";
  if (kind === "area_clear" || kind === "checkin") return "text-fg-3 border-surface-600";
  return "text-fg-3 border-surface-600";
}

function fmtRel(from: number, to: number): string {
  const deltaMin = Math.round((to - from) / 60_000);
  if (deltaMin < 0) return "–";
  if (deltaMin < 1) return "now";
  if (deltaMin < 60) return `+${deltaMin}m`;
  const h = Math.floor(deltaMin / 60);
  const m = deltaMin % 60;
  return m ? `+${h}h${m}m` : `+${h}h`;
}

interface SubjectTimelineProps { operation: SearchOperation; }

export function SubjectTimeline({ operation }: SubjectTimelineProps) {
  const reports = useSearchStore((s) => s.reports);
  const setMapFlyTo = useSearchStore((s) => s.setMapFlyTo);

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];

    // Original subject_info.last_seen is a string — could be a time, a place,
    // or both. We only add it as an entry if it parses to a date; otherwise it
    // lives in the header strip above the timeline.
    const lastSeenRaw = operation.subject_info?.last_seen;
    if (lastSeenRaw) {
      const t = new Date(lastSeenRaw).getTime();
      if (!Number.isNaN(t)) {
        const ls = operation.subject_info?.last_seen_location;
        out.push({
          id: `subject-ls`,
          at: new Date(t).toISOString(),
          kind: "lkp",
          label: "Last seen",
          detail: operation.subject_info?.name
            ? `${operation.subject_info.name}`
            : undefined,
          lat: ls?.[0],
          lon: ls?.[1],
          source: "subject",
        });
      }
    }

    for (const d of (operation.datums || []) as SearchDatum[]) {
      out.push({
        id: `datum:${d.id}`,
        at: d.created_at,
        kind: (d.kind as Entry["kind"]) || "datum_other",
        label: d.label || d.kind.toUpperCase(),
        detail: d.notes || undefined,
        lat: d.lat,
        lon: d.lon,
        source: "datum",
      });
    }

    for (const r of reports as SearchReport[]) {
      const kind = (r.type as Entry["kind"]);
      // Skip sitrep/photo-only/system noise that dilutes the story — but keep
      // area_clear so the reader can see which zones have been swept by when.
      if (kind === "photo" && !r.lat && !r.lon) continue;
      out.push({
        id: `report:${r.id}`,
        at: r.created_at,
        kind,
        label: kind === "area_clear" ? (r.description || "area clear").replace(/^Cleared:\s*/, "cleared: ") : kind,
        detail: kind === "area_clear" ? undefined : r.description || undefined,
        lat: r.lat,
        lon: r.lon,
        source: "report",
        severity: r.severity,
      });
    }

    out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return out;
  }, [operation.datums, operation.subject_info, reports]);

  // Anchor for +elapsed column: the first LKP / last_seen we find, else op created_at.
  const anchorMs = useMemo(() => {
    const lkp = entries.find((e) => e.kind === "lkp");
    if (lkp) return new Date(lkp.at).getTime();
    return new Date(operation.created_at).getTime();
  }, [entries, operation.created_at]);

  return (
    <div className="p-3">
      {/* Subject strip */}
      {operation.subject_info && (operation.subject_info.name || operation.subject_info.description) && (
        <div className="mb-3 p-2.5 bg-surface-800/60 border border-surface-700 rounded text-[12px]">
          <div className="flex items-center gap-2">
            <Flag size={12} className="text-red-400 shrink-0" />
            <span className="font-semibold text-fg-1">{operation.subject_info.name || "Subject"}</span>
            {operation.subject_info.age != null && (
              <span className="text-fg-4">· {operation.subject_info.age}</span>
            )}
          </div>
          {operation.subject_info.description && (
            <p className="mt-1 text-fg-3">{operation.subject_info.description}</p>
          )}
          {operation.subject_info.medical && (
            <p className="mt-1 text-amber-300/90 text-[11px]">Medical: {operation.subject_info.medical}</p>
          )}
        </div>
      )}

      <h3 className="text-xs font-medium text-fg-4 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Clock size={12} /> Timeline
        <span className="ml-auto text-[10px] text-fg-4 normal-case tracking-normal">
          {entries.length} {entries.length === 1 ? "event" : "events"}
        </span>
      </h3>

      {entries.length === 0 ? (
        <p className="text-xs text-fg-4 py-4 text-center">
          No datums or reports yet. Drop an LKP pin to start the timeline.
        </p>
      ) : (
        <ol className="relative pl-5 before:absolute before:left-2 before:top-1 before:bottom-1 before:w-px before:bg-surface-700">
          {entries.map((e) => {
            const Icon = iconFor(e.kind);
            const hasCoords = e.lat != null && e.lon != null;
            const when = new Date(e.at);
            const timeStr = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const dateStr = when.toLocaleDateString([], { month: "short", day: "numeric" });
            const elapsed = fmtRel(anchorMs, when.getTime());
            const accent = accentFor(e.kind, e.severity);

            const Inner = (
              <div className="flex gap-2">
                <span
                  className={`absolute left-0 w-4 h-4 rounded-full border-2 bg-surface-900 flex items-center justify-center ${accent}`}
                  style={{ marginLeft: "0px" }}
                  aria-hidden
                >
                  <Icon size={9} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-fg-2 text-[12px] capitalize truncate">{e.label}</span>
                    {e.severity && e.severity !== "info" && (
                      <span className={`text-[9px] uppercase font-semibold tracking-wide ${accent.split(" ")[0]}`}>
                        {e.severity}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-fg-4 font-mono">
                    <span>{timeStr}</span>
                    <span className="text-fg-5">·</span>
                    <span>{dateStr}</span>
                    <span className="text-fg-5">·</span>
                    <span className="text-fg-3">{elapsed}</span>
                    {hasCoords && (
                      <>
                        <span className="text-fg-5">·</span>
                        <span>{e.lat!.toFixed(4)}, {e.lon!.toFixed(4)}</span>
                      </>
                    )}
                  </div>
                  {e.detail && (
                    <p className="mt-0.5 text-[11px] text-fg-3">{e.detail}</p>
                  )}
                </div>
              </div>
            );

            return (
              <li key={e.id} className="relative py-1.5">
                {hasCoords ? (
                  <button
                    onClick={() => setMapFlyTo(e.lat!, e.lon!)}
                    className="w-full text-left hover:bg-surface-800/50 -mx-2 px-2 py-0.5 rounded"
                    title="Pan map to this point"
                  >
                    {Inner}
                  </button>
                ) : (
                  <div>{Inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
