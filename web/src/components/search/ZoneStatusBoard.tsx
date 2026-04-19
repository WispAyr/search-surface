"use client";

import { useMemo, useState } from "react";
import { search, searchHelpers } from "@/lib/api";
import bboxFn from "@turf/bbox";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation, SearchZone, SearchTeam } from "@/types/search";
import { matchScore, matchWarning, matchTier, PLATFORM_LABEL } from "@/lib/capabilities";
import { processTerrain } from "@/lib/terrainClassifier";
import { nextSearchableWindow, formatWindowStatus, TIDE_STATE_FILL } from "@/lib/tideWindows";
import { GAUGE_TREND_FILL } from "@/lib/riverGauges";
import { splitOnShoreline, isSplittable } from "@/lib/shorelineSplit";
import { estimateZonePOD, podAfterPasses } from "@/lib/zonePodEstimator";
import { ChevronDown, ChevronUp, MapPin, Users, Check, Pause, Trash2, Download, Plane, Clock, ArrowUpDown, Filter, AlertTriangle, Scissors, Loader2, Activity, Target } from "lucide-react";

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
                      {/* Assignment build-in-flight. The server fires
                          buildTeamAssignment via setImmediate after a PATCH to
                          zone.assigned_team_id; until it writes back we see the
                          team assigned here but its assigned_zone_id still lags
                          — show a spinner so the controller doesn't think it's
                          stuck. Flips off when the SSE team_assigned event
                          lands with the updated assigned_zone_id. */}
                      {team.assigned_zone_id !== z.id && (
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-300">
                          <Loader2 size={10} className="animate-spin" />
                          Building route…
                        </span>
                      )}
                      {/* Street-clear progress — populated async after assignment */}
                      {team.assigned_zone_id === z.id && team.street_checklist && team.street_checklist.length > 0 && (() => {
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
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Local POD state so the slider/input stays responsive while the server
  // round-trips. Reset on debounce-committed save.
  const [podDraft, setPodDraft] = useState<number>(Math.round((zone.cumulative_pod || 0) * 100));
  // Try-on team for the Expected POD chip when no team is assigned yet —
  // lets the IC preview "what would this zone achieve if I sent Alpha?" during
  // grid planning without actually committing the assignment.
  const [previewTeamId, setPreviewTeamId] = useState<string | null>(null);
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

  // ── Smart-grid Tier A3 — shoreline split ──
  //
  // Re-fetch terrain for a tight bbox around just this zone (cheaper than
  // re-using the op-wide cache), re-run the classifier/split client-side,
  // then POST two new zones + DELETE the parent. If either half fails to
  // create we don't auto-rollback — let the operator see the state and
  // decide. Over-engineering a transactional split here is not worth it
  // for a 1-in-N action.
  const handleSplit = async () => {
    setSplitError(null);
    setSplitting(true);
    try {
      const geom = zone.geometry as GeoJSON.Feature;
      if (!geom?.geometry) throw new Error("Zone has no geometry");
      const bb = bboxFn(geom);
      const bbox: [number, number, number, number] = [bb[0], bb[1], bb[2], bb[3]];
      const raw = await searchHelpers.osmTerrain(bbox);
      const processed = processTerrain(raw);
      const result = splitOnShoreline(zone, processed);
      if (!result) {
        setSplitError("Cannot split: zone has no usable geometry.");
        return;
      }
      if (!result.children.length) {
        setSplitError(result.reason || "No shoreline crosses this zone.");
        return;
      }
      // Inherit search_method + priority from the parent; reset sweep_count
      // on the children (server does that by default since it's not passed).
      const opId = zone.operation_id;
      for (const child of result.children) {
        await search.createZone(opId, {
          name: child.name,
          geometry: child.geometry,
          search_method: zone.search_method,
          priority: zone.priority,
          spacing_m: zone.spacing_m,
          notes: zone.notes,
          poa: child.poa,
          cumulative_pod: child.cumulative_pod,
          terrain_class: child.terrain_class,
          terrain_composition: child.terrain_composition,
        });
      }
      await search.deleteZone(zone.id);
      onRefresh();
    } catch (err: any) {
      setSplitError(err?.message || "Split failed");
    } finally {
      setSplitting(false);
    }
  };

  const splittable = isSplittable(zone);

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

      {/* Smart-grid Tier A4 — Expected POD estimate from terrain + team +
          sweep-width table. Three render paths:
          1. Zone has an assigned team → compare its cumulative against the
             textbook floor for the passes logged. Apply button bridges a gap.
          2. Zone is unassigned but the op has teams with viable presets →
             "try-on" picker so IC can preview POD per candidate team during
             grid planning. No Apply button (no sweep context yet).
          3. Op has no team, or no team in the op has a viable preset for the
             zone's terrain → placeholder explaining what's missing. */}
      {(() => {
        const assigned = zone.assigned_team_id ? teams.find((t) => t.id === zone.assigned_team_id) : null;
        if (assigned) {
          const est = estimateZonePOD(zone, assigned);
          if (!est) return null; // Team assigned but terrain/platform mismatch — rare.
          // Use sweep_count so we compare zone.cumulative_pod against the floor
          // for *actual* passes logged. Pre-sweep we show the single-pass target.
          const passesDone = Math.max(0, zone.sweep_count || 0);
          const passesForExpected = passesDone > 0 ? passesDone : 1;
          const expected = podAfterPasses(est, passesForExpected);
          const nextPass = podAfterPasses(est, passesForExpected + 1);
          const expectedPct = Math.round(expected * 100);
          const nextPct = Math.round(nextPass * 100);
          // Compare against cumulative_pod — that's what the slider sets and
          // what the server maintains Bayesian-combined across passes.
          const recordedPct = Math.round((zone.cumulative_pod || 0) * 100);
          const gap = recordedPct - expectedPct;
          const label = passesDone > 0
            ? `Expected after ${passesDone} pass${passesDone === 1 ? "" : "es"}`
            : "Planning target (1 pass)";
          // Hint + Apply button only make sense once a sweep has actually run.
          // Before any pass the zone is "planned" — the gap between 0% recorded
          // and the 63% one-pass floor is trivially true and not actionable.
          const hint = passesDone > 0
            ? (gap >= 20
                ? `recorded ${recordedPct}% is ${gap} pp above the textbook floor — confirm sweep quality`
                : gap <= -20
                  ? `recorded ${recordedPct}% is ${Math.abs(gap)} pp below the textbook floor — another pass could reach ${nextPct}%`
                  : null)
            : null;
          const canApply = passesDone > 0 && recordedPct !== expectedPct;
          return (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded border text-[11px] bg-blue-500/5 border-blue-500/30 text-blue-200">
              <Target size={12} className="mt-0.5 shrink-0" />
              <div className="space-y-0.5 flex-1 min-w-0">
                <div>
                  {label}: <span className="font-semibold">{expectedPct}%</span>
                  <span className="text-fg-4"> · +1 pass {nextPct}%</span>
                </div>
                <div className="text-[10px] text-fg-4 truncate" title={est.rationale}>{est.rationale}</div>
                {hint && <div className="text-[10px] text-amber-300">{hint}</div>}
                {canApply && (
                  <button
                    type="button"
                    onClick={() => handleUpdate({ cumulative_pod: expected })}
                    disabled={updating}
                    className="text-[10px] text-accent hover:underline disabled:opacity-50"
                  >
                    Apply {expectedPct}% to recorded POD
                  </button>
                )}
              </div>
            </div>
          );
        }
        // Unassigned path. Build list of teams whose platform + zone terrain
        // yield a valid estimate. If that list is empty we fall through to a
        // placeholder explaining what's missing.
        const viableTeams = teams
          .map((t) => ({ team: t, est: estimateZonePOD(zone, t) }))
          .filter((x): x is { team: typeof x.team; est: NonNullable<typeof x.est> } => !!x.est);
        if (viableTeams.length === 0) {
          const why = teams.length === 0
            ? "No teams configured for this operation yet."
            : `No team in this operation has a sweep preset for ${zone.terrain_class || "this"} terrain.`;
          return (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded border text-[11px] bg-surface-700/30 border-surface-600 text-fg-3">
              <Target size={12} className="mt-0.5 shrink-0" />
              <div>{why} Expected POD will appear once a compatible team is assigned.</div>
            </div>
          );
        }
        // Pick preview team: IC's explicit choice, else first viable. Fall
        // back to first viable if the stale previewTeamId no longer matches
        // any viable team (e.g. team list changed).
        const chosen = viableTeams.find((x) => x.team.id === previewTeamId) || viableTeams[0];
        const est = chosen.est;
        const expected = podAfterPasses(est, 1);
        const nextPass = podAfterPasses(est, 2);
        const expectedPct = Math.round(expected * 100);
        const nextPct = Math.round(nextPass * 100);
        return (
          <div className="flex items-start gap-1.5 px-2 py-1.5 rounded border text-[11px] bg-blue-500/5 border-blue-500/30 text-blue-200">
            <Target size={12} className="mt-0.5 shrink-0" />
            <div className="space-y-0.5 flex-1 min-w-0">
              <div>
                Planning preview (1 pass): <span className="font-semibold">{expectedPct}%</span>
                <span className="text-fg-4"> · +1 pass {nextPct}%</span>
              </div>
              <div className="text-[10px] text-fg-4 truncate" title={est.rationale}>{est.rationale}</div>
              <div className="flex items-center gap-1.5 pt-0.5">
                <label className="text-[10px] text-fg-4">Try on:</label>
                <select
                  value={chosen.team.id}
                  onChange={(e) => setPreviewTeamId(e.target.value)}
                  disabled={updating}
                  className="text-[10px] bg-surface-700 border border-surface-600 rounded px-1 py-0.5 text-fg-1 max-w-[140px]"
                >
                  {viableTeams.map(({ team }) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.callsign})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleUpdate({ assigned_team_id: chosen.team.id })}
                  disabled={updating}
                  className="text-[10px] text-accent hover:underline disabled:opacity-50"
                >
                  Assign {chosen.team.callsign}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* Smart-grid Tier B2. Tide-window badge for intertidal zones. Colour
          pulls from TIDE_STATE_FILL so green = go now, amber = wait,
          grey = off-forecast. Hidden when there are no windows at all. */}
      {(() => {
        const sw = zone.searchable_windows;
        if (!sw || sw.source === "unavailable" || sw.windows.length === 0) return null;
        const status = nextSearchableWindow(sw.windows);
        const colour = TIDE_STATE_FILL[status.state];
        return (
          <div
            className="flex items-start gap-1.5 px-2 py-1.5 rounded border text-[11px]"
            style={{
              backgroundColor: `${colour}1a`,
              borderColor: `${colour}66`,
              color: colour,
            }}
          >
            <Clock size={12} className="mt-0.5 shrink-0" />
            <span>{formatWindowStatus(status)}</span>
          </div>
        );
      })()}

      {/* Smart-grid Tier B3. Gauge snapshot chip for river-corridor zones.
          Frozen at plan time (pulled from corridor_metadata.gauge_ref) so the
          chip tells the operator what the water was doing when they drew
          this corridor, not what it reads now. */}
      {(() => {
        const meta = (zone.geometry?.properties as any)?.corridor_metadata
          ?? zone.corridor_metadata;
        if (!meta || meta.kind !== "parent" || !meta.gauge_ref) return null;
        const ref = meta.gauge_ref;
        if (ref.stage_m == null) return null;
        const colour = GAUGE_TREND_FILL[ref.trend as keyof typeof GAUGE_TREND_FILL] ?? GAUGE_TREND_FILL.unknown;
        const km = ref.distance_m < 1000
          ? `${Math.round(ref.distance_m)} m`
          : `${(ref.distance_m / 1000).toFixed(1)} km`;
        return (
          <div
            className="flex items-start gap-1.5 px-2 py-1.5 rounded border text-[11px]"
            style={{
              backgroundColor: `${colour}1a`,
              borderColor: `${colour}66`,
              color: colour,
            }}
            title={`observed ${new Date(ref.observed_at).toLocaleString()}`}
          >
            <Activity size={12} className="mt-0.5 shrink-0" />
            <span>
              Gauge: {ref.stage_m.toFixed(2)} m · {ref.trend} · {ref.label} ({ref.source}) · {km}
            </span>
          </div>
        );
      })()}

      {/* Smart-grid Tier A2. If the zone has terrain_composition AND the
          currently-assigned team has a platform_type, show a match chip
          (red/amber/hidden). On the team-picker itself we annotate each
          option with the tier symbol so the IC can eyeball which teams
          fit before selecting. */}
      {(() => {
        const comp = zone.terrain_composition;
        const assigned = zone.assigned_team_id ? teams.find((t) => t.id === zone.assigned_team_id) : null;
        if (!comp || !assigned || !assigned.platform_type) return null;
        const warn = matchWarning(assigned.platform_type, comp);
        if (!warn) return null;
        const isBad = warn.tier === "bad";
        return (
          <div
            className={`flex items-start gap-1.5 px-2 py-1.5 rounded border text-[11px] ${
              isBad
                ? "bg-red-500/10 border-red-500/40 text-red-300"
                : "bg-amber-500/10 border-amber-500/40 text-amber-300"
            }`}
          >
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>{warn.text}</span>
          </div>
        );
      })()}

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
                {teams.map((t) => {
                  // Annotate option label with match symbol so the IC can
                  // see fit before committing. ✕ = bad (<0.4), ⚠ = weak
                  // (<0.6), blank = ok or unknown.
                  const tier = matchTier(matchScore(t.platform_type, zone.terrain_composition));
                  const mark = tier === "bad" ? " ✕" : tier === "weak" ? " ⚠" : "";
                  return (
                    <option key={t.id} value={t.id}>{t.name} ({t.callsign}){mark}</option>
                  );
                })}
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

        {/* Smart-grid Tier A3. Offered only when the classifier labelled
            the zone "mixed" (no class ≥ 70%). Replaces the parent with
            two re-classified children. */}
        {splittable && zone.status !== "complete" && (
          <button
            onClick={handleSplit}
            disabled={updating || splitting}
            className="px-2 py-1 bg-purple-600/10 text-purple-300 rounded hover:bg-purple-600/20 disabled:opacity-50 flex items-center gap-1 ml-auto"
            title="Split this mixed zone into land + water halves on the shoreline."
          >
            {splitting ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />}
            <span className="text-[11px]">Split</span>
          </button>
        )}

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
          className={`px-2 py-1 bg-red-600/10 text-red-400 rounded hover:bg-red-600/20 disabled:opacity-50 ${splittable && zone.status !== "complete" ? "" : "ml-auto"}`}
          title="Delete zone"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {splitError && (
        <div className="text-[10px] text-red-400">{splitError}</div>
      )}
    </div>
  );
}
