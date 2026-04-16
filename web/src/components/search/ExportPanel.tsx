"use client";

import { useState } from "react";
import { useSearchStore } from "@/stores/search";
import { search } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { SearchOperation } from "@/types/search";
import { X, Download, FileJson, Map, Globe, Printer, Link as LinkIcon, Check, Copy } from "lucide-react";

export function ExportPanel({ operation }: { operation: SearchOperation }) {
  const { toggleExportPanel } = useSearchStore();
  useEscapeKey(toggleExportPanel);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const makeShare = async () => {
    setShareLoading(true);
    setShareError(null);
    try {
      const { token } = await search.createShare(operation.id, 72);
      const url = `${window.location.origin}/brief/${token}`;
      setShareUrl(url);
      navigator.clipboard.writeText(url).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Share failed");
    } finally {
      setShareLoading(false);
    }
  };

  const printBriefing = async () => {
    // Create a 72h share token and open the brief in print mode. No backend
    // PDF library needed — the browser's Save-as-PDF gives clean output from
    // the @media print styles.
    setShareLoading(true);
    setShareError(null);
    try {
      const { token } = await search.createShare(operation.id, 72);
      window.open(`/brief/${token}?print=1`, "_blank", "noopener");
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Print failed");
    } finally {
      setShareLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-[440px] z-[1000] w-[320px] bg-surface-800 border border-surface-600 rounded-xl shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Download size={16} className="text-accent" />
          Export & Share
        </h3>
        <button onClick={toggleExportPanel} className="text-fg-4 hover:text-fg-1" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-2">
        <button
          onClick={printBriefing}
          disabled={shareLoading}
          className="w-full flex items-center gap-3 p-3 bg-surface-700 hover:bg-surface-600 rounded transition text-sm text-left disabled:opacity-50"
        >
          <Printer size={18} className="text-accent" />
          <div>
            <div className="font-medium">Print Briefing (PDF)</div>
            <div className="text-xs text-fg-4">SITREP + datums + zones, Save as PDF</div>
          </div>
        </button>

        <button
          onClick={makeShare}
          disabled={shareLoading}
          className="w-full flex items-center gap-3 p-3 bg-surface-700 hover:bg-surface-600 rounded transition text-sm text-left disabled:opacity-50"
        >
          {copied ? <Check size={18} className="text-green-400" /> : <LinkIcon size={18} className="text-blue-400" />}
          <div>
            <div className="font-medium">{copied ? "Link copied" : "Read-only Share Link"}</div>
            <div className="text-xs text-fg-4">{shareUrl ? "Valid 72h" : "Stakeholders / incoming units — no login"}</div>
          </div>
        </button>

        {shareUrl && (
          <div className="p-2 bg-surface-900 rounded border border-surface-700 flex items-center gap-2">
            <code className="text-[10px] text-fg-3 font-mono truncate flex-1">{shareUrl}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="text-fg-4 hover:text-accent"
              aria-label="Copy link"
            >
              <Copy size={12} />
            </button>
          </div>
        )}

        {shareError && <div className="text-[11px] text-red-400">{shareError}</div>}

        <div className="pt-2 border-t border-surface-700" />

        <a
          href={search.exportGeoJSON(operation.id)}
          target="_blank"
          className="flex items-center gap-3 p-3 bg-surface-700 hover:bg-surface-600 rounded transition text-sm"
        >
          <FileJson size={18} className="text-green-400" />
          <div>
            <div className="font-medium">GeoJSON</div>
            <div className="text-xs text-fg-4">Full zones + teams for web mapping</div>
          </div>
        </a>

        <a
          href={search.exportGPX(operation.id)}
          target="_blank"
          className="flex items-center gap-3 p-3 bg-surface-700 hover:bg-surface-600 rounded transition text-sm"
        >
          <Map size={18} className="text-blue-400" />
          <div>
            <div className="font-medium">GPX</div>
            <div className="text-xs text-fg-4">Waypoints for GPS devices</div>
          </div>
        </a>

        <a
          href={search.exportKML(operation.id)}
          target="_blank"
          className="flex items-center gap-3 p-3 bg-surface-700 hover:bg-surface-600 rounded transition text-sm"
        >
          <Globe size={18} className="text-amber-400" />
          <div>
            <div className="font-medium">KML</div>
            <div className="text-xs text-fg-4">Google Earth overlay</div>
          </div>
        </a>
      </div>
    </div>
  );
}
