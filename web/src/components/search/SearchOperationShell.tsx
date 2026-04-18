"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchStore } from "@/stores/search";
import { useSearchOperation } from "@/hooks/useSearchData";
import { useSearchStream } from "@/hooks/useSearchStream";
import { OperationHeader } from "./OperationHeader";
import { ZoneStatusBoard } from "./ZoneStatusBoard";
import { TeamTracker } from "./TeamTracker";
import { ReportsPanel } from "./ReportsPanel";
import { CommsLog } from "./CommsLog";
import { GridGenerator } from "./GridGenerator";
import { PODCalculator } from "./PODCalculator";
import { ExportPanel } from "./ExportPanel";
import { SitrepPanel } from "./SitrepPanel";
import { SearchConditions } from "./SearchConditions";
import { DatumsPanel } from "./DatumsPanel";
import { SarToolsPanel } from "./SarToolsPanel";
import { SubjectTimeline } from "./SubjectTimeline";
import { AlarmBar } from "./AlarmBar";
import { ConditionsStrip } from "./ConditionsStrip";
import { ZelloPanel } from "../ZelloPanel";
import { PanelRightOpen, Map as MapIcon } from "lucide-react";

const SearchMap = dynamic(() => import("./SearchMap").then((m) => m.SearchMap), {
  ssr: false,
});

interface SearchOperationShellProps {
  operationId: string;
}

export function SearchOperationShell({ operationId }: SearchOperationShellProps) {
  const router = useRouter();
  const {
    activeOperation,
    activeOperationLoading,
    rightPanel,
    showGridGenerator,
    showPODCalculator,
    showExportPanel,
    showSitrepPanel,
    setRightPanel,
    mobilePanelOpen,
    setMobilePanelOpen,
  } = useSearchStore();

  useSearchStream(operationId);
  const { refresh } = useSearchOperation(operationId);

  useEffect(() => {
    return () => {
      useSearchStore.getState().setActiveOperation(null);
    };
  }, []);

  if (activeOperationLoading && !activeOperation) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center text-fg-4 text-sm">
        Loading operation...
      </div>
    );
  }

  if (!activeOperation) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center text-fg-3 text-sm">
        Operation not found
      </div>
    );
  }

  const op = activeOperation;

  return (
    <div className="app-fullscreen h-screen flex flex-col bg-surface-900 text-fg-1 overflow-hidden">
      {/* Header bar — z-[1000] to sit above map */}
      <div className="relative z-[1000]">
      <OperationHeader
        operation={op}
        onBack={() => router.push("/")}
        onRefresh={refresh}
      />
      <ConditionsStrip operation={op} />
      <AlarmBar operation={op} />
      </div>

      {/* Main content: map + side panel */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Map — isolate stacking context so Leaflet z-indexes don't bleed over UI */}
        <div className="flex-1 relative isolate min-h-0">
          <SearchMap
            operation={op}
            onDatumSet={async (lat, lon) => {
              try {
                await import("@/lib/api").then(({ search }) =>
                  search.updateOperation(op.id, { datum_lat: lat, datum_lon: lon })
                );
                refresh();
              } catch {}
            }}
            onSecondaryDatumPick={(lat, lon) => {
              useSearchStore.getState().setPendingDatumPoint([lat, lon]);
              useSearchStore.getState().setRightPanel("datums");
              useSearchStore.getState().setMobilePanelOpen(true);
            }}
          />

          {/* Mobile-only FAB to open the side panel as an overlay */}
          <button
            onClick={() => setMobilePanelOpen(true)}
            className="md:hidden absolute top-3 right-3 z-[900] bg-surface-800/90 backdrop-blur border border-surface-600 text-fg-1 rounded-full p-2.5 shadow-lg"
            aria-label="Open operation panel"
          >
            <PanelRightOpen size={18} />
          </button>
        </div>

        {/* Right panel — desktop sidebar / mobile overlay drawer */}
        <div
          className={`${mobilePanelOpen ? "flex" : "hidden"} md:flex absolute md:relative inset-0 md:inset-auto w-full md:w-[420px] md:border-l border-surface-700 flex-col overflow-hidden z-[1100] md:z-[1000] bg-surface-900`}
        >
          {/* Panel tabs — horizontal scroll on narrow widths to avoid cramming */}
          <div className="flex border-b border-surface-700 text-xs overflow-x-auto scrollbar-thin">
            <button
              onClick={() => setMobilePanelOpen(false)}
              className="md:hidden shrink-0 px-3 py-2.5 text-fg-3 hover:text-fg-1 border-r border-surface-700"
              aria-label="Back to map"
            >
              <MapIcon size={14} />
            </button>
            {(["zones", "datums", "timeline", "sar", "reports", "comms", "zello", "teams", "conditions", "audit"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightPanel(tab)}
                className={`shrink-0 px-3 py-2.5 capitalize whitespace-nowrap transition ${
                  rightPanel === tab
                    ? "text-accent border-b-2 border-accent bg-surface-800"
                    : "text-fg-4 hover:text-fg-2"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto">
            {rightPanel === "zones" && <ZoneStatusBoard operation={op} onRefresh={refresh} />}
            {rightPanel === "datums" && <DatumsPanel operation={op} onRefresh={refresh} />}
            {rightPanel === "timeline" && <SubjectTimeline operation={op} />}
            {rightPanel === "sar" && <SarToolsPanel operation={op} />}
            {rightPanel === "reports" && <ReportsPanel operationId={op.id} />}
            {rightPanel === "comms" && <CommsLog operationId={op.id} />}
            {rightPanel === "zello" && <ZelloPanel operationId={op.id} persistToLog />}
            {rightPanel === "teams" && <TeamTracker operation={op} onRefresh={refresh} />}
            {rightPanel === "conditions" && <SearchConditions operation={op} />}
            {rightPanel === "audit" && <AuditPanel operationId={op.id} />}
          </div>
        </div>
      </div>

      {/* Floating panels */}
      {showGridGenerator && <GridGenerator operation={op} onRefresh={refresh} />}
      {showPODCalculator && <PODCalculator operation={op} />}
      {showExportPanel && <ExportPanel operation={op} />}
      {showSitrepPanel && <SitrepPanel operationId={op.id} recipients={op.sitrep_recipients || []} operationName={op.name} />}
    </div>
  );
}

// ── Inline audit panel (simple) ──
function AuditPanel({ operationId }: { operationId: string }) {
  const [entries, setEntries] = useState<any[]>([]);

  useEffect(() => {
    fetch(`/api/search/operations/${operationId}/audit`)
      .then((r) => r.json())
      .then((d) => setEntries(d.audit || []))
      .catch(() => {});
  }, [operationId]);

  return (
    <div className="p-3 space-y-1">
      <h3 className="text-xs font-medium text-fg-4 uppercase tracking-wider mb-2">Audit Trail</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-fg-4">No audit entries</p>
      ) : (
        entries.map((e: any) => (
          <div key={e.id} className="text-xs py-1.5 border-b border-surface-700/50">
            <div className="flex justify-between">
              <span className="text-fg-3 font-mono">{e.action}</span>
              <span className="text-fg-4">{new Date(e.created_at).toLocaleTimeString()}</span>
            </div>
            {e.detail && (
              <pre className="text-fg-4 mt-0.5 text-[10px] truncate">
                {JSON.stringify(e.detail)}
              </pre>
            )}
          </div>
        ))
      )}
    </div>
  );
}

