"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { onAuthFailure } from "@/lib/api";

// Wraps authed pages. Redirects unauthed users to /login?next=<current path>.
// Also listens for 401s from API calls and redirects automatically (handles
// mid-session logout/expiry without reload).
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  useEffect(() => {
    onAuthFailure(() => {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    });
  }, [router, pathname]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center text-fg-4 text-sm">
        Loading…
      </div>
    );
  }
  if (status === "anonymous") return null; // redirect in-flight
  return <>{children}</>;
}
