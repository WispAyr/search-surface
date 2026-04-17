"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/hooks/useAuth";
import { admin } from "@/lib/api";
import { ArrowLeft, Shield, Building2, Users, Activity, KeyRound } from "lucide-react";

type TenantDetail = Awaited<ReturnType<typeof admin.tenant>>;

export default function AdminTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AuthGate>
      <TenantDetailInner id={id} />
    </AuthGate>
  );
}

function TenantDetailInner({ id }: { id: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<TenantDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  useEffect(() => {
    admin.tenant(id).then(setData).catch((e) => setErr(String(e)));
  }, [id]);

  if (!user) return null;
  if (!user.is_platform_admin) {
    return (
      <div className="min-h-screen bg-surface-900 text-fg-1 flex items-center justify-center">
        <div className="text-center space-y-3 px-6">
          <Shield size={32} className="text-red-400 mx-auto" />
          <h1 className="text-lg font-semibold">Platform admin required</h1>
          <Link href="/" className="text-accent text-sm hover:underline">← Back</Link>
        </div>
      </div>
    );
  }

  const changePlan = async (plan: string) => {
    if (!data) return;
    setSavingPlan(true);
    try {
      await admin.patchTenant(id, { plan });
      const fresh = await admin.tenant(id);
      setData(fresh);
    } catch (e) {
      alert(String(e));
    } finally {
      setSavingPlan(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-900 text-fg-1">
      <header className="border-b border-surface-700 px-6 py-4 flex items-center gap-3">
        <button onClick={() => router.push("/admin")} className="p-2 text-fg-4 hover:text-fg-1 transition" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <Shield size={18} className="text-accent" />
        <h1 className="text-lg font-semibold">Tenant detail</h1>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {err && <p className="text-sm text-red-400">{err}</p>}
        {!data ? (
          <p className="text-sm text-fg-4">Loading…</p>
        ) : (
          <>
            <section className="bg-surface-800 border border-surface-700 rounded-lg p-5">
              <div className="flex items-center gap-2 mb-3 text-fg-2">
                <Building2 size={16} className="text-accent" />
                <h2 className="text-sm font-semibold uppercase tracking-wide">{data.tenant.name}</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-xs text-fg-4 uppercase tracking-wide">Slug</div>
                  <div className="font-mono text-fg-2">{data.tenant.slug}</div>
                </div>
                <div>
                  <div className="text-xs text-fg-4 uppercase tracking-wide">Plan</div>
                  <select
                    value={data.tenant.plan}
                    onChange={(e) => changePlan(e.target.value)}
                    disabled={savingPlan}
                    className="mt-0.5 bg-surface-700 border border-surface-600 rounded px-2 py-0.5 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="legacy">legacy</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-fg-4 uppercase tracking-wide">Created</div>
                  <div className="text-fg-2">{new Date(data.tenant.created_at).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-fg-4 uppercase tracking-wide">Active sessions</div>
                  <div className="text-fg-2">{data.active_sessions}</div>
                </div>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3 text-fg-2">
                <Activity size={16} className="text-accent" />
                <h2 className="text-sm font-semibold uppercase tracking-wide">Operations ({data.operations.length})</h2>
              </div>
              {data.operations.length === 0 ? (
                <p className="text-sm text-fg-4 italic">This tenant has no operations.</p>
              ) : (
                <div className="bg-surface-800 border border-surface-700 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-700/50 text-fg-4 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-2">Name</th>
                        <th className="text-left px-4 py-2">Type</th>
                        <th className="text-left px-4 py-2">Status</th>
                        <th className="text-right px-4 py-2">Zones</th>
                        <th className="text-right px-4 py-2">Teams</th>
                        <th className="text-right px-4 py-2">Reports</th>
                        <th className="text-left px-4 py-2">Updated</th>
                        <th className="text-left px-4 py-2">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.operations.map((o) => (
                        <tr key={o.id} className="border-t border-surface-700 hover:bg-surface-700/30">
                          <td className="px-4 py-2 text-fg-1">{o.name}</td>
                          <td className="px-4 py-2 text-fg-3 capitalize">{o.type.replace(/_/g, " ")}</td>
                          <td className="px-4 py-2"><StatusBadge status={o.status} /></td>
                          <td className="px-4 py-2 text-right">{o.zone_count}</td>
                          <td className="px-4 py-2 text-right">{o.team_count}</td>
                          <td className="px-4 py-2 text-right">{o.report_count}</td>
                          <td className="px-4 py-2 text-fg-3">{new Date(o.updated_at).toLocaleDateString()}</td>
                          <td className="px-4 py-2 text-fg-3">{o.created_by || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-fg-4 mt-2 italic">
                View-only. Operations are tenant-scoped — open them by signing in as a member of this tenant.
              </p>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3 text-fg-2">
                <Users size={16} className="text-accent" />
                <h2 className="text-sm font-semibold uppercase tracking-wide">Users ({data.users.length})</h2>
              </div>
              <div className="bg-surface-800 border border-surface-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface-700/50 text-fg-4 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-2">Email</th>
                      <th className="text-left px-4 py-2">Role</th>
                      <th className="text-left px-4 py-2">Signed up</th>
                      <th className="text-left px-4 py-2">Last login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id} className="border-t border-surface-700">
                        <td className="px-4 py-2 text-fg-1">{u.email}</td>
                        <td className="px-4 py-2 capitalize text-fg-3">{u.role}{u.is_platform_admin ? " · admin" : ""}</td>
                        <td className="px-4 py-2 text-fg-3">{new Date(u.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-2 text-fg-3">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, string> = {
    planning: "bg-blue-500/10 text-blue-300",
    active: "bg-green-500/10 text-green-300",
    suspended: "bg-amber-500/10 text-amber-300",
    completed: "bg-surface-700 text-fg-4",
    stood_down: "bg-surface-700 text-fg-4",
  };
  return <span className={`px-2 py-0.5 text-[11px] rounded capitalize ${c[status] || "bg-surface-700 text-fg-4"}`}>{status.replace(/_/g, " ")}</span>;
}
