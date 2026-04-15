"use client";

import { useEffect, useState } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import type { SearchOperation, SearchDatum, DatumKind } from "@/types/search";
import { MapPin, Plus, Trash2, Target } from "lucide-react";

const KIND_OPTIONS: { value: DatumKind; label: string; color: string }[] = [
  { value: "lkp", label: "LKP — Last Known Position", color: "#ef4444" },
  { value: "plp", label: "PLP — Possible Location", color: "#f59e0b" },
  { value: "sighting", label: "Sighting", color: "#3b82f6" },
  { value: "witness", label: "Witness location", color: "#8b5cf6" },
  { value: "other", label: "Other", color: "#64748b" },
];

interface DatumsPanelProps {
  operation: SearchOperation;
  onRefresh?: () => void | Promise<void>;
}

export function DatumsPanel({ operation, onRefresh }: DatumsPanelProps) {
  const {
    addingDatum,
    setAddingDatum,
    gridDatumId,
    setGridDatumId,
    pendingDatumPoint,
    setPendingDatumPoint,
  } = useSearchStore();

  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<DatumKind>("lkp");
  const [notes, setNotes] = useState("");

  // When a point gets picked from the map, prefill the form
  useEffect(() => {
    if (pendingDatumPoint && !label) {
      const defaults: Record<DatumKind, string> = {
        lkp: "Last known position",
        plp: "Possible location",
        sighting: "Sighting",
        witness: "Witness location",
        other: "Datum",
      };
      setLabel(defaults[kind]);
    }
  }, [pendingDatumPoint, kind, label]);

  const handleSave = async () => {
    if (!pendingDatumPoint) return;
    const [lat, lon] = pendingDatumPoint;
    try {
      await search.createDatum(operation.id, { label: label || "Datum", kind, lat, lon, notes: notes || undefined });
      setPendingDatumPoint(null);
      setLabel("");
      setNotes("");
      setKind("lkp");
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error("Create datum failed", err);
    }
  };

  const handleCancel = () => {
    setPendingDatumPoint(null);
    setLabel("");
    setNotes("");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this datum?")) return;
    try {
      await search.deleteDatum(id);
      if (gridDatumId === id) setGridDatumId(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error("Delete datum failed", err);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-fg-4 uppercase tracking-wider">Datums</h3>
        <button
          onClick={() => setAddingDatum(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20"
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {addingDatum && !pendingDatumPoint && (
        <div className="p-2 bg-amber-600/10 border border-amber-600/30 rounded text-xs text-amber-300">
          Click on the map to drop a datum…{" "}
          <button onClick={() => setAddingDatum(false)} className="underline">cancel</button>
        </div>
      )}

      {/* Datum form (shown after map click) */}
      {pendingDatumPoint && (
        <div className="p-3 bg-surface-800 border border-surface-600 rounded space-y-2">
          <div className="text-xs text-fg-3">
            {pendingDatumPoint[0].toFixed(5)}, {pendingDatumPoint[1].toFixed(5)}
          </div>
          <div>
            <label className="block text-[10px] text-fg-4 mb-1 uppercase tracking-wider">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as DatumKind)}
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-fg-4 mb-1 uppercase tracking-wider">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. House, Local park, Bus stop"
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[10px] text-fg-4 mb-1 uppercase tracking-wider">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCancel} className="flex-1 px-2 py-1.5 bg-surface-700 text-xs rounded">
              Cancel
            </button>
            <button onClick={handleSave} className="flex-1 px-2 py-1.5 bg-accent text-black text-xs rounded font-medium">
              Save datum
            </button>
          </div>
        </div>
      )}

      {/* Primary datum row */}
      {operation.datum_lat && operation.datum_lon ? (
        <DatumRow
          selected={gridDatumId === null}
          onSelect={() => setGridDatumId(null)}
          color="#ef4444"
          badge="PRIMARY"
          label="Primary datum"
          lat={operation.datum_lat}
          lon={operation.datum_lon}
        />
      ) : (
        <div className="p-2 bg-surface-800/60 border border-dashed border-surface-600 rounded text-xs text-fg-4">
          No primary datum set. Use the datum button in the header to place one.
        </div>
      )}

      {/* Secondary datums */}
      {(operation.datums || []).map((d: SearchDatum) => {
        const opt = KIND_OPTIONS.find((o) => o.value === d.kind);
        return (
          <DatumRow
            key={d.id}
            selected={gridDatumId === d.id}
            onSelect={() => setGridDatumId(d.id)}
            color={opt?.color || "#64748b"}
            badge={d.kind.toUpperCase()}
            label={d.label}
            lat={d.lat}
            lon={d.lon}
            onDelete={() => handleDelete(d.id)}
          />
        );
      })}

      {(operation.datums || []).length === 0 && !pendingDatumPoint && (
        <p className="text-[10px] text-fg-4 italic">
          Add secondary datums (e.g. "last seen at house" + "possible at local park") to generate multiple overlapping search patterns.
        </p>
      )}
    </div>
  );
}

function DatumRow({
  selected,
  onSelect,
  color,
  badge,
  label,
  lat,
  lon,
  onDelete,
}: {
  selected: boolean;
  onSelect: () => void;
  color: string;
  badge: string;
  label: string;
  lat: number;
  lon: number;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-2 p-2 rounded border ${
        selected ? "border-accent/60 bg-accent/5" : "border-surface-700 bg-surface-800/50"
      }`}
    >
      <button
        onClick={onSelect}
        className="mt-0.5 shrink-0"
        title="Use this datum for next grid pattern"
      >
        {selected ? <Target size={14} className="text-accent" /> : <MapPin size={14} style={{ color }} />}
      </button>
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: `${color}22`, color }}>
            {badge}
          </span>
          <span className="text-xs font-medium truncate">{label}</span>
        </div>
        <div className="text-[10px] text-fg-4 font-mono">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </div>
      </button>
      {onDelete && (
        <button onClick={onDelete} className="text-fg-4 hover:text-red-400 shrink-0" title="Delete datum">
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
