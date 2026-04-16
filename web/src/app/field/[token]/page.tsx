"use client";

// Field-team / driver view for search.wispayr.online.
// Accessed via a per-team token URL that the controller hands to the team
// on deploy (printed on cards, SMS'd, or QR'd). No admin auth — just the
// token in the URL. Shows the assigned zone, the street-clear checklist,
// and (for vehicle teams) the OSRM driving route through the zone.

import { useEffect, useState, useRef, use } from "react";
import dynamic from "next/dynamic";
import { search } from "@/lib/api";
import type { SearchStreetItem, SearchTeam } from "@/types/search";
import { Check, Truck, MapPin, AlertTriangle, RefreshCw, Navigation } from "lucide-react";

// Leaflet must load client-side only.
const RouteMap = dynamic(() => import("./RouteMap").then((m) => m.RouteMap), {
  ssr: false,
});

interface FieldContext {
  team: SearchTeam;
  operation: {
    id: string;
    name: string;
    type: string;
    status: string;
    subject_info: Record<string, unknown> | null;
    datum_lat: number | null;
    datum_lon: number | null;
  };
  assigned_zones: Array<{ id: string; name: string; status: string; notes?: string | null }>;
  street_checklist: SearchStreetItem[];
  vehicle_route: {
    geometry: GeoJSON.LineString;
    meta: { distance_m: number; duration_s: number } | null;
  } | null;
}

const POLL_MS = 8000;
// Silent background check-in cadence for deployed teams. Pairs with the 15-min
// controller-side silent-team alarm (three missed pings before we warn). Kept
// separate from the manual check-in button so drivers can also checkin on demand.
const AUTO_CHECKIN_MS = 5 * 60 * 1000;

