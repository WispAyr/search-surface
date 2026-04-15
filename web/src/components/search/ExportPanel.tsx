"use client";

import { useSearchStore } from "@/stores/search";
import { search } from "@/lib/api";
import type { SearchOperation } from "@/types/search";
import { X, Download, FileJson, Map, Globe, FileText } from "lucide-react";

export function ExportPanel({ operation }: { operation: SearchOperation }) {
  const { toggleExportPanel } = useSearchStore();

  return (
    <div className="fixed bottom-4 right-[440px] z-[1000] w-[300px] bg-surface-800 border border-surface-600 rounded-xl shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Download size={16} className="text-accent" />
          Export
        </h3>
        <button onClick={toggleExportPanel} className="text-fg-4 hover:text-fg-1">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-2">
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
