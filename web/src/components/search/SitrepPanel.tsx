"use client";

import { useEffect, useState } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import type { Sitrep } from "@/types/search";
import { X, FileText, RefreshCw, Copy, Check } from "lucide-react";

export function SitrepPanel({ operationId }: { operationId: string }) {
  const { toggleSitrepPanel, sitrep, setSitrep } = useSearchStore();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchSitrep = async () => {
    setLoading(true);
    try {
      const s = await search.getSitrep(operationId) as Sitrep;
      setSitrep(s);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchSitrep();
  }, [operationId]);

  const handleCopy = () => {
    if (!sitrep?.text) return;
    navigator.clipboard.writeText(sitrep.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed bottom-4 left-4 z-[1000] w-[500px] max-h-[70vh] bg-surface-800 border border-surface-600 rounded-xl shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700 shrink-0">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText size={16} className="text-accent" />
          SITREP
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={fetchSitrep} disabled={loading} className="text-fg-4 hover:text-accent transition">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={handleCopy} className="text-fg-4 hover:text-accent transition">
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
          <button onClick={toggleSitrepPanel} className="text-fg-4 hover:text-fg-1">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!sitrep ? (
          <p className="text-xs text-fg-4">Loading...</p>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              <StatBox label="Zones" value={`${sitrep.summary.complete}/${sitrep.summary.total_zones}`} sub="complete" />
              <StatBox label="Avg POD" value={`${Math.round(sitrep.summary.avg_pod * 100)}%`} />
              <StatBox label="Teams" value={`${sitrep.summary.deployed_teams}/${sitrep.summary.total_teams}`} sub="deployed" />
              <StatBox label="Clues" value={String(sitrep.summary.clue_count)} accent={sitrep.summary.clue_count > 0} />
            </div>

            {/* Full text */}
            <pre className="text-xs text-fg-3 font-mono whitespace-pre-wrap bg-surface-700/30 p-3 rounded border border-surface-700">
              {sitrep.text}
            </pre>

            <div className="mt-2 text-[10px] text-fg-4">
              Generated: {new Date(sitrep.generated_at).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="p-2 bg-surface-700/50 rounded text-center">
      <div className={`text-lg font-bold ${accent ? "text-red-400" : "text-fg-1"}`}>{value}</div>
      <div className="text-[10px] text-fg-4">{label}</div>
      {sub && <div className="text-[10px] text-fg-4">{sub}</div>}
    </div>
  );
}
