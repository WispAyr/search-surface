"use client";

// Registers the /field/-scoped service worker (once), tracks online state, and
// renders a compact status pill. The field page uses the queue transparently;
// this just surfaces what's happening so the driver can trust it.

import { useEffect, useState } from "react";
import { Wifi, WifiOff, Loader2, AlertTriangle } from "lucide-react";
import { drain, subscribe } from "@/lib/offline-queue";

export function OfflineBar() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => subscribe(setPending), []);

  useEffect(() => {
    if (!online || pending === 0) return;
    setSyncing(true);
    drain().finally(() => setSyncing(false));
  }, [online, pending]);

  if (online && pending === 0) {
    return null;
  }

  let bg = "bg-amber-500/15 border-amber-500/40 text-amber-200";
  let Icon = WifiOff;
  let label: string;
  if (!online && pending > 0) {
    label = `Offline · ${pending} queued`;
    bg = "bg-red-500/15 border-red-500/40 text-red-200";
    Icon = AlertTriangle;
  } else if (!online) {
    label = "Offline · tracking locally";
    Icon = WifiOff;
  } else if (syncing) {
    label = `Syncing ${pending}…`;
    bg = "bg-sky-500/15 border-sky-500/40 text-sky-200";
    Icon = Loader2;
  } else {
    label = `${pending} queued`;
    Icon = Wifi;
  }

  return (
    <div className={`mx-4 mt-2 px-3 py-1.5 border rounded text-[11px] font-medium inline-flex items-center gap-2 ${bg}`}>
      <Icon size={12} className={syncing ? "animate-spin" : ""} />
      <span>{label}</span>
    </div>
  );
}
