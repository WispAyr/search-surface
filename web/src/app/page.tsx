"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import { useSearchOperations } from "@/hooks/useSearchData";
import type { OperationType, SearchOperation } from "@/types/search";
import { IncidentWizard } from "@/components/search/IncidentWizard";
import { HelpPanel } from "@/components/search/HelpPanel";
import {
  Search,
  Plus,
  Shield,
  Users,
  AlertTriangle,
  Eye,
  MapPin,
  Clock,
  ChevronRight,
  HelpCircle,
  Trash2,
} from "lucide-react";

const TYPE_ICONS: Record<OperationType, React.ReactNode> = {
  missing_person: <AlertTriangle size={16} className="text-red-400" />,
  security_sweep: <Shield size={16} className="text-amber-400" />,
  event_patrol: <Users size={16} className="text-blue-400" />,
  welfare_check: <Eye size={16} className="text-green-400" />,
  custom: <MapPin size={16} className="text-fg-4" />,
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-blue-500/20 text-blue-300",
  active: "bg-green-500/20 text-green-300",
  suspended: "bg-amber-500/20 text-amber-300",
  completed: "bg-fg-4/20 text-fg-4",
  stood_down: "bg-fg-4/20 text-fg-4",
};

export default function SearchOperationsPage() {
  const router = useRouter();
  const { operations, operationsLoading } = useSearchStore();
  const { refresh } = useSearchOperations();
  const [showCreate, setShowCreate] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?\n\nThis permanently removes the operation and all its zones, teams, reports, and comms. This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await search.deleteOperation(id);
      await refresh();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-surface-900 text-fg-1">
      {/* Header */}
      <header className="border-b border-surface-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Search size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Search Operations</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHelp(true)}
            className="p-2 text-fg-3 hover:text-fg-1 transition"
            title="Help & Guide"
            aria-label="Help"
          >
            <HelpCircle size={18} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-1.5 text-sm bg-accent hover:bg-accent/80 text-black rounded flex items-center gap-2 transition"
          >
            <Plus size={14} />
            New Incident
          </button>
        </div>
      </header>

      {/* Operations list */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {operationsLoading && operations.length === 0 ? (
          <div className="text-fg-4 text-sm py-12 text-center">Loading operations...</div>
        ) : operations.length === 0 ? (
          <div className="text-center py-16">
            <Search size={40} className="mx-auto text-fg-4 mb-4" />
            <p className="text-fg-3 mb-2">No search operations</p>
            <p className="text-fg-4 text-sm mb-6">
              Create an operation to coordinate search grids, team assignments, and field reporting.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-accent text-black rounded text-sm"
            >
              Create First Incident
            </button>
            <button
              onClick={() => setShowHelp(true)}
              className="ml-2 px-4 py-2 text-sm text-fg-3 hover:text-fg-1"
            >
              Read the guide
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Active first, then by updated_at */}
            {operations.map((op) => (
              <div
                key={op.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/${op.id}`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/${op.id}`); }}
                className="w-full text-left bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg p-4 transition group cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {TYPE_ICONS[op.type]}
                    <div>
                      <h3 className="font-medium text-fg-1 group-hover:text-accent transition">
                        {op.name}
                      </h3>
                      <p className="text-xs text-fg-4 mt-0.5">
                        {op.type.replace(/_/g, " ")} &middot;{" "}
                        {op.zone_count || 0} zones &middot;{" "}
                        {op.team_count || 0} teams &middot;{" "}
                        {op.report_count || 0} reports
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[op.status]}`}>
                      {op.status}
                    </span>
                    <div className="text-xs text-fg-4 flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(op.updated_at).toLocaleDateString()}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(op.id, op.name); }}
                      disabled={deletingId === op.id}
                      title="Delete operation"
                      aria-label={`Delete ${op.name}`}
                      className="p-1.5 rounded text-fg-4 hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                    <ChevronRight size={16} className="text-fg-4 group-hover:text-accent transition" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Incident wizard */}
      {showCreate && (
        <IncidentWizard
          onClose={() => setShowCreate(false)}
          onCreated={(op) => router.push(`/${op.id}`)}
        />
      )}

      {/* Help panel */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function CreateOperationModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (op: SearchOperation) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<OperationType>("missing_person");
  const [datumLat, setDatumLat] = useState("");
  const [datumLon, setDatumLon] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectAge, setSubjectAge] = useState("");
  const [subjectDesc, setSubjectDesc] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = { name, type };
      if (datumLat && datumLon) {
        body.datum_lat = parseFloat(datumLat);
        body.datum_lon = parseFloat(datumLon);
      }
      if (type === "missing_person" && subjectName) {
        body.subject_info = {
          name: subjectName,
          age: subjectAge ? parseInt(subjectAge) : undefined,
          description: subjectDesc || undefined,
        };
      }
      const op = (await search.createOperation(body)) as SearchOperation;
      onCreate(op);
    } catch {
      // toast error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 border border-surface-600 rounded-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold mb-4">New Search Operation</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-fg-4 mb-1">Operation Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Missing Person — Ayr Beach"
              className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-fg-4 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as OperationType)}
              className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
            >
              <option value="missing_person">Missing Person</option>
              <option value="security_sweep">Security Sweep</option>
              <option value="event_patrol">Event Patrol</option>
              <option value="welfare_check">Welfare Check</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-fg-4 mb-1">Datum Latitude</label>
              <input
                value={datumLat}
                onChange={(e) => setDatumLat(e.target.value)}
                placeholder="55.4615"
                className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-4 mb-1">Datum Longitude</label>
              <input
                value={datumLon}
                onChange={(e) => setDatumLon(e.target.value)}
                placeholder="-4.6299"
                className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {type === "missing_person" && (
            <div className="border-t border-surface-600 pt-4">
              <h3 className="text-sm font-medium mb-3 text-fg-3">Subject Information</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-fg-4 mb-1">Name</label>
                    <input
                      value={subjectName}
                      onChange={(e) => setSubjectName(e.target.value)}
                      className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-fg-4 mb-1">Age</label>
                    <input
                      value={subjectAge}
                      onChange={(e) => setSubjectAge(e.target.value)}
                      type="number"
                      className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-fg-4 mb-1">Description</label>
                  <textarea
                    value={subjectDesc}
                    onChange={(e) => setSubjectDesc(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent resize-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-fg-3 hover:text-fg-1 transition">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="px-4 py-2 text-sm bg-accent text-black rounded disabled:opacity-50 transition"
          >
            {loading ? "Creating..." : "Create Operation"}
          </button>
        </div>
      </div>
    </div>
  );
}
