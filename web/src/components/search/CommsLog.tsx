"use client";

import { useEffect, useState } from "react";
import { search } from "@/lib/api";
import { useSearchStore } from "@/stores/search";
import { Send, Radio, StickyNote } from "lucide-react";

export function CommsLog({ operationId }: { operationId: string }) {
  const { commsLog, setCommsLog, addCommsEntry } = useSearchStore();
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState("Control");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    search.listComms(operationId).then((d: any) => setCommsLog(d.comms || [])).catch(() => {});
  }, [operationId]);

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const entry = await search.addComms(operationId, {
        from_callsign: from,
        to_callsign: to || undefined,
        message,
        type: "radio",
      });
      setMessage("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Log entries */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <h3 className="text-xs font-medium text-fg-4 uppercase tracking-wider mb-2">Comms Log</h3>
        {commsLog.length === 0 ? (
          <p className="text-xs text-fg-4 py-4 text-center">No comms logged</p>
        ) : (
          [...commsLog].reverse().map((c: any) => (
            <div key={c.id} className="text-xs py-1.5 border-b border-surface-700/50">
              <div className="flex items-center gap-2">
                {c.type === "radio" ? (
                  <Radio size={10} className="text-accent shrink-0" />
                ) : c.type === "note" ? (
                  <StickyNote size={10} className="text-amber-400 shrink-0" />
                ) : (
                  <span className="text-fg-4 shrink-0">SYS</span>
                )}
                <span className="text-fg-4">
                  {new Date(c.created_at).toLocaleTimeString()}
                </span>
                {c.from_callsign && (
                  <span className="text-accent font-medium">{c.from_callsign}</span>
                )}
                {c.to_callsign && (
                  <>
                    <span className="text-fg-4">&rarr;</span>
                    <span className="text-fg-3">{c.to_callsign}</span>
                  </>
                )}
              </div>
              <p className="ml-5 text-fg-2 mt-0.5">{c.message}</p>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t border-surface-700 p-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="From"
            className="w-20 px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
          />
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To (optional)"
            className="w-20 px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Log message..."
            className="flex-1 px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="px-3 py-1.5 bg-accent text-black rounded text-xs disabled:opacity-50"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
