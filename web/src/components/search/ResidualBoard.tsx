"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Droplets, ShieldCheck, RefreshCw } from "lucide-react";
import { search, type ResidualReport, type ResidualZone } from "@/lib/api";
import type { SearchOperation } from "@/types/search";

// The board an SIO actually needs: how much probability is STILL in each zone,
// given everything searched so far has come up empty. Sorted by residual, not by
// the priority someone typed during planning. See docs/residual-probability.md.

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function DeltaChip({ d }: { d: number }) {
  if (Math.abs(d) < 0.005) return <span className="text-fg-4 text-[10px]">—</span>;
  const up = d > 0;
  return (
    <span className={`text-[10px] font-medium ${up ? "text-amber-300" : "text-fg-4"}`}
      title={up
        ? "This zone became MORE likely because other zones were searched and came up empty."
        : "This zone became less likely because it has been searched."}>
      {up ? "+" : ""}{(d * 100).toFixed(1)}
    </span>
  );
}

function Row({ z, threshold }: { z: ResidualZone; threshold: number }) {
  const below = z.cumulative_pod < threshold;
  return (
    <div className="border-b border-surface-700 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-fg-4 text-[10px] tabular-nums w-5">#{z.rank}</span>
        <span className="text-sm text-fg-1 flex-1 truncate">{z.name}</span>
        {z.water && <Droplets size={12} className="text-sky-400 shrink-0" />}
        {z.risk_accepted_by && <ShieldCheck size={12} className="text-amber-400 shrink-0" />}
        <span className="text-sm tabular-nums text-fg-1 font-medium w-14 text-right">{pct(z.poa_current)}</span>
        <span className="w-10 text-right"><DeltaChip d={z.poa_delta} /></span>
      </div>

      {/* Residual bar — how much of the ORIGINAL belief is still sitting here. */}
      <div className="mt-1.5 ml-7 h-1.5 bg-surface-700 rounded overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${Math.min(100, z.poa_current * 100 * 1.6)}%` }} />
      </div>

      <div className="mt-1.5 ml-7 flex items-center gap-3 text-[10px] text-fg-4">
        <span className={below ? "text-amber-300" : "text-green-400"}>
          POD {pct(z.cumulative_pod)}
        </span>
        <span>{z.sweep_count} sweep{z.sweep_count === 1 ? "" : "s"}</span>
        {z.needs_subsurface && (
          <span className="text-red-400 flex items-center gap-1">
            <AlertTriangle size={9} /> no subsurface sweep
          </span>
        )}
        {z.risk_accepted_by && <span className="text-amber-400">risk accepted · {z.risk_accepted_by}</span>}
      </div>
    </div>
  );
}

export function ResidualBoard({ operation }: { operation: SearchOperation }) {
  const [data, setData] = useState<ResidualReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    search.residual(operation.id)
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [operation.id]);

  useEffect(() => { load(); }, [load, operation.updated_at]);

  if (err) return <div className="p-4 text-xs text-red-400">{err}</div>;
  if (!data) return <div className="p-4 text-xs text-fg-4">Loading residual probability…</div>;

  const outsideRose = data.poa_outside_current > data.poa_outside_initial + 0.005;

  return (
    <div className="text-xs">
      <div className="px-3 py-2.5 border-b border-surface-700 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-fg-4 font-semibold flex-1">
          Residual probability
        </span>
        <button onClick={load} disabled={loading} className="text-fg-4 hover:text-accent disabled:opacity-40" title="Refresh">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* The two numbers that actually drive the next decision. */}
      <div className="grid grid-cols-2 gap-px bg-surface-700">
        <div className="bg-surface-800 px-3 py-2">
          <div className="text-[10px] text-fg-4">Probability retired</div>
          <div className="text-lg text-fg-1 tabular-nums">{pct(data.searched_fraction)}</div>
        </div>
        <div className="bg-surface-800 px-3 py-2">
          <div className="text-[10px] text-fg-4">Subject outside area</div>
          <div className={`text-lg tabular-nums ${outsideRose ? "text-amber-300" : "text-fg-1"}`}>
            {pct(data.poa_outside_current)}
          </div>
        </div>
      </div>

      {outsideRose && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-200/90 leading-relaxed">
          The chance the subject is <strong>outside this search area</strong> has risen from{" "}
          {pct(data.poa_outside_initial)} to {pct(data.poa_outside_current)} as zones cleared.
          Re-examine the datum and the subject profile before pushing the rings further out.
        </div>
      )}

      {data.gaps.length > 0 && (
        <div className="px-3 py-2 border-b border-surface-700">
          <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-semibold mb-1">
            Open gaps · {data.gaps.length}
          </div>
          <div className="text-[11px] text-fg-3 leading-relaxed">
            Carrying real probability and still below {pct(data.clear_pod_threshold)} POD:{" "}
            <span className="text-fg-2">{data.gaps.map((g) => g.name).join(", ")}</span>
          </div>
        </div>
      )}

      <div>
        {data.zones.map((z) => <Row key={z.zone_id} z={z} threshold={data.clear_pod_threshold} />)}
      </div>

      <div className="px-3 py-3 text-[10px] text-fg-4 leading-relaxed border-t border-surface-700">
        Ranked by probability <em>remaining</em>, not by planning priority. A zone that has been
        searched can still sit at the top — that is the point. POD values are planning defaults
        from published SAR ranges, not figures validated against this team.
      </div>
    </div>
  );
}
