"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/hooks/useAuth";
import {
  admin,
  type AdminOverview,
  type AdminTenantRow,
  type AdminUserRow,
  type AdminSession,
  type AdminActivity,
} from "@/lib/api";
import {
  ArrowLeft,
  Shield,
  Users,
  Building2,
  Activity,
  KeyRound,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

type Tab = "overview" | "tenants" | "users" | "sessions" | "activity";

export default function AdminPage() {
  return (
    <AuthGate>
      <AdminInner />
    </AuthGate>
  );
}

function AdminInner() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");

  if (!user) return null;
  if (!user.is_platform_admin) {
    return (
      <div className="min-h-screen bg-surface-900 text-fg-1 flex items-center justify-center">
        <div className="max-w-md text-center space-y-3 px-6">
          <Shield size={32} className="text-red-400 mx-auto" />
          <h1 className="text-lg font-semibold">Platform admin required</h1>
          <p className="text-sm text-fg-4">
            Your account ({user.email}) isn&apos;t on the platform admin allowlist. Ask whoever runs this instance to add you to PLATFORM_ADMIN_EMAILS.
          </p>
          <Link href="/" className="inline-block text-accent text-sm hover:underline">← Back to search-surface</Link>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "tenants", label: "Tenants", icon: Building2 },
    { id: "users", label: "Users", icon: Users },
    { id: "sessions", label: "Sessions", icon: KeyRound },
    { id: "activity", label: "Activity", icon: RefreshCw },
  ];

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
        <Shield size={18} className="text-accent" />
        <h1 className="text-lg font-semibold">Platform admin</h1>
        <span className="text-xs text-fg-4 ml-2">search.wispayr.online</span>
      </header>

      <nav className="border-b border-surface-700 px-6 flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2.5 text-sm border-b-2 transition ${
                active
                  ? "border-accent text-fg-1"
                  : "border-transparent text-fg-4 hover:text-fg-2"
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {tab === "overview" && <OverviewTab />}
        {tab === "tenants" && <TenantsTab />}
        {tab === "users" && <UsersTab />}
        {tab === "sessions" && <SessionsTab />}
        {tab === "activity" && <ActivityTab />}
      </div>
    </div>
  );
}

// ── Overview ──

