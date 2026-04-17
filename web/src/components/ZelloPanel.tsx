"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Radio, Send, Link as LinkIcon, Link2Off, AlertCircle, Image as ImageIcon, MapPin } from "lucide-react";

// Zello channel panel. BYOK: the tenant configures their Zello dev key in
// /settings, we mint a short-lived JWT server-side, and the browser opens a
// WebSocket directly to Zello — so audio never transits our server.
//
// V1 scope:
//   - logon to a channel with a fresh JWT
//   - display incoming text messages, locations, and image notifications
//   - send text messages
//   - optional: persist incoming events to the ops comms log
//
// Voice TX/RX is deferred (needs an Opus codec bundle). The receiver
// acknowledges stream_start/stream_stop so operators can see *that* somebody
// is talking even if we aren't playing the audio yet.
//
// Zello protocol reference:
// https://github.com/zelloptt/zello-channel-api/blob/main/API.md

interface ZelloEvent {
  id: string;
  at: string;
  kind: "text" | "location" | "image" | "voice_start" | "voice_stop" | "status" | "error";
  from?: string;
  body?: string;
  lat?: number;
  lon?: number;
}

interface Props {
  operationId: string;
  // Optional channel override. If not set we use tenant default channel.
  channel?: string;
  // When true, incoming messages POST to /api/search/operations/:id/comms.
  persistToLog?: boolean;
  // Called for each incoming location event so the map can drop a pin.
  onLocation?: (ev: { from?: string; lat: number; lon: number; at: string }) => void;
}

type ConnState = "idle" | "requesting_token" | "connecting" | "logging_on" | "connected" | "error" | "closed";

