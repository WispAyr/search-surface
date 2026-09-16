"use client";

import { useEffect, useMemo, useState } from "react";
import { air, type AirLive, type AirTracks } from "@/lib/api";

// Single source of air data for BOTH map views. The 2D leaflet layer and the 3D
// maplibre map render the same payload — if they polled separately they would
// drift apart and quietly disagree about what is in the air.

const LIVE_POLL_MS = 30_000;
const TRACK_POLL_MS = 5 * 60_000;

export interface AirActivityState {
  tracks: AirTracks | null;
  live: AirLive | null;
  error: string | null;
  loading: boolean;
}

export function useAirActivity(
  operationId: string,
  visible: boolean,
  opts?: { hours?: number; radiusKm?: number; liveRadiusKm?: number },
): AirActivityState {
  const hours = opts?.hours ?? 72;
  const radiusKm = opts?.radiusKm ?? 8;
  const liveRadiusKm = opts?.liveRadiusKm ?? 40;

  const [tracks, setTracks] = useState<AirTracks | null>(null);
  const [live, setLive] = useState<AirLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !operationId) return;
    let alive = true;
    const load = () => {
      setLoading(true);
      air.tracks(operationId, { hours, radius_km: radiusKm })
        .then((d) => { if (alive) { setTracks(d); setError(null); } })
        .catch((e) => { if (alive) setError(e?.message || "Track history unavailable"); })
        .finally(() => { if (alive) setLoading(false); });
    };
    load();
    const t = setInterval(load, TRACK_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [operationId, visible, hours, radiusKm]);

  useEffect(() => {
    if (!visible || !operationId) return;
    let alive = true;
    const load = () => {
      air.live(operationId, { radius_km: liveRadiusKm })
        .then((d) => { if (alive) { setLive(d); setError(null); } })
        .catch((e) => { if (alive) setError(e?.message || "Live ADS-B unavailable"); });
    };
    load();
    const t = setInterval(load, LIVE_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [operationId, visible, liveRadiusKm]);

  return useMemo(() => ({ tracks, live, error, loading }), [tracks, live, error, loading]);
}
