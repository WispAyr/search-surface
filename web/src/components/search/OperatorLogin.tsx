"use client";

import { useEffect, useState } from "react";
import { onAuthFailure, setAdminToken, search, getAdminToken } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Lock, X } from "lucide-react";

// Modal that surfaces only when SEARCH_ADMIN_TOKEN is set server-side and the
// browser doesn't yet have a matching token. Open paths (operations list,
// brief page, field view) keep working without this ever appearing.
export function OperatorLogin() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // On mount, check whether auth is required. If required and not authed,
    // open immediately rather than waiting for a failed write.
    (async () => {
      try {
        const status = await search.authStatus();
        if (cancelled) return;
        if (status.required && !status.authed) setOpen(true);
      } catch {}
    })();
    onAuthFailure(() => setOpen(true));
    return () => { cancelled = true; };
  }, []);

  useEscapeKey(() => setOpen(false), open);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) return;
    setChecking(true);
    setError(null);
    setAdminToken(value);
    try {
      const status = await search.authStatus();
      if (status.authed) {
        setOpen(false);
        // Force a reload so any previously-failed queries rehydrate.
        window.location.reload();
      } else {
        setAdminToken(null);
        setError("Token rejected");
      }
    } catch {
      setAdminToken(null);
      setError("Could not verify token");
    } finally {
      setChecking(false);
    }
  };

  if (!open) return null;
  const currentToken = getAdminToken();

  return (
    <div className="fixed inset-0 z-[3000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-800 border border-surface-600 rounded-xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Lock size={14} className="text-accent" />
            Operator Authentication
          </h3>
          <button onClick={() => setOpen(false)} className="text-fg-4 hover:text-fg-1" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <p className="text-xs text-fg-3">
            This instance requires an operator token to create or modify operations. Read-only access and field team links keep working.
          </p>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Operator token"
            autoFocus
            className="w-full bg-surface-900 border border-surface-600 rounded px-3 py-2 text-sm text-fg-1 placeholder-fg-4 focus:outline-none focus:border-accent"
          />
          {error && <div className="text-xs text-red-400">{error}</div>}
          <button
            type="submit"
            disabled={checking || !value}
            className="w-full bg-accent hover:bg-accent/80 disabled:opacity-50 text-surface-900 text-sm font-medium py-2 rounded"
          >
            {checking ? "Verifying…" : "Unlock"}
          </button>
          {currentToken && (
            <button
              type="button"
              onClick={() => { setAdminToken(null); window.location.reload(); }}
              className="w-full text-xs text-fg-4 hover:text-fg-2 pt-1"
            >
              Clear saved token
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
