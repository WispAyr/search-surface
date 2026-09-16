"use client";

// Field-team / driver view for search.wispayr.online.
// Accessed via a per-team token URL that the controller hands to the team
// on deploy (printed on cards, SMS'd, or QR'd). No admin auth — just the
// token in the URL. Shows the assigned zone, the street-clear checklist,
// and (for vehicle teams) the OSRM driving route through the zone.

import { useEffect, useState, useRef, use } from "react";
import dynamic from "next/dynamic";
import type { SearchStreetItem, SearchTeam } from "@/types/search";
import { Check, Truck, MapPin, AlertTriangle, RefreshCw, Crosshair } from "lucide-react";
import { enqueue, drain } from "@/lib/offline-queue";
import { search } from "@/lib/api";
import { OfflineBar } from "./OfflineBar";
import { FieldActionBar } from "./FieldActionBar";
import { ReportSheet, type QuickReportType } from "./ReportSheet";

// Leaflet must load client-side only.
const ZoneMap = dynamic(() => import("./ZoneMap").then((m) => m.ZoneMap), {
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
    identity_mode: "team" | "prompt" | "required";
  };
  // Hybrid identity: populated when the device holds a valid sub-token. null
  // means the device is reporting as the team (anon) — server still accepts
  // this unless identity_mode='required'.
  member: { id: string; name: string } | null;
  assigned_zones: Array<{
    id: string;
    name: string;
    status: string;
    notes?: string | null;
    geometry?: GeoJSON.Feature | GeoJSON.Geometry | null;
  }>;
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

// localStorage key scoped to the team token so multiple teams on the same
// device don't collide. When the IC rotates a team the old entry simply stops
// matching (sub-token belongs to the wrong team_id) and the server returns
// member=null — prompting the user to re-identify.
function memberTokenKey(token: string) { return `search-member-token:${token}`; }
function memberNameKey(token: string) { return `search-member-name:${token}`; }

export default function FieldPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [ctx, setCtx] = useState<FieldContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [lastFix, setLastFix] = useState<[number, number] | null>(null);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  // Hybrid identity. memberToken is the sub-token this device holds (if any);
  // memberName mirrors it for the header pill. showIdentify gates the first-
  // load modal; it opens when the server reports identity_mode != 'team' and
  // we have no sub-token yet, or when the member taps the pill to rename.
  const [memberToken, setMemberToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return localStorage.getItem(memberTokenKey(token)); } catch { return null; }
  });
  const [memberName, setMemberName] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return localStorage.getItem(memberNameKey(token)); } catch { return null; }
  });
  const [showIdentify, setShowIdentify] = useState(false);
  // "unknown" = haven't tried; "ok" = last attempt succeeded; "denied" = permission
  // denied (unrecoverable without user action); "unavailable" = GPS off or no fix
  // in time. Tracked separately from toast because silent auto-checkin failures
  // shouldn't spam the driver but SHOULD surface in the status pill.
  const [gpsStatus, setGpsStatus] = useState<"unknown" | "ok" | "denied" | "unavailable">("unknown");
  const mountedRef = useRef(true);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Register the /field/-scoped service worker once — unconditional so it still
  // installs on the error / loading branches (that's exactly when offline
  // caching matters most).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/field/" })
      .catch((e) => console.warn("[field] SW register failed:", e));
  }, []);

  // Cache key for last-known context — lets the page render useful content on
  // cold-load when offline (after at least one successful online load).
  const ctxKey = `search-field-ctx:${token}`;

  async function load() {
    try {
      const memberQs = memberToken ? `&member_token=${encodeURIComponent(memberToken)}` : "";
      const r = await fetch(`/api/search/field/context?token=${encodeURIComponent(token)}${memberQs}`);
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      const data = (await r.json()) as FieldContext;
      if (!mountedRef.current) return;
      setCtx(data);
      setError(null);
      // If the server didn't resolve our sub-token (team rotated, member row
      // removed, or none stored), clear local state so the prompt fires clean.
      if (!data.member && memberToken) {
        try { localStorage.removeItem(memberTokenKey(token)); localStorage.removeItem(memberNameKey(token)); } catch {}
        setMemberToken(null);
        setMemberName(null);
      } else if (data.member) {
        // Server is source of truth for the display name; keep local mirror in sync.
        if (data.member.name !== memberName) {
          setMemberName(data.member.name);
          try { localStorage.setItem(memberNameKey(token), data.member.name); } catch {}
        }
      }
      // First-load prompt: only when the op isn't team-only and we're not named in.
      const mode = data.operation.identity_mode || "prompt";
      if (!data.member && mode !== "team" && !memberToken) {
        setShowIdentify(true);
      }
      try { localStorage.setItem(ctxKey, JSON.stringify(data)); } catch {}
      // Opportunistic drain — any queued mutations ride out on successful fetch.
      drain().catch(() => {});
    } catch (e) {
      if (!mountedRef.current) return;
      // Offline (or first-render) fallback: try cached snapshot.
      try {
        const raw = localStorage.getItem(ctxKey);
        if (raw) {
          const cached = JSON.parse(raw) as FieldContext;
          if (!ctx) setCtx(cached);
          setError(null);
          return;
        }
      } catch {}
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flash toast for 3 s.
  function flash(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    setTimeout(() => { if (mountedRef.current) setToast(null); }, 3000);
  }

  async function toggleStreet(streetName: string, nextCleared: boolean) {
    if (!ctx) return;
    setPending((p) => new Set(p).add(streetName));
    const nowIso = new Date().toISOString();
    setCtx((c) => {
      if (!c) return c;
      const next = {
        ...c,
        street_checklist: c.street_checklist.map((s) =>
          s.name === streetName
            ? { ...s, cleared_at: nextCleared ? nowIso : null, cleared_by: nextCleared ? (c.team.callsign || c.team.name) : null }
            : s
        ),
      };
      try { localStorage.setItem(ctxKey, JSON.stringify(next)); } catch {}
      return next;
    });
    const memberQs = memberToken ? `&member_token=${encodeURIComponent(memberToken)}` : "";
    await enqueue({
      kind: "street",
      url: `/api/search/teams/${ctx.team.id}/streets/${encodeURIComponent(streetName)}?token=${encodeURIComponent(token)}${memberQs}`,
      method: "PATCH",
      body: { cleared: nextCleared },
      client_ts: nowIso,
      dedup: `street:${ctx.team.id}:${streetName}`,
    });
    setPending((p) => { const n = new Set(p); n.delete(streetName); return n; });
  }

  // Promise-wrapped geolocation so the action flows can await a fresh fix
  // before posting. iOS triggers the permission prompt on the *first* call;
  // subsequent calls reuse the grant.
  function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        setGpsStatus("unavailable");
        reject(new Error("Location not supported on this device"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (mountedRef.current) {
            setGpsStatus("ok");
            setLastFix([pos.coords.latitude, pos.coords.longitude]);
            setLastFixAt(Date.now());
          }
          resolve(pos);
        },
        (err) => {
          if (mountedRef.current) {
            // PERMISSION_DENIED=1 is distinct from POSITION_UNAVAILABLE=2 /
            // TIMEOUT=3 — denial needs a different CTA (open browser settings)
            // vs "try again" / "go outside".
            setGpsStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
          }
          reject(err);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      );
    });
  }

  async function doCheckin({ silent }: { silent: boolean }) {
    if (!ctx) return;
    try {
      const pos = await getPosition();
      const memberQs = memberToken ? `&member_token=${encodeURIComponent(memberToken)}` : "";
      await enqueue({
        kind: "checkin",
        url: `/api/search/field/checkin?token=${encodeURIComponent(token)}${memberQs}`,
        method: "POST",
        body: { lat: pos.coords.latitude, lon: pos.coords.longitude },
        client_ts: new Date().toISOString(),
        dedup: `checkin:${token}`,
      });
      if (!silent) {
        flash("ok", "Position sent");
        await load();
      }
    } catch (err) {
      // Surface the error whether manual or silent — silent auto-checkin
      // failures still need a toast the first time so the driver knows
      // GPS is off. The status pill then carries the ongoing signal.
      const msg = err instanceof Error ? err.message : String(err);
      if (!silent) flash("err", msg);
      else if (gpsStatus !== "denied" && gpsStatus !== "unavailable") flash("err", `GPS: ${msg}`);
    }
  }

  async function handleCheckin() {
    setBusy(true);
    await doCheckin({ silent: false });
    setBusy(false);
  }

  // Auto-checkin while deployed. This also triggers the iOS permission prompt
  // the first time the team becomes deployed — before this refactor the prompt
  // only appeared if the driver tapped check-in, which a lot of them never do.
  useEffect(() => {
    if (!ctx) return;
    const deployed = ctx.team.status === "deployed" || ctx.team.status === "returning";
    if (!deployed) return;
    doCheckin({ silent: true });
    const id = setInterval(() => doCheckin({ silent: true }), AUTO_CHECKIN_MS);
    return () => clearInterval(id);
  }, [ctx?.team.status, ctx?.team.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Photo upload — iOS only surfaces the camera permission dialog when the
  // user taps a file input with capture="environment", so we keep the input
  // hidden and trigger it from the Photo button.
  async function onPhotoPicked(file: File) {
    if (!ctx) return;
    setBusy(true);
    let lat: number | null = null;
    let lon: number | null = null;
    try {
      const pos = await getPosition();
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
    } catch { /* Photos without GPS are still useful; submit anyway. */ }
    try {
      const form = new FormData();
      form.append("photo", file);
      if (lat !== null) form.append("lat", String(lat));
      if (lon !== null) form.append("lon", String(lon));
      const zoneId = ctx.assigned_zones[0]?.id;
      if (zoneId) form.append("zone_id", zoneId);
      form.append("description", `Field photo from ${ctx.team.callsign || ctx.team.name}`);
      const memberQs = memberToken ? `&member_token=${encodeURIComponent(memberToken)}` : "";
      const r = await fetch(`/api/search/field/photo?token=${encodeURIComponent(token)}${memberQs}`, {
        method: "POST",
        body: form,
      });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      flash("ok", "Photo sent");
      await load();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(data: { type: QuickReportType; description: string; severity: "info" | "warn" | "urgent" }) {
    if (!ctx) throw new Error("No team context");
    let lat: number | null = lastFix?.[0] ?? null;
    let lon: number | null = lastFix?.[1] ?? null;
    try {
      const pos = await getPosition();
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
    } catch { /* Report without fresh GPS is still sent; location can be null. */ }
    const zoneId = ctx.assigned_zones[0]?.id;
    const nowIso = new Date().toISOString();
    const memberQs = memberToken ? `&member_token=${encodeURIComponent(memberToken)}` : "";
    await enqueue({
      kind: "report",
      url: `/api/search/field/report?token=${encodeURIComponent(token)}${memberQs}`,
      method: "POST",
      body: {
        type: data.type,
        description: data.description,
        severity: data.severity,
        lat,
        lon,
        zone_id: zoneId || null,
      },
      client_ts: nowIso,
    });
    flash("ok", "Report queued");
    await load();
  }

  async function handleSOS() {
    if (!ctx) return;
    const ok = window.confirm("Send SOS alert to controller? This escalates to critical.");
    if (!ok) return;
    setBusy(true);
    let lat: number | null = lastFix?.[0] ?? null;
    let lon: number | null = lastFix?.[1] ?? null;
    try {
      const pos = await getPosition();
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
    } catch { /* Still send SOS even without GPS. */ }
    const memberQs = memberToken ? `&member_token=${encodeURIComponent(memberToken)}` : "";
    await enqueue({
      kind: "report",
      url: `/api/search/field/report?token=${encodeURIComponent(token)}${memberQs}`,
      method: "POST",
      body: {
        type: "assist",
        severity: "critical",
        description: `SOS from ${ctx.team.callsign || ctx.team.name}`,
        lat,
        lon,
        zone_id: ctx.assigned_zones[0]?.id || null,
      },
      client_ts: new Date().toISOString(),
    });
    flash("ok", "SOS sent");
    setBusy(false);
    await load();
  }

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
  const teamPosition: [number, number] | null =
    lastFix || (ctx.team.last_lat != null && ctx.team.last_lon != null
      ? [ctx.team.last_lat, ctx.team.last_lon]
      : null);
  const datum: [number, number] | null =
    ctx.operation.datum_lat != null && ctx.operation.datum_lon != null
      ? [ctx.operation.datum_lat, ctx.operation.datum_lon]
      : null;

  return (
    <div className="min-h-screen bg-surface-900 text-fg-1" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      {/* Sticky header */}
      <header className="sticky top-0 z-20 bg-surface-900/95 backdrop-blur border-b border-surface-700">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {isVehicle ? <Truck size={16} className="text-accent" /> : <MapPin size={16} className="text-accent" />}
            <h1 className="font-semibold truncate">{ctx.team.callsign || ctx.team.name}</h1>
            <span className="text-[10px] uppercase tracking-wider text-fg-4 px-1.5 py-0.5 border border-surface-700 rounded">
              {ctx.team.status}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-xs text-fg-4 truncate">{ctx.operation.name}</p>
            {ctx.operation.identity_mode !== "team" && (
              <button
                type="button"
                onClick={() => setShowIdentify(true)}
                className={`shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                  ctx.member
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-200"
                    : "bg-amber-500/10 border-amber-500/40 text-amber-200"
                }`}
              >
                {ctx.member ? ctx.member.name : "anon · tap to name in"}
              </button>
            )}
          </div>
        </div>
        <OfflineBar />
        <GpsStatusPill status={gpsStatus} lastFixAt={lastFixAt} />
        {total > 0 && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-[11px] text-fg-4 mb-1">
              <span>{zone ? `${zone.name} · street clear` : "street clear"}</span>
              <span className="font-mono">{cleared}/{total} · {pct}%</span>
            </div>
            <div className="h-1.5 bg-surface-700 rounded overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
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
              Waiting for the controller to assign you to a zone. This page refreshes automatically.
            </p>
          </div>
        )}

        {/* Map — always on when there's a zone or route to show. */}
        {(zone?.geometry || ctx.vehicle_route || datum) && (
          <section>
            <h2 className="text-[10px] uppercase tracking-wide text-fg-4 mb-2">
              {ctx.vehicle_route?.meta
                ? `Driving route — ${(ctx.vehicle_route.meta.distance_m / 1000).toFixed(1)} km · ${Math.round(ctx.vehicle_route.meta.duration_s / 60)} min`
                : zone
                  ? `Zone: ${zone.name}`
                  : "Area"}
            </h2>
            <div className="h-64 rounded overflow-hidden border border-surface-700">
              <ZoneMap
                zoneGeometry={zone?.geometry || null}
                route={isVehicle ? ctx.vehicle_route?.geometry || null : null}
                datum={datum}
                teamPosition={teamPosition}
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
                        isCleared ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "bg-surface-800 hover:bg-surface-700"
                      } ${isPending ? "opacity-60" : ""}`}
                    >
                      <span
                        className={`shrink-0 w-6 h-6 rounded border flex items-center justify-center ${
                          isCleared ? "bg-emerald-500 border-emerald-500" : "border-surface-500 bg-surface-900"
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
              Streets in <span className="text-fg-2">{zone.name}</span> are being pulled from OSM.
              This usually takes 5-20s. The page will refresh automatically.
            </p>
          </div>
        )}
      </div>

      {/* Hidden file input — triggered by the Photo action. capture="environment"
          cues iOS/Android to open the rear camera directly instead of the photo
          library picker. User can still tap "Photo Library" if they want an
          existing shot. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPhotoPicked(f);
          e.currentTarget.value = "";
        }}
        className="hidden"
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-xs font-medium shadow-lg ${
            toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}
        >
          {toast.msg}
        </div>
      )}

      {/* Report sheet */}
      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
      />

      {/* Identify modal — opens on first load when identity_mode !== 'team' and
          the device isn't already named in, or when the user taps the header
          pill to rename. Skippable unless identity_mode === 'required'. */}
      {showIdentify && (
        <IdentifyModal
          token={token}
          initialName={memberName || ""}
          required={ctx.operation.identity_mode === "required"}
          onSaved={(res) => {
            try {
              localStorage.setItem(memberTokenKey(token), res.sub_token);
              localStorage.setItem(memberNameKey(token), res.name);
            } catch {}
            setMemberToken(res.sub_token);
            setMemberName(res.name);
            setShowIdentify(false);
            load();
          }}
          onSkip={() => setShowIdentify(false)}
        />
      )}

      {/* Bottom action bar — fixed, home-indicator safe */}
      <FieldActionBar
        onCheckin={handleCheckin}
        onPhoto={() => photoInputRef.current?.click()}
        onReport={() => setReportOpen(true)}
        onSOS={handleSOS}
        pending={busy}
      />
    </div>
  );
}

// GPS status pill. Intentionally *not* rendered when status is "ok" and we
// have a recent fix — silence is the default so the driver's attention goes
// to the map. Only appears when something needs action or acknowledgement.
function GpsStatusPill({ status, lastFixAt }: { status: "unknown" | "ok" | "denied" | "unavailable"; lastFixAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (status === "unknown") return null;
  const stale = status === "ok" && lastFixAt != null && now - lastFixAt > 10 * 60 * 1000;
  if (status === "ok" && !stale) return null;

  let bg = "bg-amber-500/15 border-amber-500/40 text-amber-200";
  let label = "";
  if (status === "denied") {
    bg = "bg-red-500/15 border-red-500/40 text-red-200";
    label = "GPS denied — enable location for this site in browser settings";
  } else if (status === "unavailable") {
    bg = "bg-red-500/15 border-red-500/40 text-red-200";
    label = "No GPS fix — go outside / check device location";
  } else if (stale && lastFixAt != null) {
    const mins = Math.round((now - lastFixAt) / 60000);
    label = `GPS fix ${mins}min old`;
  }

  return (
    <div className={`mx-4 mt-2 px-3 py-1.5 border rounded text-[11px] font-medium inline-flex items-center gap-2 ${bg}`}>
      <Crosshair size={12} />
      <span>{label}</span>
    </div>
  );
}

// Hybrid identity name-in sheet. The "Skip" path is suppressed when the
// operation is `identity_mode='required'` — the IC has said every report must
// carry a name, and the mutation endpoints will 403 anonymous posts anyway, so
// there is no point letting the driver dismiss the prompt.
function IdentifyModal({
  token,
  initialName,
  required,
  onSaved,
  onSkip,
}: {
  token: string;
  initialName: string;
  required: boolean;
  onSaved: (res: { member_id: string; sub_token: string; name: string }) => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) { setErr("Enter your name or callsign"); return; }
    setSaving(true);
    setErr(null);
    try {
      const res = await search.fieldIdentify(token, trimmed);
      onSaved(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface-800 border border-surface-700 rounded-t-2xl sm:rounded-2xl p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-fg-1">Name in</h2>
        <p className="text-xs text-fg-4 mt-1">
          {required
            ? "This operation requires each reporter to be named. Your name appears on the controller's IC board."
            : "Add your name so the controller can see who sent each report. Skip to stay anonymous."}
        </p>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !saving) save(); }}
          placeholder="Jamie McLeod"
          autoComplete="name"
          className="mt-3 w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded text-sm focus:outline-none focus:border-accent"
        />
        {err && <div className="mt-2 text-[11px] text-red-300">{err}</div>}
        <div className="mt-4 flex gap-2">
          {!required && (
            <button
              type="button"
              onClick={onSkip}
              disabled={saving}
              className="flex-1 px-3 py-2 text-sm bg-surface-700 hover:bg-surface-600 rounded text-fg-2 disabled:opacity-50"
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex-1 px-3 py-2 text-sm bg-accent text-black font-medium rounded disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