export default function FieldPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [ctx, setCtx] = useState<FieldContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  async function load() {
    try {
      const r = await fetch(`/api/search/field/context?token=${encodeURIComponent(token)}`);
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      const data = (await r.json()) as FieldContext;
      if (!mountedRef.current) return;
      setCtx(data);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleStreet(streetName: string, nextCleared: boolean) {
    if (!ctx) return;
    setPending((p) => new Set(p).add(streetName));
    // Optimistic update
    setCtx((c) => c ? {
      ...c,
      street_checklist: c.street_checklist.map((s) =>
        s.name === streetName
          ? { ...s, cleared_at: nextCleared ? new Date().toISOString() : null, cleared_by: nextCleared ? (c.team.callsign || c.team.name) : null }
          : s
      ),
    } : c);
    try {
      await search.markStreetCleared(ctx.team.id, streetName, nextCleared, token);
    } catch (e) {
      // Revert on failure
      await load();
      alert(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(streetName); return n; });
    }
  }

  // Shared checkin implementation. `silent` mode suppresses alerts and the
  // follow-up reload — used by the auto-checkin interval to avoid spamming
  // the driver with popups or refreshing state they might be reading.
  async function doCheckin({ silent }: { silent: boolean }) {
    if (!ctx) return;
    if (!("geolocation" in navigator)) {
      if (!silent) alert("Location not supported on this device");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await fetch(`/api/search/field/checkin?token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          });
          if (!silent) await load();
        } catch (e) {
          if (!silent) alert(`Check-in failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      (err) => { if (!silent) alert(`Location error: ${err.message}`); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: silent ? 60000 : 0 },
    );
  }

  async function checkin() { await doCheckin({ silent: false }); }

  // Auto-checkin while deployed. Uses a ref to avoid missing state from the
  // interval closure, and fires once on mount (after context loads) so the
  // first ping lands promptly even if the team just became deployed.
  useEffect(() => {
    if (!ctx) return;
    const deployed = ctx.team.status === "deployed" || ctx.team.status === "returning";
    if (!deployed) return;
    doCheckin({ silent: true });
    const id = setInterval(() => doCheckin({ silent: true }), AUTO_CHECKIN_MS);
    return () => clearInterval(id);
  }, [ctx?.team.status, ctx?.team.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !ctx) {
    return (
      <div className="min-h-screen bg-surface-900 text-fg-1 flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <AlertTriangle size={32} className="mx-auto text-red-400 mb-3" />
          <h1 className="text-lg font-semibold mb-2">Can&apos;t load team data</h1>
          <p className="text-fg-4 text-sm break-words">{error}</p>
          <button
            onClick={load}
            className="mt-4 px-4 py-2 bg-accent text-black rounded text-sm inline-flex items-center gap-2"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="min-h-screen bg-surface-900 text-fg-4 text-sm flex items-center justify-center">
        Loading…
      </div>
    );
  }

  const cleared = ctx.street_checklist.filter((s) => s.cleared_at).length;
  const total = ctx.street_checklist.length;
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0;
  const zone = ctx.assigned_zones[0] || null;
  const isVehicle = (ctx.team.capability || "").toLowerCase().includes("vehicle");

  return (
    <div className="min-h-screen bg-surface-900 text-fg-1 pb-24">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-surface-900/95 backdrop-blur border-b border-surface-700">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {isVehicle ? <Truck size={16} className="text-accent" /> : <MapPin size={16} className="text-accent" />}
                <h1 className="font-semibold truncate">{ctx.team.callsign || ctx.team.name}</h1>
              </div>
              <p className="text-xs text-fg-4 truncate">{ctx.operation.name}</p>
            </div>
            <button
              onClick={checkin}
              className="shrink-0 px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 rounded inline-flex items-center gap-1"
              title="Share current position"
            >
              <Navigation size={12} /> Check-in
            </button>
          </div>
        </div>
        {/* Progress strip */}
        {total > 0 && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-[11px] text-fg-4 mb-1">
              <span>{zone ? `${zone.name} · street clear` : "street clear"}</span>
              <span className="font-mono">{cleared}/{total} · {pct}%</span>
            </div>
            <div className="h-1.5 bg-surface-700 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="p-4 space-y-4">
        {!zone && (
          <div className="p-4 bg-surface-800 border border-surface-700 rounded text-sm text-fg-3">
            <p className="font-medium mb-1">Standing by</p>
            <p className="text-fg-4 text-xs">
              Waiting for the controller to assign you to a zone. This page refreshes
              automatically.
            </p>
          </div>
        )}

        {/* Vehicle route (if present) */}
        {isVehicle && ctx.vehicle_route && (
          <section>
            <h2 className="text-[10px] uppercase tracking-wide text-fg-4 mb-2">
              Driving route{ctx.vehicle_route.meta ? ` — ${(ctx.vehicle_route.meta.distance_m / 1000).toFixed(1)} km · ${Math.round(ctx.vehicle_route.meta.duration_s / 60)} min` : ""}
            </h2>
            <div className="h-56 rounded overflow-hidden border border-surface-700">
              <RouteMap
                geometry={ctx.vehicle_route.geometry}
                datum={ctx.operation.datum_lat != null && ctx.operation.datum_lon != null
                  ? [ctx.operation.datum_lat, ctx.operation.datum_lon]
                  : null}
              />
            </div>
          </section>
        )}

        {/* Checklist */}
        {total > 0 && (
          <section>
            <h2 className="text-[10px] uppercase tracking-wide text-fg-4 mb-2">
              Street-clear checklist
            </h2>
            <ul className="divide-y divide-surface-700 border border-surface-700 rounded overflow-hidden">
              {ctx.street_checklist.map((s) => {
                const isCleared = !!s.cleared_at;
                const isPending = pending.has(s.name);
                return (
                  <li key={s.name}>
                    <button
                      onClick={() => toggleStreet(s.name, !isCleared)}
                      disabled={isPending}
                      className={`w-full flex items-center gap-3 px-3 py-3 text-left transition ${
                        isCleared
                          ? "bg-emerald-500/10 hover:bg-emerald-500/15"
                          : "bg-surface-800 hover:bg-surface-700"
                      } ${isPending ? "opacity-60" : ""}`}
                    >
                      <span
                        className={`shrink-0 w-6 h-6 rounded border flex items-center justify-center ${
                          isCleared
                            ? "bg-emerald-500 border-emerald-500"
                            : "border-surface-500 bg-surface-900"
                        }`}
                      >
                        {isCleared && <Check size={14} className="text-black" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm truncate ${isCleared ? "line-through text-fg-4" : ""}`}>
                          {s.name}
                        </div>
                        {isCleared && s.cleared_at && (
                          <div className="text-[10px] text-emerald-400/80">
                            ✓ {new Date(s.cleared_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {s.cleared_by ? ` · ${s.cleared_by}` : ""}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {zone && total === 0 && (
          <div className="p-4 bg-surface-800 border border-surface-700 rounded text-sm text-fg-3">
            <p className="font-medium mb-1">Generating checklist…</p>
            <p className="text-fg-4 text-xs">
              Streets in <span className="text-fg-2">{zone.name}</span> are being
              pulled from OSM. This usually takes 5-20s. The page will refresh
              automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
