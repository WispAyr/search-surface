"use client";

import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";
import "./print.css";

export default function HelpPage() {
  return (
    <div className="help-doc min-h-screen bg-surface-900 text-fg">
      {/* Screen-only toolbar */}
      <div className="no-print sticky top-0 z-50 bg-surface-800/95 backdrop-blur border-b border-line">
        <div className="max-w-[900px] mx-auto flex items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-fg-3 hover:text-fg"
          >
            <ArrowLeft size={16} />
            Back to Search Ops
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-fg-4">
              Tip: use Ctrl/⌘+P and pick "Save as PDF" — layout is print-tuned.
            </span>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 bg-accent text-surface-900 px-4 py-1.5 rounded text-sm font-semibold hover:brightness-110"
            >
              <Printer size={15} />
              Print / Save PDF
            </button>
          </div>
        </div>
      </div>

      <article className="max-w-[900px] mx-auto px-6 py-10 md:py-14 leading-relaxed">
        <Cover />
        <TOC />

        <Section id="overview" title="1. Overview" eyebrow="Getting oriented">
          <p>
            <strong>Search Ops</strong> is a command surface for SAR (search &amp; rescue),
            welfare check, security sweep, and event patrol incidents. It is designed to be
            driven by a single incident commander (IC) from a laptop or tablet while field
            teams report in from their phones over a single-URL token.
          </p>
          <p>
            The surface has three sides: the <strong>map</strong> (what &amp; where), the
            <strong> side panel</strong> (who &amp; when — datums, zones, teams, reports), and
            the <strong>SAR tools</strong> panel (search-theory helpers — subject profiles, LPB
            rings, isochrones, OSM hazards, coastline, life-saving equipment).
          </p>
          <Callout tone="info">
            This guide is a full reference. For quick answers while operating, open the
            in-app <em>Help &amp; Guide</em> panel (question-mark icon in the header).
          </Callout>
        </Section>

        <Section id="lifecycle" title="2. Incident lifecycle" eyebrow="From new to stood-down">
          <p>A typical operation moves through these phases:</p>
          <ol className="list-decimal list-inside space-y-2 my-4">
            <li>
              <strong>Open</strong> — create the incident via the New Incident wizard.
              Enter a title, type (missing person / welfare / security / event), and the
              primary datum (usually the LKP).
            </li>
            <li>
              <strong>Plan</strong> — drop secondary datums (PLPs, sightings, witnesses).
              Scan OSM for hazards &amp; attractors. Generate initial search zones using one
              or more grid patterns. Create teams.
            </li>
            <li>
              <strong>Deploy</strong> — assign zones to teams. They open their field-token
              URL on a phone and start reporting position, clues, area-clear, hazards.
            </li>
            <li>
              <strong>Iterate</strong> — run SITREPs. Adjust zones and priorities based on
              reports. Deploy further patterns if the initial sweep is negative.
            </li>
            <li>
              <strong>Close</strong> — stand down teams. Export the SITREP (PDF), audit log
              (CSV), and any GPX/KML tracks for archiving.
            </li>
          </ol>
        </Section>

        <Section id="datums" title="3. Datums" eyebrow="Reference points">
          <p>
            A <strong>datum</strong> is a geographic anchor. Every operation has exactly one
            <em>primary</em> datum and any number of <em>secondary</em> datums. Datums seed
            search patterns, anchor Last-Place-of-Behaviour (LPB) rings, and give context to
            all downstream SAR-tool calculations.
          </p>
          <h3 className="font-semibold mt-5 mb-2">3.1 Kinds</h3>
          <table className="w-full text-sm my-3">
            <thead className="text-fg-3 text-xs border-b border-line">
              <tr>
                <th className="text-left py-2 pr-3">Badge</th>
                <th className="text-left py-2 pr-3">Kind</th>
                <th className="text-left py-2">Semantics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              <tr>
                <td className="py-2 pr-3"><Badge color="#ef4444">LKP</Badge></td>
                <td className="py-2 pr-3 font-medium">Last Known Position</td>
                <td className="py-2 text-fg-2">Confirmed last location. Highest confidence anchor.</td>
              </tr>
              <tr>
                <td className="py-2 pr-3"><Badge color="#f59e0b">PLP</Badge></td>
                <td className="py-2 pr-3 font-medium">Possible Location</td>
                <td className="py-2 text-fg-2">Likely destination / attraction / known habit site.</td>
              </tr>
              <tr>
                <td className="py-2 pr-3"><Badge color="#3b82f6">Sighting</Badge></td>
                <td className="py-2 pr-3 font-medium">Sighting</td>
                <td className="py-2 text-fg-2">Reported sighting from a witness. Time-stamped.</td>
              </tr>
              <tr>
                <td className="py-2 pr-3"><Badge color="#8b5cf6">Witness</Badge></td>
                <td className="py-2 pr-3 font-medium">Witness location</td>
                <td className="py-2 text-fg-2">Where the witness was <em>standing</em> when they reported.</td>
              </tr>
              <tr>
                <td className="py-2 pr-3"><Badge color="#64748b">Other</Badge></td>
                <td className="py-2 pr-3 font-medium">Other / POI</td>
                <td className="py-2 text-fg-2">Anything else worth flagging on the map.</td>
              </tr>
            </tbody>
          </table>
          <h3 className="font-semibold mt-5 mb-2">3.2 Multi-datum patterns</h3>
          <p>
            You can generate a pattern from <em>any</em> datum, not just the primary. Pick it
            in the <em>Anchor datum</em> dropdown of the Grid Generator. Typical flow for a
            missing-child incident: parallel grid around LKP, smaller expanding-square around
            a park PLP, route corridor along the known school walk.
          </p>
          <Callout tone="note">
            The primary datum also anchors LPB rings, subject profiles, and coastline/LSE
            scans when those are triggered without an explicit point.
          </Callout>
        </Section>

        <Section id="grids" title="4. Grid patterns" eyebrow="Search patterns">
          <p>
            Open <strong>Grid Generator</strong> from the header to design a pattern, preview
            it as an amber dashed overlay, adjust, then <strong>Create</strong> to commit
            cells as zones.
          </p>

          <PatternBlock
            title="4.1 Parallel grid"
            svg={<ParallelSVG />}
            desc="Square cells on a rotatable axis. Best for open area coverage with foot teams walking parallel lanes. Cell size = sweep width; rotate to prevailing terrain contours or wind."
            params="Cell size, rotation angle, buffer around datum."
          />
          <PatternBlock
            title="4.2 Hex grid"
            svg={<HexSVG />}
            desc="Hexagonal cells. More uniform neighbour distance than squares — useful when assigning adjacent cells should feel balanced, or when the team prefers hexes."
            params="Cell apothem, rotation, buffer."
          />
          <PatternBlock
            title="4.3 Expanding square"
            svg={<ExpandingSquareSVG />}
            desc="Spiral outward from the datum. High POD near centre, tapering. Classic pattern for a single team working alone from a known point."
            params="Initial leg length, leg growth rate, number of legs."
          />
          <PatternBlock
            title="4.4 Route corridor"
            svg={<CorridorSVG />}
            desc="Buffered strip along a travel route (drawn polyline). For the known walk-to-school, towpath, or shoreline walk. Buffer width scales to sweep width."
            params="Route polyline, buffer width, segmentation."
          />
          <PatternBlock
            title="4.5 Point search"
            svg={<PointSVG />}
            desc="Circular radius from a point. Simplest pattern — one team clearing the immediate vicinity while other teams deploy further out."
            params="Radius, rings (concentric)."
          />
          <PatternBlock
            title="4.6 K9 scent cone"
            svg={<ConeSVG />}
            desc="Wind-aware cone from the datum. Widens downwind. Sized for dog teams; overlays a wind vector arrow if current wind data is available."
            params="Wind bearing, wind speed, cone range, cone half-angle."
          />
          <PatternBlock
            title="4.7 Drone lawnmower"
            svg={<LawnmowerSVG />}
            desc="Flight-strip pattern for drones. Stripes are spaced to the drone's effective search width at its flight altitude. Exports as GPX/KML for upload to the pilot's GCS."
            params="Bounding box or polygon, strip spacing, altitude, heading."
          />

          <h3 className="font-semibold mt-6 mb-2">Coverage formulae (at-a-glance)</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <Formula title="Sweep width (W)">
              The effective detection width for the searcher type &amp; terrain.
              Foot in open ground: ~50–100 m. Foot in dense cover: ~5–15 m. Drone:
              depends on altitude &amp; camera FOV.
            </Formula>
            <Formula title="POD per sweep">
              Probability of Detection per pass ≈ 1 − e<sup>−(2W·d)/A</sup> where d is
              distance walked and A is cell area. Multiple sweeps compound:
              POD<sub>cum</sub> = 1 − ∏(1−POD<sub>i</sub>).
            </Formula>
            <Formula title="POA">
              Probability of Area — likelihood the subject is in this zone. Set by the
              IC per zone at plan time; summed across all zones should not exceed 1.0.
              ESW = POA × POD.
            </Formula>
          </div>

          <Callout tone="tip">
            Start coarse. Generate one parallel or hex grid covering the primary high-POA
            band, deploy, and then add tighter patterns around secondaries as the incident
            develops. Don't over-plan before teams are moving.
          </Callout>
        </Section>

        <Section id="zones" title="5. Zones" eyebrow="Unit of assignment">
          <p>
            A <strong>zone</strong> is a single polygon to search — a grid cell, a corridor
            segment, or a hand-drawn shape.
          </p>
          <h3 className="font-semibold mt-4 mb-2">5.1 Status lifecycle</h3>
          <div className="flex flex-wrap items-center gap-2 my-2 text-xs">
            <Pill color="#64748b">unassigned</Pill>
            <span className="text-fg-5">→</span>
            <Pill color="#60a5fa">assigned</Pill>
            <span className="text-fg-5">→</span>
            <Pill color="#f59e0b">in progress</Pill>
            <span className="text-fg-5">→</span>
            <Pill color="#10b981">complete</Pill>
            <span className="text-fg-5">· or ·</span>
            <Pill color="#ef4444">suspended</Pill>
          </div>
          <h3 className="font-semibold mt-4 mb-2">5.2 Fields</h3>
          <ul className="list-disc list-inside space-y-1 text-fg-2">
            <li><strong>Priority 1–5</strong> (1 = highest).</li>
            <li><strong>Assigned team</strong> — paints the polygon in team colour.</li>
            <li><strong>POD</strong> — entered per completed sweep.</li>
            <li><strong>POA</strong> — set at plan time.</li>
            <li><strong>Notes</strong> — terrain, hazards, access.</li>
          </ul>
          <h3 className="font-semibold mt-4 mb-2">5.3 Cumulative POD</h3>
          <p>
            When a zone is swept multiple times (different teams or repeat sweeps by the
            same team), the app updates POD cumulatively. A 60% sweep followed by a 40%
            sweep gives cumulative POD = 1 − (1−0.6)(1−0.4) = 0.76, leaving 24% residual
            chance the subject was missed.
          </p>
        </Section>

        <Section id="teams" title="6. Teams" eyebrow="Field assets">
          <p>
            A <strong>team</strong> is a field asset — a foot team, K9 handler, drone pilot,
            or vehicle crew. Each has a unique <em>field token</em> URL that opens a
            minimal, phone-friendly reporting UI. No login, no account.
          </p>
          <h3 className="font-semibold mt-4 mb-2">6.1 Statuses</h3>
          <div className="flex flex-wrap items-center gap-2 my-2 text-xs">
            <Pill color="#64748b">standby</Pill>
            <span className="text-fg-5">→</span>
            <Pill color="#f59e0b">deployed</Pill>
            <span className="text-fg-5">→</span>
            <Pill color="#60a5fa">returning</Pill>
            <span className="text-fg-5">→</span>
            <Pill color="#10b981">stood down</Pill>
          </div>
          <p>
            Assigning a zone auto-deploys a standby team. The team's last reported position
            appears on the map as a coloured dot with a thin track tail.
          </p>
          <h3 className="font-semibold mt-4 mb-2">6.2 Field token URL</h3>
          <p>
            Shape: <code>{"/field/<team_token>"}</code>. Tokens are single-use per incident and
            do not grant access to other incidents or admin functions. Share by SMS, radio
            netmail, or QR.
          </p>
        </Section>

        <Section id="sar-tools" title="7. SAR tools" eyebrow="Search-theory helpers">
          <p>
            Open the <strong>SAR tools</strong> panel to access search-theory helpers. All
            operate around the currently selected datum (or a map-click) and render directly
            onto the map.
          </p>

          <ToolBlock title="7.1 Subject profiles">
            Pick a profile — <em>Missing adult</em>, <em>Missing child</em>, <em>Dementia</em>,
            <em>Despondent</em>, <em>Lost walker</em>, etc. Each carries known LPB (Last Place
            of Behaviour) statistics: 25/50/75/95% containment rings. Rings render as
            concentric circles from the primary datum.
          </ToolBlock>

          <ToolBlock title="7.2 LPB rings">
            Independent of a profile — drop explicit rings at arbitrary distances. Useful
            for matching a local SOP or a verified subject mobility estimate.
          </ToolBlock>

          <ToolBlock title="7.3 Walk / cycle / drive isochrones">
            Reachable-area polygons at N-minute intervals from a datum. Powered by routing
            engine. Answers "where could the subject plausibly be in 30 minutes on foot?"
          </ToolBlock>

          <ToolBlock title="7.4 What3Words lookup">
            Convert any clicked point to its W3W address (e.g. <em>daring.lion.race</em>)
            or search for a W3W to drop a marker. Critical for ambulance / police-reported
            addresses from the public.
          </ToolBlock>

          <ToolBlock title="7.5 Street &amp; vehicle routes">
            Nearby street list and drive-time routes from major RVPs to the incident,
            highlighting access constraints (width, height, 4×4 needed).
          </ToolBlock>

          <ToolBlock title="7.6 OSM hazards &amp; attractors">
            One click scans the OpenStreetMap area around the datum for:
            <ul className="list-disc list-inside mt-2 space-y-0.5">
              <li><strong>Hazards</strong> — cliffs, quarries, water bodies, railway lines, major roads, steep embankments.</li>
              <li><strong>Attractors</strong> — playgrounds, sports pitches, shops, bus stops, viewpoints — places a missing subject may drift toward.</li>
              <li><strong>Hazard lines</strong> — linear hazards (railways, rivers, cliffs) drawn as coloured polylines.</li>
            </ul>
            Results are cached for ~5 min to avoid hammering the Overpass mirror. Partial
            responses (some classes time out) surface with a <em>partial</em> flag and a
            "stale" indicator on the button.
          </ToolBlock>

          <ToolBlock title="7.7 Coastline overlay">
            Toggle <em>Coastline</em> to draw the shoreline as a blue polyline over the map,
            fetched from OSM <code>natural=coastline</code> ways. Lets the IC see exactly
            what is water-edge vs inland when planning sweeps or setting corridor buffers.
          </ToolBlock>

          <ToolBlock title="7.8 Life-saving equipment">
            Toggle <em>Life-saving kit</em> to render public lifebuoys, lifeguard towers /
            bases, rescue stations, rescue boxes, emergency phones, and miscellaneous
            <code> rescue_equipment=*</code> (throw lines, rescue boards) as amber markers.
            Lets the IC see what's already on site before committing kit. Data is
            OSM-sourced; accuracy is volunteer-mapped — treat as <em>advisory</em>.
          </ToolBlock>
        </Section>

        <Section id="reports" title="8. Reports &amp; comms" eyebrow="From the field">
          <p>
            Field teams submit <strong>reports</strong> from their phone. Each report has a
            type:
          </p>
          <ul className="list-disc list-inside space-y-1 my-3 text-fg-2">
            <li><strong>Area clear</strong> — a zone (or part of it) has been swept.</li>
            <li><strong>Clue</strong> — physical evidence found (clothing, tracks).</li>
            <li><strong>Hazard</strong> — unreported risk (fallen tree, floodwater).</li>
            <li><strong>Welfare</strong> — a member of the public needing help.</li>
            <li><strong>Assist</strong> — team requesting support.</li>
            <li><strong>Photo</strong> — attached image with geotag.</li>
            <li><strong>Check-in</strong> — routine timestamped position ping.</li>
            <li><strong>SITREP</strong> — narrative update from team leader.</li>
          </ul>
          <p>
            The <strong>Comms</strong> tab is a unified log: free-form messages posted by
            anyone, and system events (datum added, zone assigned, team stood down) auto-
            inserted. Posts are timestamped and attributed.
          </p>
        </Section>

        <Section id="sitrep" title="9. SITREPs &amp; exports" eyebrow="Hand-offs &amp; after-action">
          <p>
            The <strong>SITREP</strong> panel produces a structured situation report at any
            point in the incident, covering: zones searched (with cumulative POD per zone
            and overall), teams deployed &amp; their status, outstanding clues, active
            hazards, and residual POA by area.
          </p>
          <h3 className="font-semibold mt-4 mb-2">Exports</h3>
          <ul className="list-disc list-inside space-y-1 text-fg-2">
            <li><strong>SITREP PDF</strong> — formatted narrative + map snapshot.</li>
            <li><strong>GPX / KML</strong> — tracks, waypoints, zones for Garmin / Google Earth.</li>
            <li><strong>CSV audit log</strong> — every state change with timestamp &amp; actor.</li>
          </ul>
        </Section>

        <Section id="mobile" title="10. Mobile use" eyebrow="IC and field">
          <p>
            On phone screens, the side panel collapses into a drawer. Tap the panel button
            on the map to open zones/datums/reports, and the map icon inside the panel to
            return to the map.
          </p>
          <p>
            Field teams never need the full IC view. Share the team token URL by SMS or QR
            and they see only their own assigned zones, a map, and a reporting form. The UI
            is tuned for gloves, rain, sunlight.
          </p>
        </Section>

        <Section id="admin" title="11. Admin &amp; tenancy" eyebrow="For platform admins">
          <p>
            Search Ops is multi-tenant. Each tenant (typically a SAR team or coastguard
            sector) has its own incidents, teams, users, and brand. Platform admins can
            create tenants, move incidents between tenants, and audit cross-tenant activity
            from the <em>/admin</em> surface.
          </p>
          <h3 className="font-semibold mt-4 mb-2">Roles</h3>
          <ul className="list-disc list-inside space-y-1 text-fg-2">
            <li><strong>Platform admin</strong> — global access, tenant provisioning.</li>
            <li><strong>Tenant admin</strong> — manage their own tenant's users &amp; incidents.</li>
            <li><strong>Incident commander</strong> — full edit on assigned incidents.</li>
            <li><strong>Responder</strong> — read + limited edit (report, update own team).</li>
            <li><strong>Observer</strong> — read-only. For council, press, liaisons.</li>
          </ul>
        </Section>

        <Section id="keys" title="12. Keyboard reference" eyebrow="Quick keys">
          <table className="w-full text-sm my-3">
            <thead className="text-fg-3 text-xs border-b border-line">
              <tr>
                <th className="text-left py-2 pr-3">Shortcut</th>
                <th className="text-left py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {[
                ["Esc", "Close open modal / side panel"],
                ["?", "Open the in-app help panel"],
                ["N", "New datum (map picker)"],
                ["G", "Open Grid Generator"],
                ["T", "New team"],
                ["R", "Switch to Reports tab"],
                ["Z", "Switch to Zones tab"],
                ["M", "Return to map from side panel"],
                ["Ctrl/⌘ + F", "Search incidents / zones / teams"],
                ["Ctrl/⌘ + S", "Save current draft (datum / zone edit)"],
                ["Ctrl/⌘ + P", "Print / Save as PDF (this help guide)"],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="py-1.5 pr-3"><kbd className="font-mono text-xs px-1.5 py-0.5 bg-surface-700 rounded border border-line">{k}</kbd></td>
                  <td className="py-1.5 text-fg-2">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section id="osm" title="13. Appendix — OSM tags used" eyebrow="Reference">
          <p>
            The OSM hazard / attractor / coastline / LSE scans map directly to OpenStreetMap
            tags. If local mapping is sparse, so are results.
          </p>
          <h3 className="font-semibold mt-4 mb-2">Hazards (point &amp; linear)</h3>
          <TagList tags={[
            "natural=cliff", "natural=water", "natural=wetland",
            "waterway=river / stream / canal",
            "railway=rail / light_rail / tram",
            "highway=motorway / trunk / primary",
            "man_made=mineshaft / adit",
            "landuse=quarry",
          ]} />
          <h3 className="font-semibold mt-4 mb-2">Attractors</h3>
          <TagList tags={[
            "leisure=playground / park / sports_centre",
            "amenity=shop / cafe / pub / library / community_centre",
            "highway=bus_stop",
            "tourism=viewpoint / picnic_site",
            "sport=pitch",
          ]} />
          <h3 className="font-semibold mt-4 mb-2">Coastline</h3>
          <TagList tags={["natural=coastline"]} />
          <h3 className="font-semibold mt-4 mb-2">Life-saving equipment</h3>
          <TagList tags={[
            "emergency=life_ring",
            "emergency=lifeguard_tower / lifeguard_base",
            "emergency=rescue_station / rescue_box",
            "emergency=phone",
            "rescue_equipment=* (throw lines, rescue boards)",
          ]} />
        </Section>

        <Section id="glossary" title="14. Glossary" eyebrow="Terms">
          <dl className="text-sm space-y-2.5">
            {[
              ["IC", "Incident Commander — the person running the operation."],
              ["LKP", "Last Known Position — confirmed last sighting of the subject."],
              ["PLP", "Possible Location Point — a plausible destination / attraction."],
              ["RVP", "Rendezvous Point — where responding teams meet before deploying."],
              ["ICP", "Incident Command Post — physical command vehicle / tent."],
              ["LPB", "Last-Place-of-Behaviour — statistical distance the subject category has travelled from LKP in past incidents."],
              ["POA", "Probability of Area — likelihood the subject is in a given zone."],
              ["POD", "Probability of Detection — chance a single sweep would have found the subject if they were there."],
              ["ESW", "Effective Search Width — probability-weighted area actually cleared (POA × POD)."],
              ["SITREP", "Situation Report — narrative + metrics snapshot of current state."],
              ["Datum", "Any geographic anchor point (LKP, PLP, sighting, etc)."],
              ["Sweep", "One pass by a single team through a zone."],
              ["Cumulative POD", "Combined detection probability across multiple sweeps of the same zone."],
            ].map(([term, def]) => (
              <div key={term} className="grid grid-cols-[110px_1fr] gap-3">
                <dt className="font-semibold text-fg">{term}</dt>
                <dd className="text-fg-2">{def}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <footer className="mt-20 pt-6 border-t border-line text-xs text-fg-4 text-center">
          Search Ops by wispayr.online · live at{" "}
          <a href="https://search.wispayr.online" className="text-accent hover:underline">
            search.wispayr.online
          </a>
          <br />
          Generated from the running application — refresh for latest.
        </footer>
      </article>
    </div>
  );
}

/* ───────────────────────── components ───────────────────────── */

function Cover() {
  const today = new Date().toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <header className="cover mb-12 md:mb-16 pb-10 border-b border-line">
      <div className="text-xs tracking-[0.3em] uppercase text-accent mb-4">
        Search Operations
      </div>
      <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-3">
        Operator&rsquo;s Guide
      </h1>
      <p className="text-lg text-fg-2 max-w-xl">
        A full reference to running a search with the Search Ops command surface —
        datums, grids, zones, teams, SAR tools, reports, and exports.
      </p>
      <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-xs text-fg-3">
        <span>
          <span className="text-fg-5 block">Published</span>
          {today}
        </span>
        <span>
          <span className="text-fg-5 block">Surface</span>
          search.wispayr.online
        </span>
        <span>
          <span className="text-fg-5 block">Audience</span>
          Incident commanders &amp; platform admins
        </span>
      </div>
    </header>
  );
}

function TOC() {
  const items = [
    ["1", "Overview", "overview"],
    ["2", "Incident lifecycle", "lifecycle"],
    ["3", "Datums", "datums"],
    ["4", "Grid patterns", "grids"],
    ["5", "Zones", "zones"],
    ["6", "Teams", "teams"],
    ["7", "SAR tools", "sar-tools"],
    ["8", "Reports & comms", "reports"],
    ["9", "SITREPs & exports", "sitrep"],
    ["10", "Mobile use", "mobile"],
    ["11", "Admin & tenancy", "admin"],
    ["12", "Keyboard reference", "keys"],
    ["13", "Appendix — OSM tags", "osm"],
    ["14", "Glossary", "glossary"],
  ];
  return (
    <nav className="toc page-break-after mb-12">
      <h2 className="text-xs tracking-[0.2em] uppercase text-fg-4 mb-4">
        Contents
      </h2>
      <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
        {items.map(([n, title, anchor]) => (
          <li key={anchor} className="flex items-baseline gap-3">
            <span className="font-mono text-fg-4 w-5 tabular-nums">{n}</span>
            <a
              href={`#${anchor}`}
              className="text-fg-2 hover:text-accent flex-1 truncate"
            >
              {title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Section({
  id,
  title,
  eyebrow,
  children,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="section mb-10 md:mb-14">
      {eyebrow && (
        <div className="text-[11px] tracking-[0.2em] uppercase text-accent mb-2">
          {eyebrow}
        </div>
      )}
      <h2 className="text-2xl md:text-3xl font-bold mb-4 border-b border-line pb-2">
        {title}
      </h2>
      <div className="text-fg-2 space-y-3 text-[15px]">{children}</div>
    </section>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: "info" | "tip" | "note" | "warn";
  children: React.ReactNode;
}) {
  const map: Record<string, { bg: string; border: string; label: string; color: string }> = {
    info: { bg: "bg-info/10", border: "border-info/30", label: "Info", color: "text-info" },
    tip: { bg: "bg-ok/10", border: "border-ok/30", label: "Tip", color: "text-ok" },
    note: { bg: "bg-accent/10", border: "border-accent/30", label: "Note", color: "text-accent" },
    warn: { bg: "bg-warn/10", border: "border-warn/30", label: "Warning", color: "text-warn" },
  };
  const t = map[tone];
  return (
    <div className={`callout ${t.bg} border ${t.border} rounded-md px-4 py-3 my-4 text-sm`}>
      <div className={`${t.color} text-[10px] tracking-[0.15em] uppercase font-bold mb-1`}>
        {t.label}
      </div>
      <div className="text-fg-2">{children}</div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono"
      style={{ background: `${color}22`, color }}
    >
      {children}
    </span>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
    >
      {children}
    </span>
  );
}

function PatternBlock({
  title,
  svg,
  desc,
  params,
}: {
  title: string;
  svg: React.ReactNode;
  desc: string;
  params: string;
}) {
  return (
    <div className="pattern-block grid grid-cols-[140px_1fr] gap-5 my-5 items-start">
      <div className="pattern-svg bg-surface-800 border border-line rounded-md p-2 aspect-square flex items-center justify-center">
        {svg}
      </div>
      <div>
        <h3 className="font-semibold text-fg mb-1">{title}</h3>
        <p className="text-fg-2 text-[14px] mb-2">{desc}</p>
        <p className="text-xs text-fg-4">
          <span className="uppercase tracking-wider">Params</span> · {params}
        </p>
      </div>
    </div>
  );
}

function Formula({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-800 border border-line rounded-md p-3">
      <div className="text-xs font-semibold text-accent mb-1">{title}</div>
      <div className="text-fg-2 text-[13px] leading-snug">{children}</div>
    </div>
  );
}

function ToolBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tool-block my-4">
      <h3 className="font-semibold text-fg mb-1">{title}</h3>
      <div className="text-fg-2 text-[15px]">{children}</div>
    </div>
  );
}

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 my-2">
      {tags.map((t) => (
        <code
          key={t}
          className="text-xs font-mono px-2 py-1 rounded bg-surface-800 border border-line text-fg-2"
        >
          {t}
        </code>
      ))}
    </div>
  );
}

/* ───────────────────────── inline SVG diagrams ───────────────────────── */

const axis = { stroke: "currentColor", strokeOpacity: 0.15 };
const pattern = { stroke: "#00d4ff", strokeWidth: 1.5, fill: "none", strokeDasharray: "3 3" };
const solid = { stroke: "#00d4ff", strokeWidth: 1.5, fill: "none" };
const datum = { fill: "#ef4444", stroke: "white", strokeWidth: 1.5 };

function ParallelSVG() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full text-fg-4">
      <rect x="1" y="1" width="118" height="118" {...axis} fill="none" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={10 + i * 20} y={10} width={20} height={100} {...pattern} />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={10} y={10 + i * 20} width={100} height={20} {...pattern} />
      ))}
      <circle cx="60" cy="60" r="4" {...datum} />
    </svg>
  );
}

