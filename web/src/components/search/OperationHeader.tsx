"use client";

import { useState } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import { isTeamSilent, isTeamFatigued, SILENT_THRESHOLD_MIN, FATIGUE_THRESHOLD_MIN } from "@/lib/teamStatus";
import type { SearchOperation } from "@/types/search";
import {
  ArrowLeft,
  RefreshCw,
  Grid3X3,
  Calculator,
  Download,
  FileText,
  Play,
  Pause,
  Square,
  AlertTriangle,
  Shield,
  Users,
  Eye,
  Plane,
  MapPin,
  HelpCircle,
  Radar,
  Droplets,
  Clock,
} from "lucide-react";
import { HelpPanel } from "./HelpPanel";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  missing_person: <AlertTriangle size={16} className="text-red-400" />,
  security_sweep: <Shield size={16} className="text-amber-400" />,
  event_patrol: <Users size={16} className="text-blue-400" />,
  welfare_check: <Eye size={16} className="text-green-400" />,
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  active: "bg-green-500/20 text-green-300 border-green-500/30",
  suspended: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  completed: "bg-fg-4/20 text-fg-4 border-fg-4/30",
  stood_down: "bg-fg-4/20 text-fg-4 border-fg-4/30",
};

interface OperationHeaderProps {
  operation: SearchOperation;
  onBack: () => void;
  onRefresh: () => void;
}

