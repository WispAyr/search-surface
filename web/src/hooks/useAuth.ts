"use client";

import { useCallback, useEffect, useState } from "react";
import { auth, type AuthUser } from "@/lib/api";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "authenticated"; user: AuthUser }
  | { status: "anonymous"; user: null };

// Module-scope cache + subscribers so every hook instance shares one fetch and
// every component sees auth transitions live (login/logout doesn't need a reload).
let cached: AuthState = { status: "loading", user: null };
const listeners = new Set<(s: AuthState) => void>();
let inflight: Promise<void> | null = null;

function setState(next: AuthState) {
  cached = next;
  for (const fn of listeners) fn(next);
}

async function loadOnce(force = false): Promise<void> {
  if (!force && cached.status !== "loading") return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { user } = await auth.me();
      setState(user ? { status: "authenticated", user } : { status: "anonymous", user: null });
    } catch {
      setState({ status: "anonymous", user: null });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useAuth() {
  const [state, setLocal] = useState<AuthState>(cached);

  useEffect(() => {
    listeners.add(setLocal);
    if (cached.status === "loading") loadOnce();
    else setLocal(cached);
    return () => { listeners.delete(setLocal); };
  }, []);

  const refresh = useCallback(() => loadOnce(true), []);

  const login = useCallback(async (email: string, password: string, tenant_slug?: string) => {
    const res = await auth.login({ email, password, tenant_slug });
    setState({ status: "authenticated", user: res.user });
    return res.user;
  }, []);

  const signup = useCallback(async (data: { email: string; password: string; tenant_name: string; display_name?: string }) => {
    const res = await auth.signup(data);
    setState({ status: "authenticated", user: res.user });
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await auth.logout().catch(() => {});
    setState({ status: "anonymous", user: null });
  }, []);

  return { ...state, refresh, login, signup, logout };
}
