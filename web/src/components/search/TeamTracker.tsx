"use client";

import { useEffect, useMemo, useState } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import { isTeamSilent, isTeamFatigued, teamDeploymentMinutes, SILENT_THRESHOLD_MIN, FATIGUE_THRESHOLD_MIN } from "@/lib/teamStatus";
import type { SearchOperation, SearchTeam, PlatformType } from "@/types/search";
import { PLATFORM_TYPES, PLATFORM_LABEL } from "@/lib/capabilities";
import { Plus, MapPin, Clock, Copy, Radio, UserPlus, QrCode, AlertTriangle, ArrowUpDown, Timer, UserCheck, Users } from "lucide-react";

const STATUS_BADGE: Record<string, { bg: string; label: string }> = {
  standby: { bg: "bg-surface-600 text-fg-4", label: "Standby" },
  deployed: { bg: "bg-green-500/20 text-green-300", label: "Deployed" },
  returning: { bg: "bg-amber-500/20 text-amber-300", label: "Returning" },
  stood_down: { bg: "bg-red-500/20 text-red-300", label: "Stood Down" },
};

const STATUS_ORDER: Record<string, number> = { deployed: 0, returning: 1, standby: 2, stood_down: 3 };
type TeamSortKey = "status" | "name" | "last_seen";

