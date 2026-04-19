"use client";

import { useState } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import {
  X,
  HelpCircle,
  MapPin,
  Grid3X3,
  Users,
  ClipboardList,
  Radio,
  FileBarChart,
  Smartphone,
  Target,
  Hexagon,
  RotateCw,
  Route,
  Dog,
  Plane,
  Sparkles,
  Waves,
  LifeBuoy,
  Truck,
} from "lucide-react";

interface Section {
  id: string;
  title: string;
  icon: React.ReactNode;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "overview",
    title: "Overview",
    icon: <HelpCircle size={16} />,
    body: (
      <div className="space-y-3">
        <p>
          Search Operations is a SAR (search &amp; rescue) coordination surface for missing person,
          welfare check, security sweep, and event patrol incidents.
        </p>
        <p>The typical workflow:</p>
        <ol className="list-decimal list-inside space-y-1 text-fg-3">
          <li>Create an incident (use the <strong>New Incident</strong> wizard).</li>
          <li>Place <strong>datums</strong> — LKP (last known), PLP (possible), sightings, witnesses.</li>
          <li>Generate <strong>search zones</strong> from each datum using grid patterns.</li>
          <li>Create <strong>teams</strong> and share their field tokens.</li>
          <li>Assign zones to teams &mdash; they report progress, clues, and hazards from the field.</li>
          <li>Run <strong>SITREPs</strong> and watch coverage fill in via cumulative POD.</li>
        </ol>
      </div>
    ),
  },
  {
    id: "datums",
    title: "Datums (reference points)",
    icon: <MapPin size={16} />,
    body: (
      <div className="space-y-3">
        <p>
          A <strong>datum</strong> is a geographic anchor point. Every operation has one <em>primary</em>{" "}
          datum (usually the LKP) and any number of <em>secondary</em> datums.
        </p>
        <p>Kinds:</p>
        <ul className="space-y-1.5 text-fg-3">
          <li><Badge color="#ef4444">LKP</Badge> Last Known Position — confirmed last location.</li>
          <li><Badge color="#f59e0b">PLP</Badge> Possible Location — likely destination/attraction.</li>
          <li><Badge color="#3b82f6">Sighting</Badge> Reported sighting from a witness.</li>
          <li><Badge color="#8b5cf6">Witness</Badge> Where a witness was when they saw the subject.</li>
          <li><Badge color="#64748b">Other</Badge> Any other point of interest.</li>
        </ul>
        <p className="p-2 rounded bg-accent/5 border border-accent/20 text-fg-2 text-xs">
          <strong>Example:</strong> for a missing child, you might place LKP at "house", PLP at
          "local park", PLP at "grandma's", and a Sighting at "bus stop at 14:20". Each datum can
          seed its own search pattern, so multiple patterns overlap on the map.
        </p>
        <p>
          <strong>How to add:</strong> open the <em>Datums</em> tab in the side panel → click{" "}
          <em>+ Add</em> → click on the map → fill in label &amp; notes → Save.
        </p>
        <p>
          <strong>How to pick which datum a grid uses:</strong> open <em>Grid Generator</em> and choose
          one from the <em>Anchor datum</em> dropdown. You can generate multiple patterns from
          different datums in one operation.
        </p>
      </div>
    ),
  },
  {
    id: "grids",
    title: "Grid patterns",
    icon: <Grid3X3 size={16} />,
    body: (
      <div className="space-y-3">
        <p>
          Open <em>Grid Generator</em> from the header to design a search pattern, preview it on the
          map (amber dashed overlay), then <strong>Create</strong> to commit zones.
        </p>
        <ul className="space-y-2 text-fg-3">
          <li className="flex gap-2"><Grid3X3 size={14} className="shrink-0 mt-0.5 text-accent" /><span><strong>Parallel grid</strong> — square cells for area coverage.</span></li>
          <li className="flex gap-2"><Hexagon size={14} className="shrink-0 mt-0.5 text-accent" /><span><strong>Hex grid</strong> — hexagonal cells, more uniform coverage.</span></li>
          <li className="flex gap-2"><RotateCw size={14} className="shrink-0 mt-0.5 text-accent" /><span><strong>Expanding square</strong> — spiral outward from datum; high priority at centre.</span></li>
          <li className="flex gap-2"><Route size={14} className="shrink-0 mt-0.5 text-accent" /><span><strong>Route corridor</strong> — buffered strip along a travel route.</span></li>
          <li className="flex gap-2"><Target size={14} className="shrink-0 mt-0.5 text-accent" /><span><strong>Point search</strong> — circular radius from a point.</span></li>
          <li className="flex gap-2"><Dog size={14} className="shrink-0 mt-0.5 text-accent" /><span><strong>K9 scent cone</strong> — wind-aware cone from datum for dog handlers.</span></li>
          <li className="flex gap-2"><Plane size={14} className="shrink-0 mt-0.5 text-accent" /><span><strong>Drone lawnmower</strong> — flight strips; exports to GPX/KML.</span></li>
        </ul>
        <p className="text-xs text-fg-4 italic">
          Tip: generate a coarse pattern first, then add finer patterns around secondary datums as
          the incident develops.
        </p>
      </div>
    ),
  },
  {
    id: "teams",
    title: "Teams",
    icon: <Users size={16} />,
    body: (
      <div className="space-y-3">
        <p>
          A <strong>team</strong> is a field asset (foot team, K9, drone, vehicle). Each team has a
          unique <em>field token</em> — a URL they open on their phone to report position, clues,
          and status.
        </p>
        <p>Statuses: standby → deployed → returning → stood down.</p>
        <p>
          Assigning a zone to a team automatically deploys them (if on standby). Their last reported
          position appears on the map as a coloured dot.
        </p>
      </div>
    ),
  },
  {
    id: "zones",
    title: "Zones",
    icon: <ClipboardList size={16} />,
    body: (
      <div className="space-y-3">
        <p>A <strong>zone</strong> is a single polygon to search. Each zone has:</p>
        <ul className="list-disc list-inside space-y-1 text-fg-3">
          <li><strong>Priority</strong> 1–5 (1 = highest).</li>
          <li><strong>Status</strong>: unassigned → assigned → in progress → complete, or suspended.</li>
          <li><strong>POD</strong> (Probability of Detection) per sweep; multiple sweeps accumulate via Bayesian update.</li>
          <li><strong>POA</strong> (Probability of Area) — likelihood the subject is in this zone.</li>
        </ul>
        <p>
          Zones are colour-coded on the map by status, or by assigned team colour. Click a zone on
          the map or in the Zones tab to select it.
        </p>
      </div>
    ),
  },
  {
    id: "reports",
    title: "Reports &amp; comms",
    icon: <Radio size={16} />,
    body: (
      <div className="space-y-3">
        <p>
          Field teams submit <strong>reports</strong> (clue, area clear, hazard, assist, welfare,
          photo, check-in, sitrep) with lat/lon, description, optional photo.
        </p>
        <p>
          The <strong>Comms</strong> tab is a shared radio/message log — anyone can post, and system
          events (deployments, datums added, etc.) also show up here.
        </p>
      </div>
    ),
  },
  {
    id: "sitrep",
    title: "SITREP &amp; exports",
    icon: <FileBarChart size={16} />,
    body: (
      <div className="space-y-3">
        <p>
          The <strong>SITREP</strong> panel generates a structured situation report at any point:
          zones searched, cumulative POD, teams deployed, active clues, outstanding hazards.
        </p>
        <p>
          <strong>Export</strong> supports GPX/KML for map layers, PDF SITREP, and CSV audit log.
        </p>
      </div>
    ),
  },
  {
    id: "mobile",
    title: "Mobile use",
    icon: <Smartphone size={16} />,
    body: (
      <div className="space-y-3">
        <p>
          On phones the side panel collapses into a drawer. Tap the panel button on the map to open
          zones/datums/reports, and the map icon inside the panel to return to the map.
        </p>
        <p>
          Teams in the field don't need access to this page at all — share the team token URL and
          they get a minimal reporting UI.
        </p>
      </div>
    ),
  },
  {
    id: "roadmap",
    title: "Coming soon",
    icon: <Sparkles size={16} />,
    body: (
      <div className="space-y-4">
        <p className="p-2 rounded bg-warn/10 border border-warn/20 text-fg-2 text-xs">
          Most items below are in active design — not yet live. Don't plan an incident around them.
          Two overlays are <strong className="text-emerald-400">partially live</strong> and flagged below.
        </p>
        <div className="flex gap-3 items-start">
          <Waves size={18} className="shrink-0 mt-0.5 text-accent" />
          <div>
            <div className="font-semibold text-fg-1">
              Coastline sweep zones{" "}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 align-middle">shoreline overlay live</span>
            </div>
            <p className="text-fg-3 text-sm">
              <strong>Live:</strong> toggle "Coastline" in SAR tools — the shoreline draws as a blue
              polyline near your incident so the IC can see what's water-edge. Fetched from the
              self-hosted Scotland OSM mirror (same endpoint as hazards/attractors).
            </p>
            <p className="text-fg-3 text-sm mt-1">
              <strong>Still in design:</strong> click two headlands to drop a corridor zone with
              ±100m offshore and ±50m inland buffers; sweep timing from walk speed × length;
              current tide phase overlay (flooding = cutoff risk, ebbing = max strand exposure).
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <LifeBuoy size={18} className="shrink-0 mt-0.5 text-warn" />
          <div>
            <div className="font-semibold text-fg-1">
              Life-saving equipment{" "}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 align-middle">live</span>
            </div>
            <p className="text-fg-3 text-sm">
              <strong>Live:</strong> public lifebuoys, rescue stations, lifeguard towers/bases,
              rescue boxes, emergency phones and miscellaneous <code>rescue_equipment=*</code>
              (throw lines, rescue boards) render as amber markers when you scan hazards around
              the datum — or when the "Life-saving kit" toggle is on in SAR tools. Teams can see
              what's already on site before committing kit. OSM-sourced; accuracy is volunteer-mapped.
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <Truck size={18} className="shrink-0 mt-0.5 text-accent" />
          <div>
            <div className="font-semibold text-fg-1">RVPs &amp; asset register</div>
            <p className="text-fg-3 text-sm">
              New datum kinds — <em>RVP</em> (rendezvous point), <em>ICP</em> (incident command
              post), <em>holding area</em> — plus an Assets panel for tracking every resource
              your team can call on (air, marine, ground, K9, drone, tech). Drag-drop to deploy.
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <Plane size={18} className="shrink-0 mt-0.5 text-accent" />
          <div>
            <div className="font-semibold text-fg-1">Live helicopter &amp; boat coverage</div>
            <p className="text-fg-3 text-sm">
              Tag a deployed asset with an ADS-B hex or AIS MMSI and the app ingests its live
              track. Covered area is buffered by a speed/altitude-derived sweep width and
              painted on the map as it happens — no drawing, no after-action reconstruction.
              Automatically subtracted from the unsearched-area total.
            </p>
          </div>
        </div>
      </div>
    ),
  },
];

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 mr-1 rounded text-[10px] font-bold font-mono"
      style={{ background: `${color}22`, color }}
    >
      {children}
    </span>
  );
}

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState<string>("overview");
  const active = SECTIONS.find((s) => s.id === activeId) || SECTIONS[0];
  useEscapeKey(onClose);

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-stretch md:items-center justify-center">
      <div className="bg-surface-800 border border-surface-600 md:rounded-xl w-full max-w-4xl h-full md:h-[80vh] overflow-hidden flex flex-col md:flex-row">
        {/* Sidebar */}
        <aside className="md:w-56 border-b md:border-b-0 md:border-r border-surface-700 bg-surface-900/60 flex-shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700 md:border-b-0">
            <div className="flex items-center gap-2">
              <HelpCircle size={16} className="text-accent" />
              <h2 className="text-sm font-semibold">Help &amp; Guide</h2>
            </div>
            <button onClick={onClose} className="text-fg-4 hover:text-fg-1 md:hidden" aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <nav className="p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-hidden">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`flex items-center gap-2 px-3 py-2 text-xs rounded whitespace-nowrap md:whitespace-normal text-left transition ${
                  activeId === s.id
                    ? "bg-accent/15 text-accent"
                    : "text-fg-3 hover:text-fg-1 hover:bg-surface-700/60"
                }`}
              >
                <span className="shrink-0">{s.icon}</span>
                <span>{s.title}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="hidden md:flex items-center justify-end px-5 py-3 border-b border-surface-700">
            <button onClick={onClose} className="text-fg-4 hover:text-fg-1" aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="p-5 md:p-6 space-y-4 text-sm text-fg-2 leading-relaxed">
            <div className="flex items-center gap-2 text-fg-1">
              {active.icon}
              <h3 className="text-lg font-semibold">{active.title}</h3>
            </div>
            <div>{active.body}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
