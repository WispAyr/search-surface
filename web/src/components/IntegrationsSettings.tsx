"use client";

import { useCallback, useEffect, useState } from "react";
import { Radio, Check, X, Loader2, Copy, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const INBOUND_WEBHOOK_CHANNELS = new Set(["telegram", "slack", "discord"]);

type FieldType = "text" | "secret" | "select";

interface Field {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
}

interface IntegrationSpec {
  name: string;
  displayName: string;
  description: string;
  fields: Field[];
}

// Kept in sync with comms-kit/src/adapters — duplicated here to avoid a
// build-time dep on the private package until GitHub Packages auth is set up.
const SPECS: IntegrationSpec[] = [
  {
    name: "telegram",
    displayName: "Telegram",
    description: "Bot API — outbound alerts and optional inbound via webhook.",
    fields: [
      { key: "bot_token", label: "Bot token", type: "secret", required: true, help: "Create a bot with @BotFather and paste the token." },
      { key: "chat_id", label: "Default chat ID", type: "text", required: true, help: "Numeric chat/channel/group ID." },
      { key: "thread_id", label: "Forum topic ID (optional)", type: "text" },
    ],
  },
  {
    name: "slack",
    displayName: "Slack",
    description: "Incoming webhook — outbound only for v1.",
    fields: [
      { key: "webhook_url", label: "Incoming webhook URL", type: "secret", required: true, help: "https://hooks.slack.com/services/..." },
      { key: "default_channel_override", label: "Channel override (optional)", type: "text" },
    ],
  },
  {
    name: "discord",
    displayName: "Discord",
    description: "Channel webhook — outbound only for v1.",
    fields: [
      { key: "webhook_url", label: "Channel webhook URL", type: "secret", required: true, help: "Server Settings → Integrations → Webhooks." },
      { key: "username_override", label: "Username override (optional)", type: "text" },
    ],
  },
  {
    name: "matrix",
    displayName: "Matrix",
    description: "Client-Server API — outbound to a room, bot must be joined.",
    fields: [
      { key: "homeserver_url", label: "Homeserver URL", type: "text", required: true, help: "e.g. https://matrix.org" },
      { key: "room_id", label: "Room ID", type: "text", required: true, help: "!abcdef:matrix.org — NOT the human alias." },
      { key: "access_token", label: "Access token", type: "secret", help: "Preferred. Generate in Element → Settings → Help & About." },
      { key: "username", label: "Username (if no token)", type: "text" },
      { key: "password", label: "Password (if no token)", type: "secret" },
    ],
  },
  {
    name: "tak",
    displayName: "TAK Server",
    description: "CoT chat over TCP/TLS — outbound only.",
    fields: [
      { key: "host", label: "Host", type: "text", required: true },
      { key: "port", label: "Port", type: "text", required: true, help: "8087 streaming · 8089 TLS." },
      { key: "tls", label: "TLS", type: "select", options: [
        { value: "", label: "Auto (TLS if port 8089)" },
        { value: "true", label: "Force TLS" },
        { value: "false", label: "Plain TCP" },
      ] },
      { key: "callsign", label: "Callsign", type: "text", help: "Shown to TAK clients. Default 'dispatch'." },
      { key: "chatroom", label: "Chatroom", type: "text", help: "Default 'All Chat Rooms'." },
      { key: "client_cert", label: "Client cert (PEM)", type: "secret", help: "mTLS — required by most TAK servers." },
      { key: "client_key", label: "Client key (PEM)", type: "secret" },
      { key: "ca_cert", label: "Server CA (PEM)", type: "secret", help: "Optional — trust a private CA." },
    ],
  },
  {
    name: "broadnet",
    displayName: "Broadnet",
    description: "Outbound via the WispAyr Broadnet bridge.",
    fields: [
      { key: "organisation_id", label: "Organisation ID", type: "text", required: true },
      { key: "handset_user_id", label: "Default handset (optional)", type: "text", help: "Leave blank to broadcast to all handsets." },
      { key: "flash", label: "Flash by default", type: "select", options: [
        { value: "false", label: "No" },
        { value: "true", label: "Yes (flashing)" },
      ] },
    ],
  },
];

interface IntegrationState {
  name: string;
  configured: boolean;
  updated_at: string | null;
  summary: Record<string, unknown> | null;
}

export function IntegrationsSettings() {
  const { user } = useAuth();
  const canEdit = user?.role === "owner";
  const [states, setStates] = useState<IntegrationState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/integrations", { credentials: "include" });
      if (!r.ok) throw new Error(`Failed to load integrations: ${r.status}`);
      const data = await r.json();
      setStates(data.integrations || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="bg-surface-800 border border-surface-700 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-1 text-fg-2">
        <Radio size={16} className="text-accent" />
        <h2 className="text-sm font-semibold uppercase tracking-wide">Comms Integrations</h2>
      </div>
      <p className="text-xs text-fg-4 mb-4">
        Bring your own keys. Messages fan out across every enabled channel.
      </p>
      {loading && <p className="text-xs text-fg-4"><Loader2 size={14} className="inline animate-spin" /> loading…</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="space-y-3">
        {SPECS.map((spec) => {
          const state = states.find((s) => s.name === spec.name) || { name: spec.name, configured: false, updated_at: null, summary: null };
          return (
            <IntegrationRow key={spec.name} spec={spec} state={state} canEdit={canEdit} onChange={load} />
          );
        })}
      </div>
      <RoutingEditor canEdit={canEdit} configured={states.filter((s) => s.configured).map((s) => s.name)} />
    </section>
  );
}

interface RoutingConfig {
  enabled_channels: string[];
  fan_out_all: boolean;
  updated_at: string | null;
}

function RoutingEditor({ canEdit, configured }: { canEdit: boolean; configured: string[] }) {
  const [cfg, setCfg] = useState<RoutingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/integrations/routing/config", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setCfg(data.effective || { enabled_channels: [], fan_out_all: true, updated_at: null });
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (name: string) => {
    if (!cfg) return;
    const on = cfg.enabled_channels.includes(name);
    setCfg({
      ...cfg,
      enabled_channels: on ? cfg.enabled_channels.filter((c) => c !== name) : [...cfg.enabled_channels, name],
    });
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/integrations/routing/config", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled_channels: cfg.enabled_channels, fan_out_all: cfg.fan_out_all }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMsg({ kind: "ok", text: "Saved" });
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const pool = Array.from(new Set([...configured, ...SPECS.map((s) => s.name)]));

  return (
    <div className="mt-4 pt-4 border-t border-surface-700">
      <div className="text-xs text-fg-3 font-medium mb-1">Cross-channel fan-out · tenant default</div>
      <p className="text-xs text-fg-4 mb-3">
        Messages typed in ops fan out to every selected channel. Inbound on one channel relays to the others.
      </p>
      {loading ? (
        <p className="text-xs text-fg-4">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {pool.map((name) => {
              const enabled = cfg?.enabled_channels.includes(name) || false;
              const isConfigured = configured.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={!canEdit || !isConfigured}
                  onClick={() => toggle(name)}
                  className={`px-2.5 py-1 text-xs rounded border transition ${
                    enabled
                      ? "bg-accent/20 border-accent/40 text-accent"
                      : "bg-surface-900 border-surface-700 text-fg-3 hover:border-surface-600"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                  title={isConfigured ? "" : "Configure this integration first"}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-accent text-black rounded hover:bg-accent/80 transition disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save routing"}
            </button>
          )}
          {msg && (
            <span className={`ml-3 text-xs ${msg.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>
              {msg.text}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function IntegrationRow({ spec, state, canEdit, onChange }: {
  spec: IntegrationSpec;
  state: IntegrationState;
  canEdit: boolean;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-surface-700 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-700/40 hover:bg-surface-700/60 transition text-left"
      >
        <div>
          <div className="text-sm font-medium text-fg-1">{spec.displayName}</div>
          <div className="text-xs text-fg-4">{spec.description}</div>
        </div>
        <div className="flex items-center gap-2">
          {state.configured ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><Check size={12} /> Configured</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-fg-4"><X size={12} /> Not configured</span>
          )}
        </div>
      </button>
      {expanded && (
        <div className="p-4 border-t border-surface-700">
          <IntegrationForm spec={spec} state={state} canEdit={canEdit} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function IntegrationForm({ spec, state, canEdit, onChange }: {
  spec: IntegrationSpec;
  state: IntegrationState;
  canEdit: boolean;
  onChange: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of spec.fields) {
      if (f.type === "secret") { out[f.key] = ""; continue; }
      out[f.key] = (state.summary?.[f.key] as string) ?? "";
    }
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setMsg(null);
    try {
      const payload: Record<string, string> = {};
      for (const f of spec.fields) {
        const v = values[f.key] ?? "";
        if (f.type === "secret" && state.configured && !v) continue; // keep prior
        if (f.required && !v && !(f.type === "secret" && state.configured)) {
          throw new Error(`${f.label} is required`);
        }
        payload[f.key] = v;
      }
      const r = await fetch(`/api/integrations/${spec.name}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      setMsg({ kind: "ok", text: "Saved" });
      // Clear secret fields after save so they don't sit in memory/state.
      setValues((prev) => {
        const out = { ...prev };
        for (const f of spec.fields) if (f.type === "secret") out[f.key] = "";
        return out;
      });
      onChange();
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/integrations/${spec.name}/test`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      if (!data.ok) throw new Error(data.error || "Test failed");
      setMsg({ kind: "ok", text: "Test message sent" });
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit) return;
    if (!confirm(`Remove ${spec.displayName} integration?`)) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/integrations/${spec.name}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMsg({ kind: "ok", text: "Removed" });
      onChange();
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-3">
      {spec.fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <label className="text-xs text-fg-3 block">
            {f.label}{f.required ? " *" : ""}
          </label>
          {f.type === "select" ? (
            <select
              disabled={!canEdit}
              value={values[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              className="w-full bg-surface-900 border border-surface-700 rounded px-3 py-1.5 text-sm"
            >
              <option value="">—</option>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input
              disabled={!canEdit}
              type={f.type === "secret" ? "password" : "text"}
              placeholder={f.type === "secret" && state.configured ? "•••••• (leave blank to keep current)" : ""}
              value={values[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              autoComplete="off"
              className="w-full bg-surface-900 border border-surface-700 rounded px-3 py-1.5 text-sm"
            />
          )}
          {f.help && <p className="text-xs text-fg-4">{f.help}</p>}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canEdit || saving}
          className="px-3 py-1.5 text-xs bg-accent text-black rounded hover:bg-accent/80 transition disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {state.configured && (
          <button
            type="button"
            disabled={testing}
            onClick={handleTest}
            className="px-3 py-1.5 text-xs border border-surface-700 rounded hover:bg-surface-700/40 transition disabled:opacity-50"
          >
            {testing ? "Sending…" : "Send test"}
          </button>
        )}
        {state.configured && canEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-red-400 border border-red-500/30 rounded hover:bg-red-500/10 transition disabled:opacity-50 ml-auto"
          >
            Remove
          </button>
        )}
      </div>
      {msg && (
        <p className={`text-xs ${msg.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}
      {state.configured && INBOUND_WEBHOOK_CHANNELS.has(spec.name) && (
        <InboundWebhookHelper channel={spec.name} />
      )}
    </form>
  );
}

function InboundWebhookHelper({ channel }: { channel: string }) {
  const [open, setOpen] = useState(false);
  const [operations, setOperations] = useState<{ id: string; name: string }[]>([]);
  const [operationId, setOperationId] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || operations.length) return;
    fetch("/api/search/operations", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const ops = (data.operations || data || []) as { id: string; name: string }[];
        setOperations(ops);
        if (ops[0] && !operationId) setOperationId(ops[0].id);
      })
      .catch((e) => setErr(e.message));
  }, [open, operations.length, operationId]);

  const fetchUrl = async () => {
    if (!operationId) return;
    setLoading(true);
    setErr(null);
    setUrl(null);
    setCopied(false);
    try {
      const r = await fetch(
        `/api/integrations/webhook-url?channel=${encodeURIComponent(channel)}&operation_id=${encodeURIComponent(operationId)}`,
        { credentials: "include" }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setUrl(data.url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="pt-3 mt-2 border-t border-surface-700/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-fg-3 hover:text-fg-1 flex items-center gap-1"
      >
        <ChevronDown size={12} className={`transition ${open ? "" : "-rotate-90"}`} />
        Inbound webhook URL
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-fg-4">
            Paste into{" "}
            {channel === "telegram" && "Telegram's setWebhook"}
            {channel === "slack" && "Slack Events API subscription"}
            {channel === "discord" && "Discord outgoing webhook config"}
            {" "}— messages arrive in the selected operation.
          </p>
          <div className="flex gap-2">
            <select
              value={operationId}
              onChange={(e) => { setOperationId(e.target.value); setUrl(null); }}
              className="flex-1 bg-surface-900 border border-surface-700 rounded px-3 py-1.5 text-sm"
            >
              {operations.length === 0 && <option value="">No operations</option>}
              {operations.map((o) => (
                <option key={o.id} value={o.id}>{o.name || o.id}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={fetchUrl}
              disabled={loading || !operationId}
              className="px-3 py-1.5 text-xs border border-surface-700 rounded hover:bg-surface-700/40 transition disabled:opacity-50"
            >
              {loading ? "…" : "Generate"}
            </button>
          </div>
          {url && (
            <div className="flex items-center gap-2 bg-surface-900 border border-surface-700 rounded px-2 py-1.5">
              <code className="flex-1 text-xs text-fg-2 font-mono break-all">{url}</code>
              <button
                type="button"
                onClick={copy}
                className="text-xs text-fg-3 hover:text-accent flex items-center gap-1 shrink-0"
              >
                <Copy size={12} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>
      )}
    </div>
  );
}