function HexSVG() {
  const hex = (cx: number, cy: number, r: number) => {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(" ");
    return <polygon points={pts} {...pattern} />;
  };
  const r = 14;
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  const rows: React.ReactNode[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const cx = 15 + col * dx + (row % 2 ? dx / 2 : 0);
      const cy = 15 + row * dy;
      if (cx > 5 && cx < 115 && cy > 5 && cy < 115) {
        rows.push(<g key={`${row}-${col}`}>{hex(cx, cy, r)}</g>);
      }
    }
  }
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full text-fg-4">
      {rows}
      <circle cx="60" cy="60" r="4" {...datum} />
    </svg>
  );
}

function ExpandingSquareSVG() {
  const pts: [number, number][] = [[60, 60]];
  let x = 60, y = 60;
  let len = 10;
  const dirs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  for (let i = 0; i < 10; i++) {
    const [dx, dy] = dirs[i % 4];
    x += dx * len;
    y += dy * len;
    pts.push([x, y]);
    if (i % 2 === 1) len += 10;
  }
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      <path d={d} {...solid} />
      <circle cx="60" cy="60" r="4" {...datum} />
    </svg>
  );
}

function CorridorSVG() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      <path d="M 15 100 Q 40 40 70 60 T 110 20" stroke="#00d4ff" strokeWidth="1.5" fill="none" />
      <path d="M 15 100 Q 40 40 70 60 T 110 20" stroke="#00d4ff" strokeOpacity="0.35" strokeWidth="22" fill="none" strokeLinecap="round" />
      <circle cx="15" cy="100" r="4" {...datum} />
    </svg>
  );
}

function PointSVG() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      {[20, 35, 50].map((r) => (
        <circle key={r} cx="60" cy="60" r={r} {...pattern} />
      ))}
      <circle cx="60" cy="60" r="4" {...datum} />
    </svg>
  );
}

function ConeSVG() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      <path d="M 30 90 L 100 30 L 100 90 Z" stroke="#00d4ff" strokeWidth="1.5" fill="#00d4ff" fillOpacity="0.12" strokeDasharray="3 3" />
      <path d="M 25 95 L 40 80" stroke="#00d4ff" strokeWidth="1.5" markerEnd="url(#arr)" />
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#00d4ff" />
        </marker>
      </defs>
      <circle cx="30" cy="90" r="4" {...datum} />
    </svg>
  );
}

function LawnmowerSVG() {
  const pts: [number, number][] = [];
  let y = 15;
  let x = 15;
  const w = 90;
  let dir = 1;
  for (let i = 0; i < 8; i++) {
    pts.push([x, y]);
    x += dir * w;
    pts.push([x, y]);
    y += 13;
    dir = -dir;
  }
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full">
      <path d={d} {...solid} />
      <circle cx="15" cy="15" r="3" fill="#10b981" stroke="white" strokeWidth="1" />
    </svg>
  );
}
