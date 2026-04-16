"use client";

import { useEffect, useState } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { Sitrep } from "@/types/search";
import { X, FileText, RefreshCw, Copy, Check, Mail, Send } from "lucide-react";

export function SitrepPanel({
  operationId,
  recipients,
  operationName,
}: {
  operationId: string;
  recipients?: string[];
  operationName?: string;
}) {
  const { toggleSitrepPanel, sitrep, setSitrep } = useSearchStore();
  useEscapeKey(toggleSitrepPanel);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailList, setEmailList] = useState<string>((recipients || []).join(", "));
  const [emailNote, setEmailNote] = useState<string>("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Keep the recipient list in sync if the op refetches.
  useEffect(() => {
    if (recipients && recipients.length > 0 && !emailList.trim()) {
      setEmailList(recipients.join(", "));
    }
  }, [recipients]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSitrep = async () => {
    setLoading(true);
    try {
      const s = await search.getSitrep(operationId) as Sitrep;
      setSitrep(s);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchSitrep(); }, [operationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = () => {
    if (!sitrep?.text) return;
    navigator.clipboard.writeText(sitrep.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendEmail = async () => {
    const list = emailList
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    if (list.length === 0) {
      setEmailResult({ ok: false, text: "Add at least one valid email address" });
      return;
    }
    setEmailSending(true);
    setEmailResult(null);
    try {
      const r = await search.emailSitrep(operationId, list, emailNote || undefined);
      setEmailResult({ ok: true, text: `Sent to ${r.sent} recipient${r.sent > 1 ? "s" : ""}.` });
      setEmailNote("");
    } catch (e) {
      setEmailResult({ ok: false, text: e instanceof Error ? e.message : "Send failed" });
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-[1000] w-[500px] max-w-[calc(100vw-32px)] max-h-[70vh] bg-surface-800 border border-surface-600 rounded-xl shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700 shrink-0">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText size={16} className="text-accent" />
          SITREP{operationName ? ` — ${operationName}` : ""}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEmailOpen(!emailOpen)}
            className={`text-fg-4 hover:text-accent transition ${emailOpen ? "text-accent" : ""}`}
            title="Email SITREP to stakeholders"
          >
            <Mail size={14} />
          </button>
          <button onClick={fetchSitrep} disabled={loading} className="text-fg-4 hover:text-accent transition" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={handleCopy} className="text-fg-4 hover:text-accent transition" title="Copy text">
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
          <button onClick={toggleSitrepPanel} className="text-fg-4 hover:text-fg-1" aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {emailOpen && (
        <div className="p-3 border-b border-surface-700 bg-surface-900/40 space-y-2">
          <div>
            <label className="text-[10px] text-fg-4 uppercase tracking-wider block mb-1">Recipients (comma-separated)</label>
            <textarea
              value={emailList}
              onChange={(e) => setEmailList(e.target.value)}
              rows={2}
              placeholder="ops@example.org, duty@example.org"
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-xs resize-none focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-[10px] text-fg-4 uppercase tracking-wider block mb-1">Note (optional, prepended)</label>
            <textarea
              value={emailNote}
              onChange={(e) => setEmailNote(e.target.value)}
              rows={2}
              placeholder="e.g. Requesting additional K9 team, ETA needed."
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-xs resize-none focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={sendEmail}
              disabled={emailSending || !emailList.trim()}
              className="px-3 py-1.5 bg-accent hover:bg-accent/80 disabled:opacity-50 text-surface-900 text-xs font-medium rounded flex items-center gap-1.5"
            >
              <Send size={12} />
              {emailSending ? "Sending…" : "Send SITREP"}
            </button>
            <span className="text-[10px] text-fg-4">Includes a 72h live briefing link</span>
          </div>
          {emailResult && (
            <div className={`text-[11px] ${emailResult.ok ? "text-green-400" : "text-red-400"}`}>
              {emailResult.text}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {!sitrep ? (
          <p className="text-xs text-fg-4">Loading...</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 mb-4">
              <StatBox label="Zones" value={`${sitrep.summary.complete}/${sitrep.summary.total_zones}`} sub="complete" />
              <StatBox label="Avg POD" value={`${Math.round(sitrep.summary.avg_pod * 100)}%`} />
              <StatBox label="Teams" value={`${sitrep.summary.deployed_teams}/${sitrep.summary.total_teams}`} sub="deployed" />
              <StatBox label="Clues" value={String(sitrep.summary.clue_count)} accent={sitrep.summary.clue_count > 0} />
            </div>

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
