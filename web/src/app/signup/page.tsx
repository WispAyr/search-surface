"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Search, Loader2 } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const { status, signup } = useAuth();

  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signup({
        email: email.trim(),
        password,
        tenant_name: tenantName.trim(),
        display_name: displayName.trim() || undefined,
      });
      router.replace("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signup failed";
      setError(msg.replace(/^API \d+:\s*/, "").replace(/^\{.*"error":\s*"([^"]+)".*\}$/, "$1"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-900 text-fg-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <Search size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Search Ops</h1>
        </div>

        <form onSubmit={onSubmit} className="bg-surface-800 border border-surface-700 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-base font-medium">Create your team</h2>
            <p className="text-xs text-fg-4 mt-1">You'll be the owner and can invite operators and viewers afterwards.</p>
          </div>

          <div>
            <label className="block text-xs text-fg-4 mb-1">Team / Organisation</label>
            <input
              required
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              placeholder="e.g. Ayr Mountain Rescue"
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-fg-4 mb-1">Your name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-fg-4 mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-fg-4 mb-1">Password</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
            />
            <p className="text-[11px] text-fg-4 mt-1">Minimum 8 characters.</p>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={loading || !tenantName || !email || password.length < 8}
            className="w-full bg-accent hover:bg-accent/80 disabled:opacity-50 text-black text-sm font-medium py-2 rounded flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Create team
          </button>

          <div className="text-center text-xs text-fg-4 pt-2 border-t border-surface-700">
            Already have an account?{" "}
            <Link href="/login" className="text-accent hover:underline">Sign in</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
