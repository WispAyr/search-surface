"use client";

import Link from "next/link";
import {
  Search,
  Radio,
  Map as MapIcon,
  Users,
  Radar,
  FileText,
  ShieldCheck,
  PhoneCall,
  ArrowRight,
} from "lucide-react";

// Public landing page shown at `/` when the caller isn't logged in.
// Intentionally dense but scannable — SAR leads tend to read the first screen
// then either sign up or close the tab.
export function MarketingLanding() {
  return (
    <div className="min-h-screen bg-surface-900 text-fg-1">
      {/* Nav */}
      <header className="border-b border-surface-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search size={20} className="text-accent" />
          <span className="font-semibold">Search Ops</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login" className="text-sm text-fg-2 hover:text-fg-1 px-3 py-1.5">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="text-sm bg-accent hover:bg-accent/80 text-black px-3 py-1.5 rounded font-medium"
          >
            Create team
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wider text-fg-4 border border-surface-700 rounded-full px-3 py-1 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          SAR command surface
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold leading-tight mb-5">
          Run a missing-person search without five open tabs.
        </h1>
        <p className="text-fg-3 text-lg max-w-2xl mx-auto mb-8">
          Zones, team positions, SITREPs, radio comms and sharable briefings — all on one map,
          driven live from the field. Free to start, your data stays yours.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="bg-accent hover:bg-accent/80 text-black font-medium px-5 py-2.5 rounded-lg text-sm inline-flex items-center gap-2"
          >
            Create your team
            <ArrowRight size={14} />
          </Link>
          <Link
            href="/login"
            className="text-sm text-fg-2 hover:text-fg-1 px-4 py-2.5"
          >
            Sign in →
          </Link>
        </div>
      </section>

      {/* Feature grid */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard
            icon={<MapIcon size={18} className="text-accent" />}
            title="Live operational map"
            body="Datum, zones, team positions, and real-time reports on one shared Leaflet view. Draw zones by hand or generate parallel grid, hex, expanding square in one click."
          />
          <FeatureCard
            icon={<Users size={18} className="text-accent" />}
            title="Field teams on their phones"
            body="Share a token URL — walkers and drivers get check-ins, street-clear checklists, photo reports and vehicle routes without installing anything."
          />
          <FeatureCard
            icon={<Radar size={18} className="text-accent" />}
            title="Bayesian POD tracking"
            body="Cumulative probability-of-detection updates as zones get swept. Sitrep numbers that actually mean something."
          />
          <FeatureCard
            icon={<Radio size={18} className="text-accent" />}
            title="Bring your own Zello"
            body="Plug in your Zello Work network and we ship PTT, incident-linked transcripts, and searcher location pings straight into the timeline."
          />
          <FeatureCard
            icon={<FileText size={18} className="text-accent" />}
            title="SITREPs and sharable briefings"
            body="Generate a formatted SITREP, email it to stakeholders, or hand out a read-only 72h briefing URL for partner agencies."
          />
          <FeatureCard
            icon={<ShieldCheck size={18} className="text-accent" />}
            title="Multi-tenant from day one"
            body="Every team's data is isolated. Three roles (owner, operator, viewer), full audit log, revocable shares and field-team tokens."
          />
        </div>
      </section>

      {/* Integrations + pricing note */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="border border-surface-700 rounded-xl p-6 bg-surface-800">
          <div className="flex items-start gap-3">
            <PhoneCall size={18} className="text-accent mt-0.5" />
            <div>
              <h3 className="text-base font-medium mb-1">Zello integration — BYO key</h3>
              <p className="text-sm text-fg-3">
                Search Ops talks to your own Zello Work network using a developer key you provide.
                We never see your audio — the PTT panel connects directly from the browser to
                Zello's WebSocket using a short-lived token we mint for you. No extra subscription
                from us, and you can switch providers at any time.
              </p>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-fg-4 mt-8">
          Free while in beta. No card required. Self-host or run on our infrastructure.
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-surface-700 px-6 py-6 text-center text-xs text-fg-4">
        search.wispayr.online · SAR command surface
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="border border-surface-700 rounded-lg p-5 bg-surface-800 hover:border-surface-600 transition">
      <div className="mb-3">{icon}</div>
      <h3 className="text-sm font-medium mb-2">{title}</h3>
      <p className="text-xs text-fg-3 leading-relaxed">{body}</p>
    </div>
  );
}
