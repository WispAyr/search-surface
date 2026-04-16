"use client";

import { useMemo, useState } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation, SearchZone } from "@/types/search";
import { ChevronDown, ChevronUp, MapPin, Users, Check, Pause, Trash2, Download, Plane, Clock, ArrowUpDown, Filter } from "lucide-react";

const STATUS_BADGE: Record<string, { bg: string; label: string }> = {
  unassigned: { bg: "bg-surface-600 text-fg-4", label: "Unassigned" },
  assigned: { bg: "bg-blue-500/20 text-blue-300", label: "Assigned" },
  in_progress: { bg: "bg-amber-500/20 text-amber-300", label: "In Progress" },
  complete: { bg: "bg-green-500/20 text-green-300", label: "Complete" },
  suspended: { bg: "bg-red-500/20 text-red-300", label: "Suspended" },
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "text-red-400",
  2: "text-amber-400",
  3: "text-fg-3",
  4: "text-fg-4",
  5: "text-fg-4/50",
};

type SortKey = "priority" | "name" | "status" | "pod";
type StatusFilter = "all" | "unassigned" | "assigned" | "in_progress" | "complete" | "suspended";

const STATUS_ORDER: Record<string, number> = { in_progress: 0, assigned: 1, unassigned: 2, suspended: 3, complete: 4 };

