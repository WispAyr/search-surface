"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { IntegrationsSettings } from "@/components/IntegrationsSettings";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Users, Radio, Shield } from "lucide-react";

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsInner />
    </AuthGate>
  );
}

function SettingsInner() {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-surface-900 text-fg-1">
      <header className="border-b border-surface-700 px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => router.push("/")}
          className="p-2 text-fg-4 hover:text-fg-1 transition"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold">Team Settings</h1>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <section className="bg-surface-800 border border-surface-700 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-1 text-fg-2">
            <Shield size={16} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Team</h2>
          </div>
          <p className="text-xs text-fg-4 mb-3">Your organisation on search-surface</p>
          {user && (
            <div className="text-sm space-y-1.5">
              <div><span className="text-fg-4">Name:</span> <span className="text-fg-1">{user.tenant.name}</span></div>
              <div><span className="text-fg-4">Slug:</span> <span className="font-mono text-fg-3">{user.tenant.slug}</span></div>
              <div><span className="text-fg-4">Plan:</span> <span className="text-fg-3">{user.tenant.plan}</span></div>
              <div><span className="text-fg-4">You are:</span> <span className="text-fg-3 capitalize">{user.role}</span></div>
            </div>
          )}
        </section>

        <ZelloSettings />

        <IntegrationsSettings />

        {user?.role === "owner" && (
          <section className="bg-surface-800 border border-surface-700 rounded-lg p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1 text-fg-2">
                  <Users size={16} className="text-accent" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide">Members</h2>
                </div>
                <p className="text-xs text-fg-4">Invite operators and viewers into this team</p>
              </div>
              <Link
                href="/settings/members"
                className="px-3 py-1.5 text-xs bg-accent text-black rounded hover:bg-accent/80 transition"
              >
                Manage members →
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Zello config ──

interface ZelloConfigView {
  configured: boolean;
  issuer?: string;
  network_type?: "consumer" | "work";
  network_name?: string | null;
  default_channel?: string | null;
  private_key_preview?: string | null;
  updated_at?: string;
}

function ZelloSettings() {
  const { user } = useAuth();
  const canEdit = user?.role === "owner";
  const [cfg, setCfg] = useState<ZelloConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issuer, setIssuer] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [networkType, setNetworkType] = useState<"consumer" | "work">("consumer");
  const [networkName, setNetworkName] = useState("");
  const [defaultChannel, setDefaultChannel] = useState("");

  useEffect(() => {
    fetch("/api/zello/settings", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setCfg(data);
        setIssuer(data.issuer || "");
        setNetworkType(data.network_type || "consumer");
        setNetworkName(data.network_name || "");
        setDefaultChannel(data.default_channel || "");
      })
      .catch(() => setErr("Failed to load Zello settings"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setErr(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        issuer: issuer.trim(),
        network_type: networkType,
        network_name: networkType === "work" ? networkName.trim() : null,
        default_channel: defaultChannel.trim() || null,
      };
      if (privateKey.trim()) body.private_key = privateKey.trim();
      if (!cfg?.configured && !privateKey.trim()) {
        setErr("Private key is required for initial setup");
        setSaving(false);
        return;
      }
      // When re-saving without a new key, we need the existing one — server
      // requires it on every PUT. Ask user to paste it again.
      if (cfg?.configured && !privateKey.trim()) {
        setErr("Paste the private key again to save changes");
        setSaving(false);
        return;
      }
      const res = await fetch("/api/zello/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text);
      }
      const data = await res.json();
      setCfg({ ...data, private_key_preview: "(updated)" });
      setPrivateKey("");
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Remove Zello configuration?\n\nTeams will immediately lose the ability to mint Zello tokens.")) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/zello/settings", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      setCfg({ configured: false });
      setIssuer("");
      setPrivateKey("");
      setNetworkName("");
      setDefaultChannel("");
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-surface-800 border border-surface-700 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-1 text-fg-2">
        <Radio size={16} className="text-accent" />
        <h2 className="text-sm font-semibold uppercase tracking-wide">Zello Team Comms (BYOK)</h2>
      </div>
      <p className="text-xs text-fg-4 mb-4">
        Bring your own Zello developer credentials. We mint short-lived JWTs server-side;
        the browser PTT panel connects directly to Zello over WebSocket.
        {" "}
        <a
          href="https://developers.zello.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Get credentials →
        </a>
      </p>

      {loading ? (
        <p className="text-sm text-fg-4">Loading…</p>
      ) : !editing ? (
        <div className="space-y-3">
          {cfg?.configured ? (
            <>
              <div className="text-sm space-y-1.5">
                <div><span className="text-fg-4">Issuer:</span> <span className="font-mono text-fg-3">{cfg.issuer}</span></div>
                <div><span className="text-fg-4">Network:</span> <span className="text-fg-3">{cfg.network_type === "work" ? `Zello Work — ${cfg.network_name}` : "Zello Consumer"}</span></div>
                <div><span className="text-fg-4">Default channel:</span> <span className="text-fg-3">{cfg.default_channel || "(none — must pass per-request)"}</span></div>
                {cfg.updated_at && (
                  <div><span className="text-fg-4">Updated:</span> <span className="text-fg-3">{new Date(cfg.updated_at).toLocaleString()}</span></div>
                )}
              </div>
              {canEdit && (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 rounded transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded transition disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-fg-4">Not configured. Zello PTT panel is hidden from operations.</p>
              {canEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1.5 text-xs bg-accent text-black rounded hover:bg-accent/80 transition"
                >
                  Configure
                </button>
              )}
            </div>
          )}
          {!canEdit && <p className="text-xs text-fg-4 italic">Only team owners can edit this.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-fg-4 mb-1">Issuer (your Zello dev account ID)</label>
            <input
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="e.g. sar-ayrshire-001"
              className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm font-mono focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-fg-4 mb-1">
              RSA Private Key (PEM) {cfg?.configured && <span className="text-fg-3">— paste again to save</span>}
            </label>
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              rows={8}
              placeholder={"-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----"}
              className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-xs font-mono resize-y focus:outline-none focus:border-accent"
              spellCheck={false}
            />
            <p className="text-[10px] text-fg-4 mt-1">Encrypted at rest with AES-256-GCM.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-fg-4 mb-1">Network</label>
              <select
                value={networkType}
                onChange={(e) => setNetworkType(e.target.value as "consumer" | "work")}
                className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
              >
                <option value="consumer">Zello Consumer (zello.io)</option>
                <option value="work">Zello Work (zellowork.com)</option>
              </select>
            </div>
            {networkType === "work" && (
              <div>
                <label className="block text-xs text-fg-4 mb-1">Network Name</label>
                <input
                  value={networkName}
                  onChange={(e) => setNetworkName(e.target.value)}
                  placeholder="your-org"
                  className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-fg-4 mb-1">Default Channel</label>
            <input
              value={defaultChannel}
              onChange={(e) => setDefaultChannel(e.target.value)}
              placeholder="SAR Ops"
              className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
            />
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !issuer.trim()}
              className="px-4 py-2 text-sm bg-accent text-black rounded disabled:opacity-50 transition"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setErr(null); setPrivateKey(""); }}
              className="px-4 py-2 text-sm text-fg-3 hover:text-fg-1 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
