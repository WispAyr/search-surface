"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { useSearchStore } from "@/stores/search";
import { searchHelpers } from "@/lib/api";

/** Floating lens that shows the street(s) under the map cursor.
 *  Subscribes to streetLensPoint in the store — SearchMap/SearchMap3D update
 *  it on debounced pointer-move. Queries the cached Scotland Overpass mirror
 *  via /osm/streets-nearby so repeat hovers on the same tarmac are ~free. */
export function StreetLens() {
  const { mapPrefs, streetLensPoint } = useSearchStore();
  const [streets, setStreets] = useState<Array<{ name: string; highway?: string; ref?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mapPrefs.show_street_lens) return;
    if (!streetLensPoint) return;
    // Match the server-side quantisation (4dp ≈ 11m) so we don't spam fetches
    // for sub-pixel cursor jitter that map to the same cache key.
    const [lat, lon] = streetLensPoint;
    const key = `${lat.toFixed(4)}:${lon.toFixed(4)}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    let cancelled = false;
    setLoading(true);
    searchHelpers
      .osmStreetsNearby(lat, lon, 40)
      .then((d) => {
        if (cancelled) return;
        setStreets(d.streets);
      })
      .catch(() => {
        if (cancelled) return;
        setStreets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [streetLensPoint, mapPrefs.show_street_lens]);

  if (!mapPrefs.show_street_lens) return null;

  return (
    <div className="absolute bottom-10 left-3 z-[1040] min-w-[180px] max-w-[280px] bg-surface-800/95 backdrop-blur border border-surface-600 rounded-md shadow-lg text-fg-1 pointer-events-none select-none">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-surface-700 text-[10px] font-semibold uppercase tracking-wider text-fg-3">
        {loading ? <Loader2 size={11} className="animate-spin text-accent" /> : <Search size={11} className="text-accent" />}
        Street lens
      </div>
      <div className="px-2.5 py-1.5 text-[11px] leading-relaxed">
        {!streetLensPoint ? (
          <span className="text-fg-4 italic">Hover the map…</span>
        ) : streets.length === 0 ? (
          <span className="text-fg-4 italic">{loading ? "…" : "No named road within 40m"}</span>
        ) : (
          <ul className="space-y-0.5">
            {streets.map((s) => (
              <li key={s.name} className="flex items-baseline gap-1.5">
                <span className="text-fg-1">{s.name}</span>
                {s.ref && <span className="text-fg-4 text-[10px] font-mono">{s.ref}</span>}
                {s.highway && <span className="text-fg-5 text-[10px]">· {s.highway}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