export function OperationHeader({ operation, onBack, onRefresh }: OperationHeaderProps) {
  const {
    toggleGridGenerator, togglePODCalculator, toggleExportPanel, toggleSitrepPanel,
    toggleAirspace, showAirspace, setAddingDatum, setRightPanel, setMobilePanelOpen,
    showHazards, setShowHazards, setShowAttractors, hazardsHint,
  } = useSearchStore();
  const [statusLoading, setStatusLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleStatus = async (status: string) => {
    setStatusLoading(true);
    try {
      if (status === "active") {
        await search.activateOperation(operation.id);
      } else {
        await search.updateOperation(operation.id, { status });
      }
      onRefresh();
    } finally {
      setStatusLoading(false);
    }
  };

  const zones = operation.zones || [];
  const teams = operation.teams || [];
  const complete = zones.filter((z) => z.status === "complete").length;
  const inProgress = zones.filter((z) => z.status === "in_progress").length;
  const avgPOD =
    zones.length > 0
      ? zones.reduce((s, z) => s + (z.cumulative_pod || 0), 0) / zones.length
      : 0;
  const deployed = teams.filter((t) => t.status === "deployed").length;
  const silentTeams = teams.filter(isTeamSilent).length;
  const fatiguedTeams = teams.filter(isTeamFatigued).length;
  const subjectPhoto = operation.subject_info?.photo_url;

  return (
    <header className="border-b border-surface-700 bg-surface-800 px-4 py-2.5 flex items-center justify-between gap-4">
      {/* Left: back + name */}
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onBack} className="text-fg-4 hover:text-fg-1 transition shrink-0">
          <ArrowLeft size={18} />
        </button>
        {subjectPhoto && (
          <img
            src={subjectPhoto}
            alt={operation.subject_info?.name || "Subject"}
            className="w-8 h-8 rounded object-cover border border-surface-600 shrink-0"
            title={operation.subject_info?.name || "Subject"}
          />
        )}
        <div className="flex items-center gap-2 min-w-0">
          {TYPE_ICONS[operation.type]}
          <h1 className="font-semibold truncate">{operation.name}</h1>
          <span className={`px-2 py-0.5 rounded text-xs border ${STATUS_COLORS[operation.status]}`}>
            {operation.status}
          </span>
        </div>
      </div>

      {/* Center: stats strip — desktop only */}
      <div className="hidden lg:flex items-center gap-4 text-xs text-fg-3 shrink-0">
        <div>
          <span className="text-fg-4">Zones:</span>{" "}
          <span className="text-fg-1">{complete}/{zones.length}</span>{" "}
          <span className="text-fg-4">complete</span>
          {inProgress > 0 && (
            <span className="ml-1 text-amber-400">({inProgress} active)</span>
          )}
        </div>
        <div>
          <span className="text-fg-4">Avg POD:</span>{" "}
          <span className="text-fg-1">{Math.round(avgPOD * 100)}%</span>
        </div>
        <div>
          <span className="text-fg-4">Teams:</span>{" "}
          <span className="text-fg-1">{deployed}/{teams.length}</span>{" "}
          <span className="text-fg-4">deployed</span>
        </div>
        {silentTeams > 0 && (
          <button
            onClick={() => { setRightPanel("teams"); setMobilePanelOpen(true); }}
            className="flex items-center gap-1 px-2 py-0.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 rounded text-red-300 text-xs animate-pulse"
            title={`${silentTeams} team${silentTeams > 1 ? "s" : ""} silent > ${SILENT_THRESHOLD_MIN}min — open Teams`}
          >
            <AlertTriangle size={11} />
            {silentTeams} silent
          </button>
        )}
        {fatiguedTeams > 0 && (
          <button
            onClick={() => { setRightPanel("teams"); setMobilePanelOpen(true); }}
            className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 rounded text-amber-300 text-xs"
            title={`${fatiguedTeams} team${fatiguedTeams > 1 ? "s" : ""} deployed > ${FATIGUE_THRESHOLD_MIN / 60}h — consider rotation`}
          >
            <Clock size={11} />
            {fatiguedTeams} fatigued
          </button>
        )}
        {operation.subject_info?.name && (
          <div className="border-l border-surface-600 pl-4">
            <span className="text-fg-4">Subject:</span>{" "}
            <span className="text-red-300">{operation.subject_info.name}</span>
            {operation.subject_info.age && (
              <span className="text-fg-4">, {operation.subject_info.age}y</span>
            )}
          </div>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Status controls */}
        {operation.status === "planning" && (
          <button
            onClick={() => handleStatus("active")}
            disabled={statusLoading}
            className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-500 text-white rounded flex items-center gap-1.5 transition"
          >
            <Play size={12} /> Activate
          </button>
        )}
        {operation.status === "active" && (
          <button
            onClick={() => handleStatus("suspended")}
            disabled={statusLoading}
            className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded flex items-center gap-1.5 transition"
          >
            <Pause size={12} /> Suspend
          </button>
        )}
        {operation.status === "suspended" && (
          <button
            onClick={() => handleStatus("active")}
            disabled={statusLoading}
            className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-500 text-white rounded flex items-center gap-1.5 transition"
          >
            <Play size={12} /> Resume
          </button>
        )}
        {(operation.status === "active" || operation.status === "suspended") && (
          <button
            onClick={() => handleStatus("stood_down")}
            disabled={statusLoading}
            className="px-2.5 py-1.5 text-xs bg-surface-700 hover:bg-red-600/30 text-fg-3 hover:text-red-300 rounded transition"
          >
            <Square size={12} />
          </button>
        )}

        <div className="w-px h-6 bg-surface-600 mx-1" />

        {/* Tools */}
        <button
          onClick={() => {
            setAddingDatum(true);
            setRightPanel("datums");
            setMobilePanelOpen(false);
          }}
          className="p-1.5 text-fg-4 hover:text-accent transition"
          title="Add datum (click map after)"
        >
          <MapPin size={16} />
        </button>
        <button onClick={toggleAirspace} className={`p-1.5 transition ${showAirspace ? "text-accent" : "text-fg-4 hover:text-accent"}`} title="UK Airspace Restrictions">
          <Plane size={16} />
        </button>
        <button
          onClick={() => {
            const next = !showHazards;
            setShowHazards(next);
            // Mirror attractors so the toggle feels like one control; users
            // can still split them via the SAR Tools panel if they want.
            setShowAttractors(next);
          }}
          className={`p-1.5 transition relative ${showHazards ? "text-accent" : "text-fg-4 hover:text-accent"}`}
          title={hazardsHint || "Terrain & water hazards (OSM) — auto-loads for current map view"}
        >
          <Droplets size={16} />
          {showHazards && hazardsHint && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
          )}
        </button>
        <button
          onClick={() => { setRightPanel("sar"); setMobilePanelOpen(true); }}
          className="p-1.5 text-fg-4 hover:text-accent transition"
          title="SAR Tools — profiles, rings, hazards, street list, vehicle route"
        >
          <Radar size={16} />
        </button>
        <button
          onClick={toggleGridGenerator}
          className="flex items-center gap-1.5 px-2 py-1.5 bg-accent/10 hover:bg-accent/20 border border-accent/40 text-accent rounded text-xs font-medium transition"
          title="Plan a search pattern anchored to a datum"
        >
          <Grid3X3 size={14} />
          <span className="hidden md:inline">Plan Grid</span>
        </button>
        <button onClick={togglePODCalculator} className="p-1.5 text-fg-4 hover:text-accent transition" title="POD Calculator">
          <Calculator size={16} />
        </button>
        <button onClick={toggleSitrepPanel} className="p-1.5 text-fg-4 hover:text-accent transition" title="SITREP">
          <FileText size={16} />
        </button>
        <button onClick={toggleExportPanel} className="p-1.5 text-fg-4 hover:text-accent transition" title="Export">
          <Download size={16} />
        </button>
        <button onClick={onRefresh} className="p-1.5 text-fg-4 hover:text-accent transition" title="Refresh">
          <RefreshCw size={14} />
        </button>
        <button onClick={() => setShowHelp(true)} className="p-1.5 text-fg-4 hover:text-accent transition" title="Help & Guide">
          <HelpCircle size={16} />
        </button>
      </div>
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </header>
  );
}
