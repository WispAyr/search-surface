"use client";

import { useState } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation, SearchTeam } from "@/types/search";
import { Plus, MapPin, Clock, Copy, Radio, UserPlus, QrCode } from "lucide-react";

const STATUS_BADGE: Record<string, { bg: string; label: string }> = {
  standby: { bg: "bg-surface-600 text-fg-4", label: "Standby" },
  deployed: { bg: "bg-green-500/20 text-green-300", label: "Deployed" },
  returning: { bg: "bg-amber-500/20 text-amber-300", label: "Returning" },
  stood_down: { bg: "bg-red-500/20 text-red-300", label: "Stood Down" },
};

export function TeamTracker({ operation, onRefresh }: { operation: SearchOperation; onRefresh?: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const teams = operation.teams || [];

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-fg-4 uppercase tracking-wider">Teams</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs text-accent hover:text-accent/80 flex items-center gap-1 transition"
        >
          <Plus size={12} /> Add Team
        </button>
      </div>

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

  return (
    <div
      className={`p-3 rounded border transition cursor-pointer ${
        isSelected
          ? "bg-accent/10 border-accent/30"
          : "bg-surface-800 border-surface-700 hover:border-surface-600"
      }`}
      onClick={() => selectTeam(isSelected ? null : team.id)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
          <span className="font-medium text-sm">{team.name}</span>
          <span className="text-xs text-fg-4">({team.callsign})</span>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_BADGE[team.status].bg}`}>
          {STATUS_BADGE[team.status].label}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-fg-4">
        <span className="flex items-center gap-1">
          <UserPlus size={10} /> {team.members?.length || 0} members
        </span>
        <span className="flex items-center gap-1">
          <Radio size={10} /> {team.capability}
        </span>
        {team.last_lat && (
          <span className="flex items-center gap-1">
            <MapPin size={10} />
            {team.last_lat.toFixed(4)}, {team.last_lon?.toFixed(4)}
            {timeSincePosition !== null && (
              <span className={timeSincePosition > 30 ? "text-red-400" : ""}>
                ({timeSincePosition}m ago)
              </span>
            )}
          </span>
        )}
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
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await search.createTeam(operationId, { name, callsign: callsign || name, capability });
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
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="px-2 py-1 text-xs text-fg-4">Cancel</button>
        <button onClick={handleCreate} disabled={loading || !name.trim()} className="px-3 py-1 text-xs bg-accent text-black rounded disabled:opacity-50">
          Create
        </button>
      </div>
    </div>
  );
}