function OverviewTab() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    admin.overview().then(setData).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="text-sm text-red-400">{err}</p>;
  if (!data) return <p className="text-sm text-fg-4">Loading…</p>;

  const maxUsers = Math.max(1, ...data.sparkline.map((d) => d.users));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Tenants" value={data.totals.tenants} sub={`+${data.tenants_new.d7} this week`} />
        <Stat label="Users" value={data.totals.users} sub={`+${data.signups.d7} this week`} />
        <Stat label="Active sessions" value={data.totals.sessions_active} sub={`${data.dau_24h} DAU (24h)`} />
        <Stat label="Operations" value={data.totals.operations} />
      </div>

      <section className="bg-surface-800 border border-surface-700 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-2">Signups — last 30 days</h2>
          <div className="text-xs text-fg-4">
            24h: <span className="text-fg-2">{data.signups.d1}</span>
            {" · "}
            7d: <span className="text-fg-2">{data.signups.d7}</span>
            {" · "}
            30d: <span className="text-fg-2">{data.signups.d30}</span>
          </div>
        </div>
        <div className="flex items-end gap-0.5 h-24">
          {data.sparkline.map((d) => (
            <div
              key={d.day}
              title={`${d.day} — ${d.users} user(s), ${d.tenants} tenant(s)`}
              className="flex-1 bg-accent/60 hover:bg-accent rounded-t transition"
              style={{ height: `${(d.users / maxUsers) * 100}%`, minHeight: d.users > 0 ? 2 : 0 }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-fg-4 font-mono">
          <span>{data.sparkline[0]?.day}</span>
          <span>{data.sparkline[data.sparkline.length - 1]?.day}</span>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
      <div className="text-xs text-fg-4 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-fg-1 mt-1">{value.toLocaleString()}</div>
      {sub && <div className="text-[11px] text-fg-4 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Tenants ──

function TenantsTab() {
  const router = useRouter();
  const [rows, setRows] = useState<AdminTenantRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    setErr(null);
    admin.tenants().then((r) => setRows(r.tenants)).catch((e) => setErr(String(e)));
  };
  useEffect(refresh, []);

  const handleDelete = async (t: AdminTenantRow) => {
    if (!confirm(`Delete tenant "${t.name}" (${t.slug})?\n\nThis cascades: ${t.user_count} user(s), ${t.op_count} operation(s), sessions — all wiped.`)) return;
    try {
      await admin.deleteTenant(t.id);
      refresh();
    } catch (e) {
      alert(String(e));
    }
  };

  if (err) return <p className="text-sm text-red-400">{err}</p>;
  if (!rows) return <p className="text-sm text-fg-4">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-fg-4">No tenants yet.</p>;

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-700/50 text-fg-4 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2">Tenant</th>
            <th className="text-left px-4 py-2">Plan</th>
            <th className="text-right px-4 py-2">Users</th>
            <th className="text-right px-4 py-2">Ops</th>
            <th className="text-right px-4 py-2">Sessions</th>
            <th className="text-left px-4 py-2">Created</th>
            <th className="text-left px-4 py-2">Last activity</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr
              key={t.id}
              onClick={() => router.push(`/admin/tenants/${t.id}`)}
              className="border-t border-surface-700 hover:bg-surface-700/30 cursor-pointer"
            >
              <td className="px-4 py-2">
                <div className="text-fg-1">{t.name}</div>
                <div className="text-[11px] font-mono text-fg-4">{t.slug}</div>
              </td>
              <td className="px-4 py-2"><PlanBadge plan={t.plan} /></td>
              <td className="px-4 py-2 text-right">{t.user_count}</td>
              <td className="px-4 py-2 text-right">{t.op_count}</td>
              <td className="px-4 py-2 text-right">{t.active_sessions}</td>
              <td className="px-4 py-2 text-fg-3">{fmtDate(t.created_at)}</td>
              <td className="px-4 py-2 text-fg-3">{fmtRelative(t.last_activity_at || t.last_login_at)}</td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(t); }}
                  className="p-1.5 text-fg-4 hover:text-red-400 transition"
                  title="Delete tenant"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const color = plan === "free" ? "bg-surface-700 text-fg-3"
    : plan === "legacy" ? "bg-amber-500/10 text-amber-300"
    : "bg-accent/10 text-accent";
  return <span className={`px-2 py-0.5 text-[11px] rounded ${color}`}>{plan}</span>;
}

// ── Users ──

function UsersTab() {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const refresh = (query: string) => {
    setErr(null);
    admin.users(query || undefined).then((r) => setRows(r.users)).catch((e) => setErr(String(e)));
  };
  useEffect(() => { refresh(""); }, []);

  const togglePlatformAdmin = async (u: AdminUserRow) => {
    const on = !u.is_platform_admin;
    if (!confirm(`${on ? "Grant" : "Revoke"} platform admin for ${u.email}?`)) return;
    try {
      await admin.patchUser(u.id, { is_platform_admin: on });
      refresh(q);
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && refresh(q)}
            placeholder="Search by email, name, tenant…"
            className="w-full pl-9 pr-3 py-2 bg-surface-800 border border-surface-700 rounded text-sm focus:outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={() => refresh(q)}
          className="px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded hover:border-accent transition"
        >
          Search
        </button>
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}
      {!rows ? (
        <p className="text-sm text-fg-4">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-4">No users match.</p>
      ) : (
        <div className="bg-surface-800 border border-surface-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-700/50 text-fg-4 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Tenant</th>
                <th className="text-left px-4 py-2">Role</th>
                <th className="text-left px-4 py-2">Signed up</th>
                <th className="text-left px-4 py-2">Last login</th>
                <th className="text-left px-4 py-2">Platform</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-surface-700 hover:bg-surface-700/30">
                  <td className="px-4 py-2">
                    <div className="text-fg-1">{u.email}</div>
                    {u.display_name && <div className="text-[11px] text-fg-4">{u.display_name}</div>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-fg-2">{u.tenant_name}</div>
                    <div className="text-[11px] font-mono text-fg-4">{u.tenant_slug}</div>
                  </td>
                  <td className="px-4 py-2 capitalize text-fg-3">{u.role}</td>
                  <td className="px-4 py-2 text-fg-3">{fmtDate(u.created_at)}</td>
                  <td className="px-4 py-2 text-fg-3">{u.last_login_at ? fmtRelative(u.last_login_at) : "—"}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => togglePlatformAdmin(u)}
                      disabled={u.id === me?.id}
                      title={u.id === me?.id ? "Use PLATFORM_ADMIN_EMAILS env to change your own flag" : undefined}
                      className={`px-2 py-0.5 text-[11px] rounded transition ${
                        u.is_platform_admin
                          ? "bg-accent/10 text-accent hover:bg-accent/20"
                          : "bg-surface-700 text-fg-4 hover:text-fg-2"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {u.is_platform_admin ? "admin" : "grant"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sessions ──

function SessionsTab() {
  const [rows, setRows] = useState<AdminSession[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    setErr(null);
    admin.sessions().then((r) => setRows(r.sessions)).catch((e) => setErr(String(e)));
  };
  useEffect(refresh, []);

  if (err) return <p className="text-sm text-red-400">{err}</p>;
  if (!rows) return <p className="text-sm text-fg-4">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-fg-4">No active sessions.</p>;

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-700/50 text-fg-4 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2">User</th>
            <th className="text-left px-4 py-2">Tenant</th>
            <th className="text-left px-4 py-2">Created</th>
            <th className="text-left px-4 py-2">Last seen</th>
            <th className="text-left px-4 py-2">Expires</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.token_preview + s.user_id} className="border-t border-surface-700 hover:bg-surface-700/30">
              <td className="px-4 py-2">
                <div className="text-fg-1">{s.email}</div>
                <div className="text-[11px] text-fg-4 capitalize">{s.role}</div>
              </td>
              <td className="px-4 py-2">
                <div className="text-fg-2">{s.tenant_name}</div>
                <div className="text-[11px] font-mono text-fg-4">{s.tenant_slug}</div>
              </td>
              <td className="px-4 py-2 text-fg-3">{fmtDate(s.created_at)}</td>
              <td className="px-4 py-2 text-fg-3">{fmtRelative(s.last_seen_at)}</td>
              <td className="px-4 py-2 text-fg-3">{fmtDate(s.expires_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Activity ──

function ActivityTab() {
  const [rows, setRows] = useState<AdminActivity[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    admin.activity().then((r) => setRows(r.events)).catch((e) => setErr(String(e)));
  }, []);

  const grouped = useMemo(() => {
    if (!rows) return null;
    const by = new Map<string, AdminActivity[]>();
    for (const e of rows) {
      const day = e.at.slice(0, 10);
      const list = by.get(day) || [];
      list.push(e);
      by.set(day, list);
    }
    return Array.from(by.entries());
  }, [rows]);

  if (err) return <p className="text-sm text-red-400">{err}</p>;
  if (!grouped) return <p className="text-sm text-fg-4">Loading…</p>;
  if (grouped.length === 0) return <p className="text-sm text-fg-4">No activity yet.</p>;

  return (
    <div className="space-y-5">
      {grouped.map(([day, events]) => (
        <section key={day}>
          <h3 className="text-xs uppercase tracking-wider text-fg-4 mb-2 font-mono">{day}</h3>
          <div className="bg-surface-800 border border-surface-700 rounded-lg divide-y divide-surface-700">
            {events.map((e, i) => (
              <div key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                  e.kind === "signup" ? "bg-accent/10 text-accent" : "bg-surface-700 text-fg-4"
                }`}>
                  {e.kind}
                </span>
                <span className="text-fg-1">{e.email}</span>
                <span className="text-fg-4">in</span>
                <span className="text-fg-2">{e.tenant_name}</span>
                <span className="font-mono text-[11px] text-fg-4">({e.tenant_slug})</span>
                <span className="ml-auto text-[11px] text-fg-4 font-mono">{fmtTime(e.at)}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Date helpers ──

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}
