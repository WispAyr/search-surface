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
  ArrowRight,
  Compass,
  Activity,
  Waves,
  MoveRight,
  Zap,
  Lock,
  AlertTriangle,
  Send,
  Hash,
  MessageCircle,
  Layers,
  Antenna,
  Wifi,
  LifeBuoy,
  Plane,
  Truck,
  Sparkles,
} from "lucide-react";

// Public landing shown at `/` for anonymous visitors. Scrollable long-form
// page — fixed background with aurora + grid, foreground content scrolls.
export function MarketingLanding() {
  return (
    <div className="relative min-h-screen text-fg-1 overflow-x-hidden">
      <AuroraBackdrop />

      {/* Beta disclaimer bar — always visible above nav */}
      <div className="relative z-50 bg-gradient-to-r from-[rgba(255,176,32,0.12)] via-[rgba(255,176,32,0.18)] to-[rgba(255,176,32,0.12)] border-b border-[rgba(255,176,32,0.25)] backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-center gap-2.5 text-[11px] sm:text-xs text-warn">
          <AlertTriangle size={13} className="shrink-0" />
          <span className="font-medium tracking-wide">
            Beta software · under active testing. Do not rely on Search Ops as your sole coordination tool during a live incident.
          </span>
        </div>
      </div>

      {/* Sticky glass nav */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[rgba(10,14,26,0.60)] border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LogoMark />
            <span className="font-semibold tracking-tight">Search Ops</span>
            <span className="hidden sm:inline ml-2 text-[10px] uppercase tracking-[0.18em] text-fg-4 border border-white/10 rounded-full px-2 py-0.5">
              Beta
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm text-fg-3">
            <a href="#features" className="hover:text-fg-1 transition">Features</a>
            <a href="#how" className="hover:text-fg-1 transition">How it works</a>
            <a href="#integrations" className="hover:text-fg-1 transition">Integrations</a>
            <a href="#security" className="hover:text-fg-1 transition">Security</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="text-sm text-fg-2 hover:text-fg-1 px-3 py-1.5 transition">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="relative text-sm font-medium text-black px-4 py-1.5 rounded-lg bg-gradient-to-b from-[#00e6ff] to-[#00a0c4] shadow-[0_0_0_1px_rgba(0,0,0,0.2),0_8px_24px_-8px_rgba(0,212,255,0.6)] hover:from-[#33ecff] transition"
            >
              Create team
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative">
        <div className="max-w-5xl mx-auto px-6 pt-24 md:pt-32 pb-20 md:pb-28 text-center">
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-fg-3 bg-white/[0.03] border border-white/10 rounded-full px-3 py-1.5 mb-8 backdrop-blur-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/70" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent" />
            </span>
            Purpose-built for search &amp; rescue command
          </div>

          <h1 className="text-[2.5rem] sm:text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.05] mb-6">
            Run a missing-person search{" "}
            <span className="relative inline-block">
              <span className="bg-clip-text text-transparent bg-gradient-to-br from-[#7df4ff] via-[#00d4ff] to-[#2a7fff]">
                without five open tabs.
              </span>
              <span className="absolute inset-x-0 -bottom-2 h-[3px] bg-gradient-to-r from-transparent via-accent/80 to-transparent" aria-hidden />
            </span>
          </h1>

          <p className="text-fg-3 text-base md:text-lg max-w-2xl mx-auto mb-9 leading-relaxed">
            Zones, team positions, SITREPs, radio comms and sharable briefings — all on one live map, driven straight from the field. Stand up an operation in under three minutes.
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/signup"
              className="group relative text-black font-medium px-6 py-3 rounded-xl text-sm inline-flex items-center gap-2 bg-gradient-to-b from-[#00e6ff] to-[#00a0c4] shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_20px_60px_-20px_rgba(0,212,255,0.65)] hover:shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_28px_70px_-18px_rgba(0,212,255,0.85)] transition"
            >
              Create your team
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/login"
              className="text-sm text-fg-2 hover:text-fg-1 px-4 py-3 inline-flex items-center gap-2 transition"
            >
              Sign in
              <MoveRight size={14} />
            </Link>
          </div>

          {/* Micro trust line */}
          <p className="mt-8 text-xs text-fg-4 tracking-wide">
            Free while in beta · No card required · Your data stays yours
          </p>
        </div>

        {/* Mock dashboard preview */}
        <div className="max-w-6xl mx-auto px-6 pb-24 md:pb-32">
          <MockDashboard />
        </div>
      </section>

      {/* ─── Stats strip ─── */}
      <section className="border-y border-white/5 bg-[rgba(15,20,36,0.35)] backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat value="< 3 min" label="to stand up an operation" />
          <Stat value="Live" label="field-to-command updates" />
          <Stat value="BYOK · 7 channels" label="cross-channel comms, your keys" />
          <Stat value="0" label="audio hits our servers" />
        </div>
      </section>

      {/* ─── Feature grid ─── */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="text-center mb-14 md:mb-16">
          <div className="text-[11px] uppercase tracking-[0.22em] text-accent mb-3">Capabilities</div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Built for the way real searches run.</h2>
          <p className="text-fg-3 mt-3 max-w-2xl mx-auto">
            Every panel exists because a volunteer asked for it at 3 a.m. on a moor. No busywork, no seat-licences, no surprises.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <FeatureCard
            icon={<MapIcon size={18} />}
            title="Live operational map"
            body="Datum, zones, team positions, and real-time reports on one Leaflet view. Draw zones by hand or generate parallel grid, hex, or expanding square in one click."
          />
          <FeatureCard
            icon={<Users size={18} />}
            title="Field teams on their phones"
            body="Share a token URL — walkers and drivers get check-ins, street-clear checklists, photo reports and vehicle routes without installing anything."
          />
          <FeatureCard
            icon={<Radar size={18} />}
            title="Bayesian POD tracking"
            body="Cumulative probability-of-detection updates as zones get swept. Sitrep numbers that actually mean something."
          />
          <FeatureCard
            icon={<Radio size={18} />}
            title="Bring your own Zello"
            body="Plug in your Zello Work network and we ship PTT, incident-linked transcripts, and searcher location pings straight into the timeline."
          />
          <FeatureCard
            icon={<FileText size={18} />}
            title="SITREPs &amp; sharable briefings"
            body="Generate a formatted SITREP, email stakeholders, or hand out a read-only 72h briefing URL for partner agencies."
          />
          <FeatureCard
            icon={<ShieldCheck size={18} />}
            title="Multi-tenant from day one"
            body="Every team's data is isolated. Three roles (owner, operator, viewer), full audit log, revocable shares and field-team tokens."
          />
        </div>

        {/* Roadmap */}
        <div className="mt-20 md:mt-24">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-accent">
              <Sparkles size={12} /> On the roadmap
            </div>
            <h3 className="text-2xl md:text-3xl font-semibold tracking-tight mt-2">Shipping next.</h3>
            <p className="text-fg-3 mt-3 max-w-2xl mx-auto text-sm">
              Features in active design — pinned here so teams can plan around them.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <FeatureCard
              icon={<Waves size={18} />}
              title="Coastline sweep zones"
              badge="Overlay live"
              body="Live now: shoreline polyline overlays your incident area (toggle in SAR tools). Shipping next: click two headlands to auto-generate a corridor zone with tide-aware timing. For beach and cliff-base searches where a polygon is the wrong shape."
            />
            <FeatureCard
              icon={<LifeBuoy size={18} />}
              title="Life-saving equipment"
              badge="Live"
              body="Public lifebuoys, rescue stations, lifeguard towers/bases, emergency phones and throw lines overlay the map near the shoreline. Teams know what's already on site before they commit kit."
            />
            <FeatureCard
              icon={<Truck size={18} />}
              title="RVP &amp; asset register"
              body="Rendezvous points, ICP, staging areas as first-class datums. Track every asset your team can call on — deployed, available, or en-route."
            />
            <FeatureCard
              icon={<Plane size={18} />}
              title="Live helicopter &amp; boat coverage"
              body="Plug in ADS-B or AIS for a deployed asset and its sweep area paints itself live — no drawing, no after-action reconstruction. Automatically excluded from unsearched area."
            />
          </div>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section id="how" className="relative border-y border-white/5 bg-[rgba(15,20,36,0.35)]">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-28">
          <div className="text-center mb-12">
            <div className="text-[11px] uppercase tracking-[0.22em] text-accent mb-3">Get going</div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Three moves, one operation.</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Step
              n={1}
              icon={<Compass size={18} />}
              title="Create an incident"
              body="Drop a datum, pick an operation type, add subject info. Auto-seeds LPB rings, hazards, and attractor POIs."
            />
            <Step
              n={2}
              icon={<Activity size={18} />}
              title="Assign teams &amp; zones"
              body="Generate search patterns from the datum or draw zones freehand. Hand teams a token URL — they're live on the map."
            />
            <Step
              n={3}
              icon={<Waves size={18} />}
              title="Run it, then hand it off"
              body="Watch POD climb, log comms, take field reports. One click for a full SITREP or a 72-hour briefing URL."
            />
          </div>
        </div>
      </section>

      {/* ─── Zello callout ─── */}
      <section id="zello" className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-accent mb-3">Integration · Zello</div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
              Your Zello Work network, connected to your ops map.
            </h2>
            <p className="text-fg-3 leading-relaxed mb-6">
              Drop in a developer key from your own Zello account. The PTT panel connects directly from the browser to Zello using a short-lived token we mint for you — audio never transits our infrastructure. No per-seat licence from us, switch providers anytime.
            </p>
            <ul className="space-y-2.5 text-sm text-fg-2 mb-7">
              <CheckItem>Channel logon with RS256 JWT signed server-side</CheckItem>
              <CheckItem>Incoming text, location, image events pinned to the timeline</CheckItem>
              <CheckItem>Searcher location pings drop straight on the map</CheckItem>
              <CheckItem>Encrypted at rest · AES-256-GCM per-tenant</CheckItem>
            </ul>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:text-[#7df4ff] transition"
            >
              Wire up your key <ArrowRight size={14} />
            </Link>
          </div>

          <MockZelloPanel />
        </div>
      </section>

      {/* ─── Integrations grid ─── */}
      <section id="integrations" className="border-y border-white/5 bg-[rgba(15,20,36,0.35)]">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-28">
          <div className="text-center mb-12 md:mb-14">
            <div className="text-[11px] uppercase tracking-[0.22em] text-accent mb-3">Comms · BYOK</div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">One message, every channel.</h2>
            <p className="text-fg-3 mt-3 max-w-2xl mx-auto">
              Plug in your own bot tokens, webhooks and server creds. A message typed in ops, or one received from the field, fans out across every channel you&apos;ve wired up — keys never leave your tenant.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 text-[11px] text-fg-3 bg-white/[0.04] border border-white/10 rounded-full px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00e88f] shadow-[0_0_10px_rgba(0,232,143,0.7)]" />
              Cross-channel routing · AES-256-GCM at rest
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <IntegrationTile
              icon={<Radio size={18} />}
              name="Zello"
              body="Direct-to-browser PTT. Audio never hits our servers."
              color="#ffd54a"
            />
            <IntegrationTile
              icon={<Send size={18} />}
              name="Telegram"
              body="Bot API · outbound alerts and inbound via webhook."
              color="#2aabee"
            />
            <IntegrationTile
              icon={<Hash size={18} />}
              name="Slack"
              body="Incoming webhook · fan-out into your ops channel."
              color="#4a154b"
            />
            <IntegrationTile
              icon={<MessageCircle size={18} />}
              name="Discord"
              body="Server webhook with username override."
              color="#5865f2"
            />
            <IntegrationTile
              icon={<Layers size={18} />}
              name="Matrix"
              body="Self-host or matrix.org. E2EE optional."
              color="#00bfa5"
              soon
            />
            <IntegrationTile
              icon={<Antenna size={18} />}
              name="TAK"
              body="CoT over TLS · tactical interop with SARCOP/WinTAK."
              color="#4ade80"
              soon
            />
            <IntegrationTile
              icon={<Wifi size={18} />}
              name="Broadnet"
              body="Resilience partners &amp; community radio bridge."
              color="#f97316"
              soon
            />
            <IntegrationTile
              icon={<Radio size={18} />}
              name="Bring your own"
              body="Adapter SDK · drop in a custom bridge in ~60 lines."
              color="#7df4ff"
            />
          </div>

          <div className="text-center mt-10">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:text-[#7df4ff] transition"
            >
              Start wiring up your channels <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Security strip ─── */}
      <section id="security" className="border-y border-white/5 bg-[rgba(15,20,36,0.35)]">
        <div className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          <SecurityItem
            icon={<Lock size={16} />}
            title="Tenant isolation"
            body="Every query scoped to your team id. No shared tables, no accidental cross-reads."
          />
          <SecurityItem
            icon={<ShieldCheck size={16} />}
            title="Encrypted secrets"
            body="Zello keys, share tokens and sessions held in AES-256-GCM at rest. Scrypt-hashed passwords."
          />
          <SecurityItem
            icon={<Zap size={16} />}
            title="Short-lived tokens"
            body="Share URLs and field-team links expire. Revoke at any time from the operation's audit tab."
          />
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="max-w-3xl mx-auto px-6 py-24 md:py-32 text-center">
        <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-tight mb-5">
          Stand up your next operation in{" "}
          <span className="bg-clip-text text-transparent bg-gradient-to-br from-[#7df4ff] via-[#00d4ff] to-[#2a7fff]">three minutes.</span>
        </h2>
        <p className="text-fg-3 mb-8">Free while in beta. No card. Invite your whole team.</p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/signup"
            className="text-black font-medium px-6 py-3 rounded-xl text-sm inline-flex items-center gap-2 bg-gradient-to-b from-[#00e6ff] to-[#00a0c4] shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_20px_60px_-20px_rgba(0,212,255,0.65)] hover:shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_28px_70px_-18px_rgba(0,212,255,0.85)] transition"
          >
            Create your team <ArrowRight size={14} />
          </Link>
          <Link href="/login" className="text-sm text-fg-2 hover:text-fg-1 px-4 py-3">
            Sign in →
          </Link>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-white/5 bg-[rgba(10,14,26,0.6)] backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-fg-4">
          <div className="flex items-center gap-2">
            <LogoMark small />
            <span>search.wispayr.online</span>
          </div>
          <div>SAR command surface · © {new Date().getFullYear()} WispAyr</div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────

function AuroraBackdrop() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(1200px_800px_at_20%_-10%,rgba(0,212,255,0.22),transparent_60%),radial-gradient(1000px_700px_at_85%_10%,rgba(42,127,255,0.22),transparent_60%),radial-gradient(900px_700px_at_60%_100%,rgba(125,244,255,0.12),transparent_60%)]" />
      {/* Deep base */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,#070b16_0%,#0a0e1a_40%,#0a0e1a_100%)] mix-blend-normal" />
      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.06) 1px,transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "radial-gradient(ellipse at 50% 30%, black 40%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 30%, black 40%, transparent 80%)",
        }}
      />
      {/* Animated glow */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-[radial-gradient(closest-side,rgba(0,212,255,0.18),transparent_70%)] blur-3xl animate-pulse-slow" />
      <style>{`
        @keyframes pulse-slow { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }
        .animate-pulse-slow { animation: pulse-slow 8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

function LogoMark({ small = false }: { small?: boolean }) {
  const size = small ? 16 : 22;
  return (
    <div className={`relative ${small ? "w-5 h-5" : "w-7 h-7"} flex items-center justify-center rounded-md bg-gradient-to-br from-[#00e6ff] to-[#2a7fff] shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_6px_18px_-6px_rgba(0,212,255,0.6)]`}>
      <Search size={size - 8} className="text-black" strokeWidth={2.5} />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  badge?: string;
}) {
  return (
    <div className="group relative rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0))] p-6 backdrop-blur-sm overflow-hidden transition hover:border-accent/30">
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-60" />
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition duration-500 bg-[radial-gradient(400px_150px_at_50%_0%,rgba(0,212,255,0.12),transparent_70%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="inline-flex w-10 h-10 items-center justify-center rounded-lg bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/20 text-accent">
            {icon}
          </div>
          {badge && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
              {badge}
            </span>
          )}
        </div>
        <h3 className="text-[15px] font-medium mb-2 tracking-tight">{title}</h3>
        <p className="text-sm text-fg-3 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center md:text-left">
      <div className="text-2xl md:text-3xl font-semibold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-white to-[#7df4ff]">
        {value}
      </div>
      <div className="text-xs text-fg-4 mt-1 tracking-wide uppercase">{label}</div>
    </div>
  );
}

function Step({ n, icon, title, body }: { n: number; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="relative rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))] p-6 overflow-hidden">
      <div className="absolute top-4 right-4 text-[64px] leading-none font-semibold text-white/[0.035] tabular-nums">
        {n.toString().padStart(2, "0")}
      </div>
      <div className="relative">
        <div className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-accent/10 border border-accent/20 text-accent mb-4">
          {icon}
        </div>
        <h3 className="text-base font-medium mb-2">{title}</h3>
        <p className="text-sm text-fg-3 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function IntegrationTile({ icon, name, body, color, soon = false }: {
  icon: React.ReactNode;
  name: string;
  body: string;
  color: string;
  soon?: boolean;
}) {
  return (
    <div className="group relative rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0))] p-4 backdrop-blur-sm overflow-hidden transition hover:border-accent/30">
      <div
        className="absolute inset-x-0 -top-px h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${color}66, transparent)` }}
      />
      <div className="flex items-start gap-3">
        <div
          className="inline-flex w-9 h-9 items-center justify-center rounded-lg border shrink-0"
          style={{
            background: `linear-gradient(135deg, ${color}26, ${color}08)`,
            borderColor: `${color}40`,
            color,
          }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-fg-1">{name}</span>
            {soon && (
              <span className="text-[9px] uppercase tracking-wider text-fg-4 border border-white/10 rounded px-1.5 py-0.5">
                soon
              </span>
            )}
          </div>
          <p className="text-xs text-fg-3 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-1.5 flex-none w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_12px_rgba(0,212,255,0.6)]" />
      <span>{children}</span>
    </li>
  );
}

function SecurityItem({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div>
      <div className="inline-flex w-8 h-8 items-center justify-center rounded-md bg-white/[0.04] border border-white/10 text-accent mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-medium mb-1.5">{title}</h3>
      <p className="text-xs text-fg-3 leading-relaxed">{body}</p>
    </div>
  );
}

function MockDashboard() {
  return (
    <div className="relative rounded-2xl border border-white/10 bg-[rgba(10,14,26,0.7)] backdrop-blur-xl overflow-hidden shadow-[0_40px_120px_-30px_rgba(0,212,255,0.4),0_0_0_1px_rgba(255,255,255,0.05)]">
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
      {/* Mock chrome */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/70" />
        <span className="ml-4 text-[11px] text-fg-4 font-mono">search.wispayr.online/ops/missing-person-ayr-beach</span>
      </div>

      <div className="grid grid-cols-12 gap-0 min-h-[360px] md:min-h-[440px]">
        {/* Map column */}
        <div className="col-span-12 md:col-span-8 relative bg-[radial-gradient(600px_400px_at_30%_40%,rgba(0,212,255,0.08),transparent),linear-gradient(180deg,#0a0e1a,#070b16)] border-r border-white/5 overflow-hidden">
          {/* Grid background */}
          <div className="absolute inset-0 opacity-30" style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.05) 1px,transparent 1px)",
            backgroundSize: "28px 28px",
          }} />

          {/* Zones */}
          <svg viewBox="0 0 400 300" className="absolute inset-0 w-full h-full">
            <defs>
              <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(0,212,255,0.25)" strokeWidth="1" />
              </pattern>
            </defs>
            <polygon points="70,90 160,80 175,150 80,165" fill="url(#hatch)" stroke="#00d4ff" strokeWidth="1.2" opacity="0.9" />
            <polygon points="180,85 270,75 285,140 190,155" fill="rgba(0,232,143,0.12)" stroke="#00e88f" strokeWidth="1.2" opacity="0.9" />
            <polygon points="90,175 180,165 195,235 100,250" fill="rgba(255,176,32,0.10)" stroke="#ffb020" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.9" />
            <polygon points="200,165 295,155 310,225 215,240" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" strokeDasharray="3 3" />
            {/* LPB rings */}
            <circle cx="200" cy="150" r="40" fill="none" stroke="rgba(0,212,255,0.35)" strokeDasharray="2 3" />
            <circle cx="200" cy="150" r="80" fill="none" stroke="rgba(0,212,255,0.25)" strokeDasharray="2 3" />
            <circle cx="200" cy="150" r="120" fill="none" stroke="rgba(0,212,255,0.15)" strokeDasharray="2 3" />
            {/* Datum */}
            <circle cx="200" cy="150" r="5" fill="#00d4ff" />
            <circle cx="200" cy="150" r="10" fill="none" stroke="#00d4ff" opacity="0.5">
              <animate attributeName="r" from="6" to="18" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" from="0.8" to="0" dur="2s" repeatCount="indefinite" />
            </circle>
            {/* Teams */}
            <g>
              <circle cx="115" cy="125" r="4" fill="#00e88f" />
              <text x="122" y="128" fontSize="8" fill="rgba(255,255,255,0.6)" fontFamily="ui-monospace, monospace">A1</text>
            </g>
            <g>
              <circle cx="225" cy="115" r="4" fill="#00e88f" />
              <text x="232" y="118" fontSize="8" fill="rgba(255,255,255,0.6)" fontFamily="ui-monospace, monospace">A2</text>
            </g>
            <g>
              <circle cx="150" cy="210" r="4" fill="#ffb020" />
              <text x="157" y="213" fontSize="8" fill="rgba(255,255,255,0.6)" fontFamily="ui-monospace, monospace">B1</text>
            </g>
            <g>
              <circle cx="255" cy="195" r="4" fill="#00e88f" />
              <text x="262" y="198" fontSize="8" fill="rgba(255,255,255,0.6)" fontFamily="ui-monospace, monospace">B2</text>
            </g>
          </svg>

          <div className="absolute top-3 left-3 text-[10px] font-mono text-fg-4 bg-white/[0.04] border border-white/10 rounded px-2 py-1 backdrop-blur-sm">
            55.4615°N · −4.6299°E
          </div>
          <div className="absolute bottom-3 left-3 text-[10px] font-mono text-fg-4 bg-white/[0.04] border border-white/10 rounded px-2 py-1 backdrop-blur-sm">
            POD cumulative · 62%
          </div>
          <div className="absolute bottom-3 right-3 flex gap-1">
            <span className="w-6 h-6 bg-white/[0.06] border border-white/10 rounded text-fg-4 flex items-center justify-center text-xs">＋</span>
            <span className="w-6 h-6 bg-white/[0.06] border border-white/10 rounded text-fg-4 flex items-center justify-center text-xs">−</span>
          </div>
        </div>

        {/* Panel column */}
        <div className="col-span-12 md:col-span-4 bg-[rgba(10,14,26,0.6)]">
          <div className="flex text-[11px] border-b border-white/5 text-fg-4 font-medium">
            <span className="px-3 py-2.5 text-accent border-b-2 border-accent bg-white/[0.03]">Zones</span>
            <span className="px-3 py-2.5">Teams</span>
            <span className="px-3 py-2.5">Comms</span>
            <span className="px-3 py-2.5">Zello</span>
          </div>
          <div className="p-4 space-y-3">
            <ZoneRow name="Zone α · Beach east" status="cleared" pct={100} color="#00d4ff" />
            <ZoneRow name="Zone β · Caravan park" status="cleared" pct={100} color="#00e88f" />
            <ZoneRow name="Zone γ · Dunes south" status="active" pct={58} color="#ffb020" />
            <ZoneRow name="Zone δ · Esplanade" status="pending" pct={0} color="rgba(255,255,255,0.35)" />

            <div className="pt-3 border-t border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-fg-4 mb-2">Latest comms</div>
              <div className="text-xs space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  <span><span className="text-fg-2">Team A1</span> <span className="text-fg-4">cleared north path; moving to γ</span></span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-[#00e88f] shrink-0" />
                  <span><span className="text-fg-2">Team B2</span> <span className="text-fg-4">eyewitness, 14:32, pink jacket</span></span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-[#ffb020] shrink-0" />
                  <span><span className="text-fg-2">Control</span> <span className="text-fg-4">tide rising, hold β perimeter</span></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoneRow({ name, status, pct, color }: { name: string; status: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          <span className="text-fg-2">{name}</span>
        </div>
        <span className="text-fg-4 uppercase tracking-wider text-[10px]">{status}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function MockZelloPanel() {
  return (
    <div className="relative rounded-2xl border border-white/10 bg-[rgba(10,14,26,0.7)] backdrop-blur-xl p-5 shadow-[0_30px_80px_-30px_rgba(0,212,255,0.3)]">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/30 to-transparent border border-accent/40 flex items-center justify-center">
          <Radio size={14} className="text-accent" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium">SAR Ops · channel</div>
          <div className="text-[11px] text-fg-4 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00e88f]" />
            Connected · 4 listeners
          </div>
        </div>
        <span className="text-[10px] text-fg-4 font-mono">JWT exp 59:42</span>
      </div>

      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto pr-1">
        <ZelloMsg who="Control" when="14:31" body="All teams radio check" kind="text" />
        <ZelloMsg who="Team A1" when="14:31" body="Loud and clear" kind="text" />
        <ZelloMsg who="Team B2" when="14:32" body="📍 55.461, −4.628" kind="location" />
        <ZelloMsg who="Team A2" when="14:33" body="Voice TX · 3.2s" kind="voice" />
        <ZelloMsg who="Team B1" when="14:35" body="Image report attached" kind="image" />
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-white/5">
        <input
          readOnly
          placeholder="Message channel…"
          className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-fg-3 placeholder-fg-4"
        />
        <button className="px-3 py-2 rounded-lg bg-gradient-to-b from-[#00e6ff] to-[#00a0c4] text-black text-xs font-medium">
          Send
        </button>
      </div>
    </div>
  );
}

function ZelloMsg({ who, when, body, kind }: { who: string; when: string; body: string; kind: "text" | "location" | "voice" | "image" }) {
  const kindColor = kind === "text" ? "bg-accent" : kind === "location" ? "bg-[#00e88f]" : kind === "voice" ? "bg-[#ffb020]" : "bg-[#a78bfa]";
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${kindColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-fg-2 font-medium">{who}</span>
          <span className="text-[10px] text-fg-4 font-mono">{when}</span>
        </div>
        <div className="text-xs text-fg-3 leading-relaxed truncate">{body}</div>
      </div>
    </div>
  );
}