export function ZoneStatusBoard({ operation, onRefresh }: { operation: SearchOperation; onRefresh?: () => void }) {
  const { selectedZoneId, selectZone } = useSearchStore();
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const rawZones = operation.zones || [];
  const teams = operation.teams || [];

  const zones = useMemo(() => {
    const filtered = statusFilter === "all" ? rawZones : rawZones.filter((z) => z.status === statusFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "priority") cmp = a.priority - b.priority;
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "status") cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      else if (sortKey === "pod") cmp = (a.cumulative_pod || 0) - (b.cumulative_pod || 0);
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return cmp * dir;
    });
  }, [rawZones, sortKey, sortDir, statusFilter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "pod" ? "desc" : "asc"); }
  };

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: rawZones.length };
    for (const z of rawZones) c[z.status] = (c[z.status] || 0) + 1;
    return c;
  }, [rawZones]);

  const getTeamName = (id: string | null) => {
    if (!id) return null;
    return teams.find((t) => t.id === id);
  };

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-fg-4 uppercase tracking-wider">Zone Status Board</h3>
        <span className="text-xs text-fg-4">{zones.length}{statusFilter !== "all" ? `/${rawZones.length}` : ""} zones</span>
      </div>

      {rawZones.length > 0 && (
        <div className="mb-2.5 space-y-1.5">
          {/* Sort controls */}
          <div className="flex items-center gap-1 text-[10px]">
            <ArrowUpDown size={10} className="text-fg-4" />
            {(["priority", "name", "status", "pod"] as const).map((k) => (
              <button
                key={k}
                onClick={() => toggleSort(k)}
                className={`px-1.5 py-0.5 rounded uppercase tracking-wider ${
                  sortKey === k ? "bg-accent/20 text-accent" : "text-fg-4 hover:text-fg-2"
                }`}
              >
                {k === "pod" ? "POD" : k}
                {sortKey === k && <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>}
              </button>
            ))}
          </div>
          {/* Status filter chips */}
          <div className="flex items-center gap-1 text-[10px] flex-wrap">
            <Filter size={10} className="text-fg-4" />
            {(["all", "unassigned", "assigned", "in_progress", "complete", "suspended"] as const).map((f) => {
              const count = statusCounts[f] || 0;
              if (f !== "all" && count === 0) return null;
              return (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-1.5 py-0.5 rounded capitalize whitespace-nowrap ${
                    statusFilter === f ? "bg-accent/20 text-accent" : "text-fg-4 hover:text-fg-2"
                  }`}
                >
                  {f.replace(/_/g, " ")} <span className="text-fg-4">({count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rawZones.length === 0 ? (
        <p className="text-xs text-fg-4 py-4 text-center">
          No zones yet. Use the Grid Generator to create search zones.
        </p>
      ) : zones.length === 0 ? (
        <p className="text-xs text-fg-4 py-4 text-center">No zones match the current filter.</p>
      ) : (
        <div className="space-y-1.5">
          {zones.map((z) => {
            const team = getTeamName(z.assigned_team_id);
            const isSelected = selectedZoneId === z.id;
            const isExpanded = expandedZone === z.id;

            return (
              <div key={z.id}>
                <button
                  onClick={() => {
                    selectZone(isSelected ? null : z.id);
                    setExpandedZone(isExpanded ? null : z.id);
                  }}
                  className={`w-full text-left rounded p-2.5 transition text-sm ${
                    isSelected
                      ? "bg-accent/10 border border-accent/30"
                      : "bg-surface-800 border border-surface-700 hover:border-surface-600"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs font-mono ${PRIORITY_COLORS[z.priority]}`}>
                        P{z.priority}
                      </span>
                      <span className="font-medium truncate">{z.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_BADGE[z.status].bg}`}>
                        {STATUS_BADGE[z.status].label}
                      </span>
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </div>
                  </div>

                  {/* POD bar */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface-600 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${Math.round(z.cumulative_pod * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-fg-4 w-8 text-right">
                      {Math.round(z.cumulative_pod * 100)}%
                    </span>
                  </div>

                  {/* Team assignment */}
                  {team && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-3">
                      <Users size={10} />
                      <span style={{ color: team.color }}>{team.name}</span>
                      <span className="text-fg-4">({team.callsign})</span>
                      {/* Street-clear progress — populated async after assignment */}
                      {team.street_checklist && team.street_checklist.length > 0 && (() => {
                        const done = team.street_checklist.filter((s) => s.cleared_at).length;
                        const total = team.street_checklist.length;
                        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                        return (
                          <span className="ml-auto flex items-center gap-1 text-[10px] text-fg-4 font-mono">
                            <span
                              className="inline-block h-1 w-10 bg-surface-700 rounded overflow-hidden"
                              title={`${done}/${total} streets cleared`}
                            >
                              <span
                                className="block h-full bg-emerald-500"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                            {done}/{total}
                          </span>
                        );
                      })()}
                    </div>
                  )}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <ZoneDetail zone={z} teams={teams} onRefresh={() => onRefresh?.()} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ZoneDetail({
  zone,
  teams,
  onRefresh,
}: {
  zone: SearchZone;
  teams: SearchOperation["teams"];
  onRefresh: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local POD state so the slider/input stays responsive while the server
  // round-trips. Reset on debounce-committed save.
  const [podDraft, setPodDraft] = useState<number>(Math.round((zone.cumulative_pod || 0) * 100));
  const { setRightPanel } = useSearchStore();

  const handleUpdate = async (fields: Record<string, unknown>) => {
    setUpdating(true);
    setError(null);
    try {
      await search.updateZone(zone.id, fields);
      onRefresh();
    } catch (err: any) {
      setError(err?.message || "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  const commitPod = () => {
    const next = Math.max(0, Math.min(100, podDraft));
    if (Math.round((zone.cumulative_pod || 0) * 100) === next) return;
    handleUpdate({ cumulative_pod: next / 100 });
  };

  return (
    <div className="ml-4 mt-1 p-3 bg-surface-800/50 border border-surface-700 rounded text-xs space-y-3">
      {/* Editable status + POD */}
      <div className="grid grid-cols-2 gap-2 items-start">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-fg-4 uppercase tracking-wider">Status</span>
          <select
            value={zone.status}
            onChange={(e) => handleUpdate({ status: e.target.value })}
            disabled={updating}
            className="px-2 py-1 bg-surface-700 border border-surface-600 rounded text-xs"
          >
            <option value="unassigned">Unassigned</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In Progress</option>
            <option value="complete">Complete</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-fg-4 uppercase tracking-wider">Cumulative POD ({podDraft}%)</span>
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={podDraft}
              onChange={(e) => setPodDraft(Number(e.target.value))}
              onMouseUp={commitPod}
              onKeyUp={(e) => { if (e.key === "Enter" || e.key === "ArrowRight" || e.key === "ArrowLeft") commitPod(); }}
              onTouchEnd={commitPod}
              disabled={updating}
              className="flex-1 accent-accent"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={podDraft}
              onChange={(e) => setPodDraft(Number(e.target.value))}
              onBlur={commitPod}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              disabled={updating}
              className="w-12 px-1 py-0.5 bg-surface-700 border border-surface-600 rounded text-xs text-right"
            />
          </div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-fg-4">Method:</span>{" "}
          <span className="text-fg-2">{zone.search_method.replace(/_/g, " ")}</span>
        </div>
        <div>
          <span className="text-fg-4">POA:</span>{" "}
          <span className="text-fg-2">{Math.round(zone.poa * 100)}%</span>
        </div>
        <div>
          <span className="text-fg-4">Sweeps:</span>{" "}
          <span className="text-fg-2">{zone.sweep_count}</span>
        </div>
        <div>
          <span className="text-fg-4">Spacing:</span>{" "}
          <span className="text-fg-2">{zone.spacing_m ? `${zone.spacing_m}m` : "—"}</span>
        </div>
      </div>

      {zone.notes && (
        <div className="text-fg-4">{zone.notes}</div>
      )}

      {/* Quick actions */}
      <div className="flex gap-2 flex-wrap">
        {zone.status !== "complete" && (
          <>
            {/* Assign team — or prompt to create one if none exist */}
            {teams.length === 0 ? (
              <button
                onClick={() => setRightPanel("teams")}
                className="flex-1 px-2 py-1 bg-amber-600/10 border border-amber-600/30 text-amber-300 rounded text-xs hover:bg-amber-600/20"
                title="Create a team before assigning"
              >
                No teams — create one in Teams tab →
              </button>
            ) : (
              <select
                value={zone.assigned_team_id || ""}
                onChange={(e) => handleUpdate({
                  assigned_team_id: e.target.value || null,
                  status: e.target.value ? "assigned" : "unassigned",
                })}
                className="flex-1 min-w-0 px-2 py-1 bg-surface-700 border border-surface-600 rounded text-xs"
                disabled={updating}
              >
                <option value="">Unassigned</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.callsign})</option>
                ))}
              </select>
            )}

            <button
              onClick={() => handleUpdate({ status: "in_progress" })}
              disabled={updating || !zone.assigned_team_id}
              className="px-2 py-1 bg-amber-600/20 text-amber-300 rounded hover:bg-amber-600/30 disabled:opacity-50"
              title={zone.assigned_team_id ? "Mark in progress" : "Assign a team first"}
            >
              Start
            </button>
            <button
              onClick={() => handleUpdate({ status: "complete", pod: 0.7 })}
              disabled={updating}
              className="px-2 py-1 bg-green-600/20 text-green-300 rounded hover:bg-green-600/30 disabled:opacity-50"
              title="Mark complete"
            >
              <Check size={12} />
            </button>
          </>
        )}
        {error && (
          <div className="w-full text-[10px] text-red-400">{error}</div>
        )}
        {zone.status === "complete" && (
          <span className="text-green-400 flex items-center gap-1">
            <Check size={12} /> Completed {zone.completed_at ? new Date(zone.completed_at).toLocaleTimeString() : ""}
          </span>
        )}

        {/* Drone flight plan download */}
        {zone.geometry?.properties?.drone_flight_plan && (() => {
          const plan = zone.geometry.properties.drone_flight_plan as any;
          return (
            <div className="flex items-center gap-2 w-full">
              <div className="flex items-center gap-1 text-[10px] text-fg-4">
                <Plane size={10} className="text-accent" />
                <span>{plan.estimated_flight_min}min</span>
                <span>·</span>
                <span>{plan.total_distance_km}km</span>
                <span>·</span>
                <span>{plan.num_passes} passes</span>
                <span>·</span>
                <span>{plan.altitude_m}m AGL</span>
              </div>
              <a
                href={`/api/search/zones/${zone.id}/flight-plan/gpx`}
                target="_blank"
                className="px-1.5 py-0.5 bg-blue-600/20 text-blue-300 rounded text-[10px] hover:bg-blue-600/30"
                title="Download GPX flight plan"
              >
                GPX
              </a>
              <a
                href={`/api/search/zones/${zone.id}/flight-plan/kml`}
                target="_blank"
                className="px-1.5 py-0.5 bg-amber-600/20 text-amber-300 rounded text-[10px] hover:bg-amber-600/30"
                title="Download KML flight plan"
              >
                KML
              </a>
            </div>
          );
        })()}

        {/* Delete zone */}
        <button
          onClick={async () => {
            if (!confirm(`Delete zone "${zone.name}"?`)) return;
            setUpdating(true);
            try {
              await search.deleteZone(zone.id);
              onRefresh();
            } finally {
              setUpdating(false);
            }
          }}
          disabled={updating}
          className="px-2 py-1 bg-red-600/10 text-red-400 rounded hover:bg-red-600/20 disabled:opacity-50 ml-auto"
          title="Delete zone"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