export function TeamTracker({ operation, onRefresh }: { operation: SearchOperation; onRefresh?: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [sortKey, setSortKey] = useState<TeamSortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const rawTeams = operation.teams || [];
  const identityMode = operation.identity_mode || "prompt";

  const handleIdentityMode = async (mode: "team" | "prompt" | "required") => {
    if (mode === identityMode) return;
    setIdentityBusy(true);
    try {
      await search.updateOperation(operation.id, { identity_mode: mode });
      onRefresh?.();
    } finally {
      setIdentityBusy(false);
    }
  };

  const teams = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rawTeams].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "status") cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "last_seen") {
        const ta = a.last_position_at ? new Date(a.last_position_at).getTime() : 0;
        const tb = b.last_position_at ? new Date(b.last_position_at).getTime() : 0;
        cmp = ta - tb; // ascending = oldest first (most concerning)
      }
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return cmp * dir;
    });
  }, [rawTeams, sortKey, sortDir]);

  const toggleSort = (key: TeamSortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const silentCount = useMemo(() => rawTeams.filter(isTeamSilent).length, [rawTeams]);
  const fatiguedCount = useMemo(() => rawTeams.filter(isTeamFatigued).length, [rawTeams]);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-fg-4 uppercase tracking-wider">Teams</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRoster(!showRoster)}
            className={`text-xs flex items-center gap-1 transition ${showRoster ? "text-accent" : "text-fg-4 hover:text-fg-2"}`}
            title="Named-in roster across all teams"
          >
            <UserCheck size={12} /> Roster
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-xs text-accent hover:text-accent/80 flex items-center gap-1 transition"
          >
            <Plus size={12} /> Add Team
          </button>
        </div>
      </div>

      {/* Identity mode selector — controls whether the field page prompts for
          a searcher's name on first load. Changing this mid-op doesn't kick
          already-connected devices; they pick it up on the next poll. */}
      <div className="mb-3 px-2 py-1.5 rounded bg-surface-800 border border-surface-700">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-fg-4 mb-1">
          <Users size={10} /> Identity mode
        </div>
        <div className="flex gap-1">
          {(["team", "prompt", "required"] as const).map((m) => (
            <button
              key={m}
              onClick={() => handleIdentityMode(m)}
              disabled={identityBusy}
              className={`flex-1 px-2 py-1 text-[11px] rounded border transition ${
                identityMode === m
                  ? "bg-accent/20 border-accent/40 text-accent"
                  : "bg-surface-900 border-surface-700 text-fg-3 hover:border-surface-600"
              } ${identityBusy ? "opacity-60" : ""}`}
              title={
                m === "team"
                  ? "QR only — no member names. Fastest onboarding; every report is attributed to the team."
                  : m === "prompt"
                    ? "Device asks for a name on first load; searcher can skip to stay anonymous."
                    : "Every reporter must name in before posting. Anonymous posts are rejected."
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {showRoster && <OperationRoster operationId={operation.id} />}

      {silentCount > 0 && (
        <div className="mb-2 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-xs text-red-300">
          <AlertTriangle size={12} />
          <span>
            {silentCount} deployed team{silentCount > 1 ? "s" : ""} silent &gt; {SILENT_THRESHOLD_MIN}min — request checkin.
          </span>
        </div>
      )}
      {fatiguedCount > 0 && (
        <div className="mb-2 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-xs text-amber-300">
          <Timer size={12} />
          <span>
            {fatiguedCount} team{fatiguedCount > 1 ? "s" : ""} deployed &gt; {FATIGUE_THRESHOLD_MIN / 60}h — rotate or rest.
          </span>
        </div>
      )}

      {rawTeams.length > 1 && (
        <div className="mb-2 flex items-center gap-1 text-[10px]">
          <ArrowUpDown size={10} className="text-fg-4" />
          {(["status", "name", "last_seen"] as const).map((k) => (
            <button
              key={k}
              onClick={() => toggleSort(k)}
              className={`px-1.5 py-0.5 rounded uppercase tracking-wider ${
                sortKey === k ? "bg-accent/20 text-accent" : "text-fg-4 hover:text-fg-2"
              }`}
            >
              {k.replace(/_/g, " ")}
              {sortKey === k && <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>}
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTeamForm
          operationId={operation.id}
          onDone={() => { setShowCreate(false); onRefresh?.(); }}
        />
      )}

      {teams.length === 0 ? (
        <p className="text-xs text-fg-4 py-4 text-center">No teams yet</p>
      ) : (
        <div className="space-y-2">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamCard({ team }: { team: SearchTeam }) {
  const [showToken, setShowToken] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [updating, setUpdating] = useState(false);
  const { selectTeam, selectedTeamId } = useSearchStore();
  const isSelected = selectedTeamId === team.id;

  const handleStatus = async (status: string) => {
    setUpdating(true);
    try {
      await search.updateTeam(team.id, { status });
    } finally {
      setUpdating(false);
    }
  };

  const timeSincePosition = team.last_position_at
    ? Math.round((Date.now() - new Date(team.last_position_at).getTime()) / 60000)
    : null;
  const silent = isTeamSilent(team);
  const fatigued = isTeamFatigued(team);
  const deploymentMin = teamDeploymentMinutes(team);
  const deploymentLabel = deploymentMin != null
    ? deploymentMin >= 60 ? `${Math.floor(deploymentMin / 60)}h ${deploymentMin % 60}m` : `${deploymentMin}m`
    : null;

  return (
    <div
      className={`p-3 rounded border transition cursor-pointer ${
        isSelected
          ? "bg-accent/10 border-accent/30"
          : silent
            ? "bg-red-500/5 border-red-500/40 hover:border-red-500/60"
            : fatigued
              ? "bg-amber-500/5 border-amber-500/40 hover:border-amber-500/60"
              : "bg-surface-800 border-surface-700 hover:border-surface-600"
      }`}
      onClick={() => selectTeam(isSelected ? null : team.id)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
          <span className="font-medium text-sm">{team.name}</span>
          <span className="text-xs text-fg-4">({team.callsign})</span>
          {silent && (
            <span className="flex items-center gap-0.5 text-[10px] text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/40">
              <AlertTriangle size={10} /> SILENT
            </span>
          )}
          {fatigued && !silent && (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/40">
              <Timer size={10} /> FATIGUED
            </span>
          )}
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_BADGE[team.status].bg}`}>
          {STATUS_BADGE[team.status].label}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-fg-4 flex-wrap">
        <span className="flex items-center gap-1">
          <UserPlus size={10} /> {team.members?.length || 0} members
        </span>
        <span className="flex items-center gap-1">
          <Radio size={10} /> {team.capability}
        </span>
        {/* Smart-grid Tier A2. Inline <select> so IC can fix a missing/wrong
            platform_type without opening a separate edit form. Legacy teams
            (platform_type = null) render as "unset" with the same control. */}
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <span className="text-fg-4/80">platform:</span>
          <select
            value={team.platform_type || ""}
            onChange={async (e) => {
              setUpdating(true);
              try {
                await search.updateTeam(team.id, { platform_type: e.target.value || null });
              } finally {
                setUpdating(false);
              }
            }}
            disabled={updating}
            className="px-1 py-0.5 bg-surface-700 border border-surface-600 rounded text-[10px]"
            title="Platform type drives the zone-match warning."
          >
            <option value="">unset</option>
            {PLATFORM_TYPES.map((p) => (
              <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
            ))}
          </select>
        </span>
        {deploymentLabel && (
          <span className={`flex items-center gap-1 ${fatigued ? "text-amber-300 font-medium" : deploymentMin! > FATIGUE_THRESHOLD_MIN * 0.75 ? "text-amber-400" : ""}`}>
            <Timer size={10} /> {deploymentLabel} deployed
          </span>
        )}
        {team.last_lat ? (
          <span className="flex items-center gap-1">
            <MapPin size={10} />
            {team.last_lat.toFixed(4)}, {team.last_lon?.toFixed(4)}
            {timeSincePosition !== null && (
              <span className={silent ? "text-red-400 font-medium" : timeSincePosition > 10 ? "text-amber-400" : ""}>
                ({timeSincePosition}m ago)
              </span>
            )}
          </span>
        ) : team.status === "deployed" ? (
          <span className="flex items-center gap-1 text-red-400">
            <MapPin size={10} /> No checkin yet
          </span>
        ) : null}
      </div>

      {/* Token & actions */}
      <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {team.status === "standby" && (
          <button
            onClick={() => handleStatus("deployed")}
            disabled={updating}
            className="px-2 py-1 text-[10px] bg-green-600/20 text-green-300 rounded hover:bg-green-600/30"
          >
            Deploy
          </button>
        )}
        {team.status === "deployed" && (
          <button
            onClick={() => handleStatus("returning")}
            disabled={updating}
            className="px-2 py-1 text-[10px] bg-amber-600/20 text-amber-300 rounded hover:bg-amber-600/30"
          >
            Recall
          </button>
        )}

        <button
          onClick={() => setShowToken(!showToken)}
          className="px-2 py-1 text-[10px] bg-surface-700 text-fg-4 rounded hover:text-fg-2"
        >
          {showToken ? "Hide" : "Token"}
        </button>

        <button
          onClick={() => setShowQR(!showQR)}
          className="px-2 py-1 text-[10px] bg-surface-700 text-fg-4 rounded hover:text-fg-2"
        >
          <QrCode size={10} />
        </button>

        {showToken && (
          <div className="flex items-center gap-1">
            <code className="text-[10px] text-accent font-mono truncate max-w-[120px]">
              {team.token}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(
                `${window.location.origin}/field/${team.token}`
              )}
              className="text-fg-4 hover:text-accent"
              title="Copy field app URL"
            >
              <Copy size={10} />
            </button>
          </div>
        )}
      </div>

      {/* QR Code */}
      {showQR && (
        <div className="mt-2 p-3 bg-white rounded text-center" onClick={(e) => e.stopPropagation()}>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${typeof window !== 'undefined' ? window.location.origin : ''}/field/${team.token}`)}`}
            alt="QR Code"
            className="mx-auto w-40 h-40"
          />
          <p className="text-[10px] text-gray-600 mt-2 break-all">
            {typeof window !== 'undefined' ? window.location.origin : ''}/field/{team.token.slice(0, 8)}...
          </p>
        </div>
      )}
    </div>
  );
}

function CreateTeamForm({ operationId, onDone }: { operationId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [callsign, setCallsign] = useState("");
  const [capability, setCapability] = useState("foot");
  // Smart-grid Tier A2. Defaulted to ground so the terrain guard can do
  // something useful out of the box, but "" is a valid choice (stored as
  // null) for legacy/air-gap cases.
  const [platformType, setPlatformType] = useState<PlatformType | "">("ground");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await search.createTeam(operationId, {
        name,
        callsign: callsign || name,
        capability,
        platform_type: platformType || null,
      });
      onDone();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-3 p-3 bg-surface-800 border border-surface-700 rounded space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Team name (e.g. Alpha)"
        className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
        autoFocus
      />
      <div className="flex gap-2">
        <input
          value={callsign}
          onChange={(e) => setCallsign(e.target.value)}
          placeholder="Callsign"
          className="flex-1 px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
        />
        <select
          value={capability}
          onChange={(e) => setCapability(e.target.value)}
          className="px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
        >
          <option value="foot">Foot</option>
          <option value="vehicle">Vehicle</option>
          <option value="drone">Drone</option>
          <option value="k9">K9</option>
          <option value="water">Water</option>
        </select>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-fg-4 uppercase tracking-wider">Platform type</span>
        <select
          value={platformType}
          onChange={(e) => setPlatformType(e.target.value as PlatformType | "")}
          className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
          title="Drives the zone-match warning when assigning this team to a zone."
        >
          <option value="">— unset —</option>
          {PLATFORM_TYPES.map((p) => (
            <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="px-2 py-1 text-xs text-fg-4">Cancel</button>
        <button onClick={handleCreate} disabled={loading || !name.trim()} className="px-3 py-1 text-xs bg-accent text-black rounded disabled:opacity-50">
          Create
        </button>
      </div>
    </div>
  );
}

// Named-in roster for the whole operation. Polls the same cadence as the op
// refresh so a newly-identified searcher surfaces within ~5s. Silent when the
// op has zero named members (which is the norm in team mode).
function OperationRoster({ operationId }: { operationId: string }) {
  const [members, setMembers] = useState<Array<{ id: string; team_id: string; name: string; created_at: string; last_seen_at: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await search.listOperationMembers(operationId);
        if (!cancelled) { setMembers(res.members || []); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [operationId]);

  if (error) {
    return (
      <div className="mb-3 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
        Roster: {error}
      </div>
    );
  }

  return (
    <div className="mb-3 p-2 rounded bg-surface-800 border border-surface-700">
      <div className="text-[10px] uppercase tracking-wider text-fg-4 mb-1 flex items-center gap-1">
        <UserCheck size={10} /> Named-in ({members.length})
      </div>
      {members.length === 0 ? (
        <p className="text-[11px] text-fg-4">No searchers have named in yet.</p>
      ) : (
        <ul className="space-y-0.5 max-h-40 overflow-y-auto">
          {members.map((m) => {
            const last = m.last_seen_at ? new Date(m.last_seen_at).getTime() : null;
            const mins = last ? Math.round((Date.now() - last) / 60000) : null;
            return (
              <li key={m.id} className="flex items-center justify-between text-[11px]">
                <span className="truncate text-fg-2">{m.name}</span>
                <span className="text-fg-4 font-mono shrink-0">
                  {mins === null ? "—" : mins < 1 ? "now" : `${mins}m`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
