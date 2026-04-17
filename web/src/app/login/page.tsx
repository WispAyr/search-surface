"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Search, Loader2 } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-900" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const redirect = search.get("next") || "/";
  const { status, login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [multiTenants, setMultiTenants] = useState<Array<{ slug: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace(redirect);
  }, [status, redirect, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password, tenantSlug || undefined);
      router.replace(redirect);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      // API 409 returns a JSON body with tenants[] — fish it out of the message string.
      const match = msg.match(/API 409:\s*(\{.*\})/);
      if (match) {
        try {
          const body = JSON.parse(match[1]);
          if (Array.isArray(body.tenants)) {
            setMultiTenants(body.tenants);
            setError("Multiple teams use this email — pick one to continue.");
            return;
          }
        } catch {}
      }
      setError(msg.replace(/^API \d+:\s*/, "").replace(/^\{.*"error":\s*"([^"]+)".*\}$/, "$1"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-900 text-fg-1 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <Search size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Search Ops</h1>
        </div>

        <form onSubmit={onSubmit} className="bg-surface-800 border border-surface-700 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-medium">Sign in</h2>

          <div>
            <label className="block text-xs text-fg-4 mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              autoFocus
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
            />
          </div>

          {multiTenants.length > 0 && (
            <div>
              <label className="block text-xs text-fg-4 mb-1">Team</label>
              <select
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                required
                className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
              >
                <option value="">Choose a team…</option>
                {multiTenants.map((t) => (
                  <option key={t.slug} value={t.slug}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full bg-accent hover:bg-accent/80 disabled:opacity-50 text-black text-sm font-medium py-2 rounded flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Sign in
          </button>

          <div className="text-center text-xs text-fg-4 pt-2 border-t border-surface-700">
            New team?{" "}
            <Link href="/signup" className="text-accent hover:underline">Create an account</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
