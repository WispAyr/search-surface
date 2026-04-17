"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/hooks/useAuth";
import { auth } from "@/lib/api";
import { ArrowLeft, Plus, Trash2, UserCog } from "lucide-react";

export default function MembersPage() {
  return (
    <AuthGate>
      <MembersInner />
    </AuthGate>
  );
}

interface TeamUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: string;
  last_login_at: string | null;
}

function MembersInner() {
  const router = useRouter();
  const { user } = useAuth();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const { users } = await auth.listTeamUsers();
      setUsers(users);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const canManage = user?.role === "owner";

  const handleRoleChange = async (u: TeamUser, role: string) => {
    try {
      await auth.setUserRole(u.id, role);
      await load();
    } catch (e) {
      alert(`Role change failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRemove = async (u: TeamUser) => {
    if (!confirm(`Remove ${u.email} from the team?\n\nThey'll lose access immediately.`)) return;
    try {
      await auth.removeUser(u.id);
      await load();
    } catch (e) {
      alert(`Remove failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!canManage) {
    return (
      <div className="min-h-screen bg-surface-900 text-fg-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-fg-3">Only team owners can manage members.</p>
          <button onClick={() => router.push("/")} className="text-accent text-sm hover:underline">Back to operations</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-900 text-fg-1">
      <header className="border-b border-surface-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/settings")}
            className="p-2 text-fg-4 hover:text-fg-1 transition"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-lg font-semibold">Team Members</h1>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-black rounded flex items-center gap-2 transition"
        >
          <Plus size={14} />
          Invite
        </button>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {err && <p className="text-red-400 text-sm mb-3">{err}</p>}
        {loading ? (
          <p className="text-sm text-fg-4">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-fg-4">No members yet.</p>
        ) : (
          <div className="bg-surface-800 border border-surface-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-700/50 text-fg-4 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">User</th>
                  <th className="text-left px-4 py-2 font-medium">Role</th>
                  <th className="text-left px-4 py-2 font-medium">Last login</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isMe = u.id === user?.id;
                  return (
                    <tr key={u.id} className="border-t border-surface-700">
                      <td className="px-4 py-3">
                        <div className="text-fg-1">{u.display_name || u.email}</div>
                        {u.display_name && <div className="text-xs text-fg-4">{u.email}</div>}
                        {isMe && <span className="text-[10px] text-accent">(you)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value)}
                          disabled={isMe}
                          className="bg-surface-700 border border-surface-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent disabled:opacity-60"
                        >
                          <option value="owner">Owner</option>
                          <option value="operator">Operator</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-4">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-2 py-3">
                        {!isMe && (
                          <button
                            onClick={() => handleRemove(u)}
                            className="p-1.5 rounded text-fg-4 hover:text-red-400 hover:bg-red-500/10 transition"
                            title="Remove"
                            aria-label={`Remove ${u.email}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-fg-4 flex items-center gap-1.5">
          <UserCog size={12} />
          <span>
            <strong className="text-fg-3">Owner</strong> = full control incl. billing & members.{" "}
            <strong className="text-fg-3">Operator</strong> = run & edit operations.{" "}
            <strong className="text-fg-3">Viewer</strong> = read-only.
          </span>
        </p>
      </div>

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onCreated={() => { setShowInvite(false); load(); }}
        />
      )}
    </div>
  );
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("operator");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    setErr(null);
    if (password.length < 8) { setErr("Password must be at least 8 characters"); return; }
    setSubmitting(true);
    try {
      await auth.inviteUser({ email: email.trim(), password, display_name: displayName.trim() || undefined, role });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 border border-surface-600 rounded-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-1">Invite member</h2>
        <p className="text-xs text-fg-4 mb-4">Set an initial password — share it with the member over a secure channel.</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-fg-4 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-fg-4 mb-1">Display name (optional)</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-fg-4 mb-1">Initial password</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min 8 chars"
              className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm font-mono focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-fg-4 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
            >
              <option value="operator">Operator — run & edit operations</option>
              <option value="viewer">Viewer — read-only</option>
              <option value="owner">Owner — full control</option>
            </select>
          </div>
        </div>

        {err && <p className="text-xs text-red-400 mt-3">{err}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-fg-3 hover:text-fg-1 transition">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!email.trim() || !password || submitting}
            className="px-4 py-2 text-sm bg-accent text-black rounded disabled:opacity-50 transition"
          >
            {submitting ? "Inviting…" : "Invite"}
          </button>
        </div>
      </div>
    </div>
  );
}
