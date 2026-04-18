"use client";

// IC-facing alarm bar. Sits directly under the operation header and surfaces
// the small number of things an incident commander genuinely needs to notice
// NOW: a team that's gone silent in the field, a zone that's been assigned
// without progress for too long, or an urgent report nobody has acknowledged.
//
// We deliberately don't show low-severity warnings here — this bar is for the
// four-item "if these aren't green, we have a problem" surface. Everything
// less urgent lives in its panel.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, RadioTower, UserX, X } from "lucide-react";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation, SearchTeam, SearchZone, SearchReport } from "@/types/search";

// Thresholds. Tuned for a UK SAR op cadence — stale-team 15min tracks the
// memory on doCheckin auto-cadence (5m × 3 misses). Overdue zone at 2h reflects
// typical time-to-sweep; fatigue at 4h tracks standard welfare rotation.
const STALE_TEAM_MIN = 15;
const OVERDUE_ZONE_H = 2;
const FATIGUE_H = 4;
const URGENT_UNACK_MIN = 5;

type AlarmKind = "stale_team" | "overdue_zone" | "fatigue" | "urgent_report";

interface Alarm {
  id: string;
  kind: AlarmKind;
  label: string;
  detail: string;
  onClick?: () => void;
}

function minutesAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / 60_000);
}

function computeAlarms(op: SearchOperation, reports: SearchReport[]): Alarm[] {
  const alarms: Alarm[] = [];
  const teamById = new Map<string, SearchTeam>(op.teams.map((t) => [t.id, t]));

  for (const team of op.teams) {
    if (team.status !== "deployed" && team.status !== "returning") continue;

    const mins = minutesAgo(team.last_position_at);
    if (mins != null && mins >= STALE_TEAM_MIN) {
      alarms.push({
        id: `stale:${team.id}`,
        kind: "stale_team",
        label: team.callsign || team.name,
        detail: `silent ${mins}m`,
      });
    }

    const deployedMins = minutesAgo(team.deployed_at);
    if (deployedMins != null && deployedMins >= FATIGUE_H * 60) {
      const h = Math.floor(deployedMins / 60);
      const m = deployedMins % 60;
      alarms.push({
        id: `fatigue:${team.id}`,
        kind: "fatigue",
        label: team.callsign || team.name,
        detail: `deployed ${h}h${m ? ` ${m}m` : ""}`,
      });
    }
  }

  for (const zone of op.zones as SearchZone[]) {
    if (!zone.assigned_team_id) continue;
    if (zone.status === "complete" || zone.status === "suspended") continue;
    if (zone.cumulative_pod >= 0.1) continue;
    const mins = minutesAgo(zone.updated_at);
    if (mins == null || mins < OVERDUE_ZONE_H * 60) continue;
    const team = teamById.get(zone.assigned_team_id);
    const h = (mins / 60).toFixed(1);
    alarms.push({
      id: `overdue:${zone.id}`,
      kind: "overdue_zone",
      label: zone.name,
      detail: `${team?.callsign || team?.name || "team"} · ${h}h no POD`,
    });
  }

  for (const r of reports) {
    if (r.acknowledged) continue;
    if (r.severity !== "urgent" && r.severity !== "critical") continue;
    const mins = minutesAgo(r.created_at);
    if (mins == null || mins < URGENT_UNACK_MIN) continue;
    const who = r.team_callsign || r.team_name || "field";
    alarms.push({
      id: `report:${r.id}`,
      kind: "urgent_report",
      label: `${r.severity.toUpperCase()} · ${r.type}`,
      detail: `${who} · ${mins}m unack'd`,
    });
  }

  return alarms;
}

function iconFor(kind: AlarmKind) {
  switch (kind) {
    case "stale_team": return RadioTower;
    case "fatigue": return Clock;
    case "overdue_zone": return UserX;
    case "urgent_report": return AlertTriangle;
  }
}

function toneFor(kind: AlarmKind): string {
  // Red is reserved for hard alarms — silent team & urgent report. Amber for
  // advisories that don't necessarily indicate a failure (overdue zone, fatigue).
  switch (kind) {
    case "stale_team": return "bg-red-500/15 border-red-500/40 text-red-200 hover:bg-red-500/25";
    case "urgent_report": return "bg-red-500/15 border-red-500/40 text-red-200 hover:bg-red-500/25";
    case "fatigue": return "bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25";
    case "overdue_zone": return "bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25";
  }
}

interface AlarmBarProps { operation: SearchOperation; }

export function AlarmBar({ operation }: AlarmBarProps) {
  const reports = useSearchStore((s) => s.reports);
  const setRightPanel = useSearchStore((s) => s.setRightPanel);
  const selectTeam = useSearchStore((s) => s.selectTeam);
  const selectZone = useSearchStore((s) => s.selectZone);
  const setMobilePanelOpen = useSearchStore((s) => s.setMobilePanelOpen);
  const dismissed = useSearchStore((s) => s.dismissedAlarmIds);
  const dismiss = useSearchStore((s) => s.dismissAlarm);

  // Tick once a minute so "silent 14m" promotes to 15m without waiting for the
  // next SSE event. Cheap and avoids silent alarms that never fire.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const alarms = useMemo(
    () => computeAlarms(operation, reports).filter((a) => !dismissed.has(a.id)),
    // The tick setter re-renders us; the useMemo itself need only depend on
    // data + dismissals.
    [operation, reports, dismissed]
  );

  if (alarms.length === 0) return null;

  const openPanel = (kind: AlarmKind, id: string) => {
    setMobilePanelOpen(true);
    if (kind === "stale_team" || kind === "fatigue") {
      const teamId = id.split(":")[1];
      selectTeam(teamId);
      setRightPanel("teams");
    } else if (kind === "overdue_zone") {
      const zoneId = id.split(":")[1];
      selectZone(zoneId);
      setRightPanel("zones");
    } else if (kind === "urgent_report") {
      setRightPanel("reports");
    }
  };

  return (
    <div
      role="region"
      aria-label="Active alarms"
      className="px-3 py-1.5 border-b border-surface-700 bg-surface-900/60 flex items-center gap-2 overflow-x-auto scrollbar-thin"
    >
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg-4 font-medium pr-1">
        Alarms
      </span>
      {alarms.map((a) => {
        const Icon = iconFor(a.kind);
        return (
          <div
            key={a.id}
            className={`shrink-0 inline-flex items-center gap-1.5 pl-2 pr-1 py-1 border rounded text-[11px] font-medium transition ${toneFor(a.kind)}`}
          >
            <button
              onClick={() => openPanel(a.kind, a.id)}
              className="inline-flex items-center gap-1.5"
              title={`${a.label} · ${a.detail}`}
            >
              <Icon size={12} />
              <span className="font-semibold">{a.label}</span>
              <span className="opacity-80">· {a.detail}</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); dismiss(a.id); }}
              className="ml-0.5 p-0.5 rounded hover:bg-white/10 opacity-70"
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
