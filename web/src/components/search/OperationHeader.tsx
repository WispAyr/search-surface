"use client";

import { useEffect, useState } from "react";
import { search, siphon, prism } from "@/lib/api";
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
  Wind,
  Thermometer,
  Droplets,
  Clock,
} from "lucide-react";
import { HelpPanel } from "./HelpPanel";

const WIND_DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const windDirLabel = (deg: number) => WIND_DIRS[Math.round(deg / 22.5) % 16];

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
  const [wx, setWx] = useState<{ metar: any; storm: any } | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [metar, storm] = await Promise.allSettled([
          siphon.metar("EGPK"),
          prism.stormWatch("ayrshire"),
        ]);
        if (!mounted) return;
        setWx({
          metar: metar.status === "fulfilled" ? (metar.value as any)?.data || metar.value : null,
          storm: storm.status === "fulfilled" ? (storm.value as any)?.data || storm.value : null,
        });
      } catch {}
    }
    load();
    const iv = setInterval(load, 120000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

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
        <WeatherChip wx={wx} onClick={() => { setRightPanel("conditions"); setMobilePanelOpen(true); }} />
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
        <button onClick={toggleGridGenerator} className="p-1.5 text-fg-4 hover:text-accent transition" title="Grid Generator">
          <Grid3X3 size={16} />
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

function WeatherChip({ wx, onClick }: { wx: { metar: any; storm: any } | null; onClick: () => void }) {
  if (!wx?.metar && !wx?.storm) return null;
  const m = wx.metar || {};
  const s = wx.storm || {};
  const wind = typeof m.wind_speed === "number" ? `${windDirLabel(m.wind_direction)} ${Math.round(m.wind_speed)}${m.wind_unit || "kt"}` : null;
  const gust = typeof m.wind_gust === "number" ? m.wind_gust : null;
  const temp = typeof m.temperature_c === "number" ? `${Math.round(m.temperature_c)}°` : null;
  const vis = typeof m.visibility_m === "number" ? (m.visibility_m >= 10000 ? "10km+" : m.visibility_m >= 1000 ? `${(m.visibility_m / 1000).toFixed(1)}km` : `${m.visibility_m}m`) : null;

  // Storm score colour: 0-0.3 green, 0.3-0.6 amber, >0.6 red
  const score = typeof s.score === "number" ? s.score : null;
  const stormCls = score == null ? "" : score >= 0.6 ? "border-red-500/50 bg-red-500/10" : score >= 0.3 ? "border-amber-500/50 bg-amber-500/10" : "";
  const windAlert = gust != null && gust > 35 ? "text-red-300" : (typeof m.wind_speed === "number" && m.wind_speed > 25) ? "text-amber-300" : "text-fg-1";

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1 rounded border border-surface-600 hover:border-accent/50 transition ${stormCls}`}
      title={s.descriptor ? `${s.verdict}: ${s.descriptor}` : "Open conditions panel"}
    >
      {wind && (
        <span className={`flex items-center gap-1 ${windAlert}`}>
          <Wind size={11} />
          {wind}{gust ? `g${Math.round(gust)}` : ""}
        </span>
      )}
      {temp && (
        <span className="flex items-center gap-1 text-fg-2 border-l border-surface-600 pl-2">
          <Thermometer size={11} />{temp}
        </span>
      )}
      {vis && (
        <span className="flex items-center gap-1 text-fg-3 border-l border-surface-600 pl-2">
          <Eye size={11} />{vis}
        </span>
      )}
      {score != null && score >= 0.3 && (
        <span className="flex items-center gap-1 text-amber-300 border-l border-surface-600 pl-2">
          <AlertTriangle size={11} />{s.verdict || "watch"}
        </span>
      )}
    </button>
  );
}