export function ZelloPanel({ operationId, channel, persistToLog = false, onLocation }: Props) {
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ZelloEvent[]>([]);
  const [draft, setDraft] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connectedChannel, setConnectedChannel] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(1);
  const pendingRef = useRef(new Map<number, (msg: Record<string, unknown>) => void>());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check whether Zello is configured for this team. If not, render a prompt
  // to visit settings — avoids a half-working PTT button.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/zello/settings", { credentials: "include" });
        if (cancelled) return;
        if (!res.ok) { setConfigured(false); return; }
        const data = await res.json();
        setConfigured(Boolean(data.configured));
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const appendEvent = useCallback((ev: ZelloEvent) => {
    setEvents((prev) => [...prev.slice(-199), ev]);
  }, []);

  // Auto-scroll when new events land, unless the user scrolled up manually.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Heuristic: only stick to bottom if already within 80px.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events]);

  const persist = useCallback(async (event: ZelloEvent) => {
    if (!persistToLog) return;
    let message = "";
    if (event.kind === "text") message = `[zello] ${event.body ?? ""}`;
    else if (event.kind === "location") message = `[zello] ${event.from} location: ${event.lat?.toFixed(5)}, ${event.lon?.toFixed(5)}`;
    else if (event.kind === "voice_start") message = `[zello] ${event.from} started talking`;
    else if (event.kind === "voice_stop") message = `[zello] ${event.from} stopped talking`;
    else if (event.kind === "image") message = `[zello] ${event.from} sent an image`;
    else return;
    try {
      await fetch(`/api/search/operations/${operationId}/comms`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_callsign: event.from || "zello", message, type: "radio" }),
      });
    } catch {
      // Non-critical; just drop on the floor
    }
  }, [operationId, persistToLog]);

  const onWsMessage = useCallback((raw: MessageEvent) => {
    // Binary messages are Opus voice packets — skip until RX audio lands.
    if (typeof raw.data !== "string") return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw.data); } catch { return; }

    // Command response (correlated by seq)
    const seq = typeof msg.seq === "number" ? (msg.seq as number) : null;
    if (seq && pendingRef.current.has(seq)) {
      pendingRef.current.get(seq)!(msg);
      pendingRef.current.delete(seq);
      return;
    }

    const command = String(msg.command || "");
    const now = new Date().toISOString();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (command === "on_channel_status") {
      const ev: ZelloEvent = {
        id, at: now, kind: "status",
        body: `Channel ${msg.channel}: ${msg.status}${msg.users_online ? ` (${msg.users_online} online)` : ""}`,
      };
      appendEvent(ev);
    } else if (command === "on_text_message") {
      const ev: ZelloEvent = { id, at: now, kind: "text", from: String(msg.from || "unknown"), body: String(msg.text || "") };
      appendEvent(ev); persist(ev);
    } else if (command === "on_location") {
      const lat = Number(msg.latitude);
      const lon = Number(msg.longitude);
      const ev: ZelloEvent = { id, at: now, kind: "location", from: String(msg.from || "unknown"), lat, lon };
      appendEvent(ev); persist(ev);
      if (onLocation && Number.isFinite(lat) && Number.isFinite(lon)) {
        onLocation({ from: ev.from, lat, lon, at: now });
      }
    } else if (command === "on_stream_start") {
      const ev: ZelloEvent = { id, at: now, kind: "voice_start", from: String(msg.from || "unknown") };
      appendEvent(ev); persist(ev);
    } else if (command === "on_stream_stop") {
      const ev: ZelloEvent = { id, at: now, kind: "voice_stop", from: String(msg.from || "unknown") };
      appendEvent(ev); persist(ev);
    } else if (command === "on_image") {
      const ev: ZelloEvent = { id, at: now, kind: "image", from: String(msg.from || "unknown"), body: String(msg.type || "image") };
      appendEvent(ev); persist(ev);
    } else if (command === "on_error" || msg.error) {
      appendEvent({ id, at: now, kind: "error", body: String(msg.error || "Unknown Zello error") });
    }
  }, [appendEvent, persist, onLocation]);

  const sendCommand = useCallback(<T extends Record<string, unknown>>(command: string, payload: Record<string, unknown> = {}): Promise<T> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("WebSocket not open"));
      const seq = seqRef.current++;
      pendingRef.current.set(seq, (resp) => {
        if (resp.success === false || resp.error) reject(new Error(String(resp.error || "command failed")));
        else resolve(resp as T);
      });
      ws.send(JSON.stringify({ command, seq, ...payload }));
      // Timeout safety — Zello usually responds in <1s
      setTimeout(() => {
        if (pendingRef.current.has(seq)) {
          pendingRef.current.delete(seq);
          reject(new Error(`${command} timeout`));
        }
      }, 8000);
    });
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (wsRef.current) try { wsRef.current.close(); } catch {}

    setState("requesting_token");
    let tokenData: { token: string; ws_url: string; channel: string; username: string };
    try {
      const res = await fetch("/api/zello/token", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channel || undefined }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `token request failed (${res.status})`);
      }
      tokenData = await res.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
      return;
    }

    setState("connecting");
    const ws = new WebSocket(tokenData.ws_url);
    wsRef.current = ws;
    ws.onmessage = onWsMessage;
    ws.onerror = () => {
      setError("WebSocket error");
      setState("error");
    };
    ws.onclose = () => setState("closed");
    ws.onopen = async () => {
      setState("logging_on");
      try {
        await sendCommand("logon", {
          auth_token: tokenData.token,
          username: tokenData.username,
          channel: tokenData.channel,
        });
        setConnectedChannel(tokenData.channel);
        setState("connected");
        appendEvent({
          id: `sys-${Date.now()}`,
          at: new Date().toISOString(),
          kind: "status",
          body: `Connected to ${tokenData.channel}`,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    };
  }, [channel, onWsMessage, sendCommand, appendEvent]);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(); } catch {}
    }
    wsRef.current = null;
    setState("idle");
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  const sendText = async () => {
    if (!draft.trim() || state !== "connected") return;
    const text = draft.trim();
    try {
      await sendCommand("send_text_message", { channel: connectedChannel, text });
      appendEvent({
        id: `me-${Date.now()}`,
        at: new Date().toISOString(),
        kind: "text",
        from: "you",
        body: text,
      });
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ── Render ──
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg flex flex-col h-full min-h-[280px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-accent" />
          <span className="text-sm font-medium">Zello</span>
          {connectedChannel && (
            <span className="text-xs text-fg-4">· {connectedChannel}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ConnBadge state={state} />
          {state === "connected" ? (
            <button
              onClick={disconnect}
              className="text-xs text-fg-4 hover:text-fg-1 flex items-center gap-1"
            >
              <Link2Off size={12} /> Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={state === "connecting" || state === "logging_on" || state === "requesting_token" || configured === false}
              className="text-xs bg-accent text-black px-2 py-1 rounded flex items-center gap-1 disabled:opacity-50"
            >
              <LinkIcon size={12} /> Connect
            </button>
          )}
        </div>
      </div>

      {configured === false && (
        <div className="px-3 py-4 text-xs text-fg-3 border-b border-surface-700 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-400 mt-0.5" />
          <div>
            Zello is not configured for this team.{" "}
            <a href="/settings" className="text-accent hover:underline">Set it up in team settings →</a>
          </div>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-500/10 border-b border-red-500/30 flex items-center gap-2">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-xs">
        {events.length === 0 && (
          <div className="text-fg-4 py-6 text-center">
            {state === "connected" ? "Waiting for channel activity…" : "Not connected"}
          </div>
        )}
        {events.map((ev) => (
          <EventRow key={ev.id} ev={ev} />
        ))}
      </div>

      <div className="px-3 py-2 border-t border-surface-700 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
          placeholder={state === "connected" ? "Type a message…" : "Connect to chat"}
          disabled={state !== "connected"}
          className="flex-1 bg-surface-900 border border-surface-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          onClick={sendText}
          disabled={state !== "connected" || !draft.trim()}
          className="bg-accent text-black px-2 py-1.5 rounded disabled:opacity-50"
          aria-label="Send"
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

function ConnBadge({ state }: { state: ConnState }) {
  const map: Record<ConnState, { label: string; cls: string }> = {
    idle: { label: "Idle", cls: "bg-surface-700 text-fg-3" },
    requesting_token: { label: "Authorising…", cls: "bg-amber-500/20 text-amber-300" },
    connecting: { label: "Connecting…", cls: "bg-amber-500/20 text-amber-300" },
    logging_on: { label: "Logging on…", cls: "bg-amber-500/20 text-amber-300" },
    connected: { label: "Live", cls: "bg-green-500/20 text-green-300" },
    error: { label: "Error", cls: "bg-red-500/20 text-red-300" },
    closed: { label: "Closed", cls: "bg-surface-700 text-fg-4" },
  };
  const { label, cls } = map[state];
  return <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>{label}</span>;
}

function EventRow({ ev }: { ev: ZelloEvent }) {
  const t = new Date(ev.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (ev.kind === "status") {
    return <div className="text-fg-4 italic">{t} — {ev.body}</div>;
  }
  if (ev.kind === "error") {
    return <div className="text-red-400">{t} — {ev.body}</div>;
  }
  if (ev.kind === "voice_start") {
    return <div className="text-green-300"><Radio size={10} className="inline mr-1" />{t} — {ev.from} started talking</div>;
  }
  if (ev.kind === "voice_stop") {
    return <div className="text-fg-4">{t} — {ev.from} stopped</div>;
  }
  if (ev.kind === "location") {
    return (
      <div className="text-blue-300">
        <MapPin size={10} className="inline mr-1" />
        {t} — {ev.from} @ {ev.lat?.toFixed(4)}, {ev.lon?.toFixed(4)}
      </div>
    );
  }
  if (ev.kind === "image") {
    return <div className="text-fg-2"><ImageIcon size={10} className="inline mr-1" />{t} — {ev.from} sent an image</div>;
  }
  return (
    <div className="text-fg-1">
      <span className="text-fg-4">{t}</span>{" "}
      <span className="text-accent">{ev.from}</span>: {ev.body}
    </div>
  );
}
