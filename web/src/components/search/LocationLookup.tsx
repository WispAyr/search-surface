"use client";

import { useState } from "react";
import { searchHelpers } from "@/lib/api";
import { MapPin, Search as SearchIcon } from "lucide-react";

interface Props {
  onPick: (lat: number, lon: number, label?: string) => void;
  compact?: boolean;
}

// Combined address / postcode / what3words / lat,lon lookup.
export function LocationLookup({ onPick, compact }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ lat: number; lon: number; label: string; source: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    setResults([]);

    // 1. what3words?  ///foo.bar.baz  or  foo.bar.baz
    const w3wMatch = query.match(/^\/{0,3}([a-zA-Z]+\.[a-zA-Z]+\.[a-zA-Z]+)$/);
    if (w3wMatch) {
      try {
        const d = await searchHelpers.w3wToCoords(w3wMatch[1]);
        setResults([{ lat: d.lat, lon: d.lng, label: `///${d.words} — ${d.nearestPlace}`, source: "what3words" }]);
      } catch (e) {
        setError(`what3words: ${(e as Error).message}`);
      }
      setLoading(false);
      return;
    }

    // 2. lat,lon pair?
    const coordMatch = query.match(/^(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      setResults([{ lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, source: "coords" }]);
      setLoading(false);
      return;
    }

    // 3. postcode / address via Nominatim
    try {
      const d = await searchHelpers.geocode(query);
      setResults(d.results.map((r) => ({
        lat: r.lat,
        lon: r.lon,
        label: r.display_name,
        source: r.class === "boundary" ? "area" : r.type || "place",
      })));
      if (d.results.length === 0) setError("No results");
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }

  return (
    <div className={compact ? "" : "space-y-2"}>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(); } }}
            placeholder="Postcode, address, ///three.word.address, or lat,lon"
            className="w-full pl-7 pr-2 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
          />
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading || !q.trim()}
          className="px-3 py-2 bg-accent/20 border border-accent/40 text-accent rounded text-xs disabled:opacity-40"
        >
          {loading ? "…" : "Find"}
        </button>
      </div>
      {error && <div className="text-[11px] text-rose-400">{error}</div>}
      {results.length > 0 && (
        <div className="max-h-40 overflow-y-auto border border-surface-600 rounded divide-y divide-surface-700">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onPick(r.lat, r.lon, r.label); setResults([]); setQ(""); }}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-surface-700 flex items-start gap-2"
            >
              <MapPin size={11} className="mt-0.5 text-fg-4 shrink-0" />
              <div className="min-w-0">
                <div className="truncate">{r.label}</div>
                <div className="text-[10px] text-fg-4 font-mono">
                  {r.lat.toFixed(5)}, {r.lon.toFixed(5)} · {r.source}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
