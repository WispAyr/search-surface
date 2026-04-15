"use client";

import { useState, useMemo } from "react";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation } from "@/types/search";
import {
  calculatePOD,
  suggestedSpacing,
  estimateSearchTime,
  ESW_TABLE,
} from "@/lib/podCalculator";
import { X, Calculator } from "lucide-react";

export function PODCalculator({ operation }: { operation: SearchOperation }) {
  const { togglePODCalculator } = useSearchStore();
  const [terrain, setTerrain] = useState("open_ground");
  const [subjectType, setSubjectType] = useState("responsive");
  const [targetPOD, setTargetPOD] = useState(0.7);
  const [areaWidth, setAreaWidth] = useState(500);
  const [teamSize, setTeamSize] = useState(4);

  const esw = ESW_TABLE[terrain]?.[subjectType] || 20;
  const spacing = suggestedSpacing(terrain, subjectType, targetPOD);
  const pod = calculatePOD(esw, spacing, 1);
  const timeEst = estimateSearchTime(areaWidth * areaWidth, spacing, teamSize);

  return (
    <div className="fixed bottom-4 right-[440px] z-[1000] w-[340px] bg-surface-800 border border-surface-600 rounded-xl shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Calculator size={16} className="text-accent" />
          POD Calculator
        </h3>
        <button onClick={togglePODCalculator} className="text-fg-4 hover:text-fg-1">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label className="block text-xs text-fg-4 mb-1">Terrain</label>
          <select
            value={terrain}
            onChange={(e) => setTerrain(e.target.value)}
            className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
          >
            {Object.keys(ESW_TABLE).map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-fg-4 mb-1">Subject type</label>
          <select
            value={subjectType}
            onChange={(e) => setSubjectType(e.target.value)}
            className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
          >
            <option value="responsive">Responsive (can call out)</option>
            <option value="unresponsive">Unresponsive</option>
            <option value="object">Object/Clue</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-fg-4 mb-1">
            Target POD: {Math.round(targetPOD * 100)}%
          </label>
          <input
            type="range"
            min={0.1}
            max={0.95}
            step={0.05}
            value={targetPOD}
            onChange={(e) => setTargetPOD(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-fg-4 mb-1">Area width (m)</label>
            <input
              type="number"
              value={areaWidth}
              onChange={(e) => setAreaWidth(parseInt(e.target.value) || 500)}
              className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-fg-4 mb-1">Team size</label>
            <input
              type="number"
              value={teamSize}
              onChange={(e) => setTeamSize(parseInt(e.target.value) || 4)}
              className="w-full px-3 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm"
            />
          </div>
        </div>

        {/* Results */}
        <div className="mt-4 p-3 bg-surface-700/50 rounded space-y-2">
          <h4 className="text-xs font-medium text-fg-4 uppercase">Results</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-fg-4 text-xs">ESW:</span>
              <div className="text-fg-1 font-medium">{esw}m</div>
            </div>
            <div>
              <span className="text-fg-4 text-xs">Spacing:</span>
              <div className="text-fg-1 font-medium">{spacing}m</div>
            </div>
            <div>
              <span className="text-fg-4 text-xs">Achievable POD:</span>
              <div className="text-accent font-medium">{Math.round(pod * 100)}%</div>
            </div>
            <div>
              <span className="text-fg-4 text-xs">Est. time:</span>
              <div className="text-fg-1 font-medium">{timeEst.minutes} min</div>
            </div>
            <div>
              <span className="text-fg-4 text-xs">Passes needed:</span>
              <div className="text-fg-1 font-medium">{timeEst.passes}</div>
            </div>
            <div>
              <span className="text-fg-4 text-xs">Searchers in line:</span>
              <div className="text-fg-1 font-medium">
                {Math.ceil(areaWidth / spacing)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
