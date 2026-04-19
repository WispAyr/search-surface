"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";

export type QuickReportType = "clue" | "hazard" | "assist" | "welfare" | "area_clear";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { type: QuickReportType; description: string; severity: "info" | "warn" | "urgent" }) => Promise<void>;
}

const TYPES: Array<{ id: QuickReportType; label: string; defaultSeverity: "info" | "warn" | "urgent" }> = [
  { id: "clue", label: "Clue / sighting", defaultSeverity: "warn" },
  { id: "hazard", label: "Hazard", defaultSeverity: "urgent" },
  { id: "assist", label: "Assist needed", defaultSeverity: "urgent" },
  { id: "welfare", label: "Welfare concern", defaultSeverity: "warn" },
  { id: "area_clear", label: "Area clear", defaultSeverity: "info" },
];

// Bottom-sheet report form — slide-up on mobile. Mirrors ReportsPanel types so
// the controller-side list treats these as first-class reports (not just notes).
export function ReportSheet({ open, onClose, onSubmit }: Props) {
  const [type, setType] = useState<QuickReportType>("clue");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"info" | "warn" | "urgent">("warn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ type, description: description.trim(), severity });
      setDescription("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full sm:max-w-md bg-surface-900 border-t sm:border border-surface-700 sm:rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
          <h2 className="font-semibold">New report</h2>
          <button onClick={onClose} className="text-fg-4 hover:text-fg-1" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-fg-4 mb-2">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setType(t.id); setSeverity(t.defaultSeverity); }}
                  className={`px-3 py-2.5 rounded text-sm border text-left transition ${
                    type === t.id
                      ? "bg-accent/15 border-accent text-fg-1"
                      : "bg-surface-800 border-surface-700 text-fg-3 hover:border-surface-500"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-fg-4 mb-2">Severity</label>
            <div className="flex gap-2">
              {(["info", "warn", "urgent"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={`flex-1 px-3 py-2 rounded text-sm border transition capitalize ${
                    severity === s
                      ? s === "urgent"
                        ? "bg-red-500/20 border-red-400 text-red-200"
                        : s === "warn"
                          ? "bg-amber-500/20 border-amber-400 text-amber-100"
                          : "bg-sky-500/20 border-sky-400 text-sky-100"
                      : "bg-surface-800 border-surface-700 text-fg-4 hover:border-surface-500"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-fg-4 mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What did you find? Keep it short."
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded text-sm text-fg-1 placeholder:text-fg-5 focus:outline-none focus:border-accent"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 px-4 py-3 border border-surface-700 rounded text-sm text-fg-3 hover:bg-surface-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={busy || !description.trim()}
              className="flex-1 px-4 py-3 bg-accent text-black rounded text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Send report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
