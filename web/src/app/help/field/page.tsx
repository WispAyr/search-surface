"use client";

// Searcher Field Guide — one-pager aimed at volunteers using the field app on
// a phone while deployed. Deliberately short, with big headings, so an IC can
// print a stack of these and hand them out at briefing. Matches the A5/A6
// folded-leaflet style rather than the IC's long operator manual.

import Link from "next/link";
import { Printer, ArrowLeft, QrCode, MapPin, Camera, Radio, AlertTriangle, Signal, Battery, UserCheck } from "lucide-react";

export default function FieldGuidePage() {
  return (
    <div className="field-guide min-h-screen bg-white text-gray-900">
      <style>{`
        @media print {
          @page { size: A5; margin: 10mm; }
          .no-print { display: none !important; }
          .fg-section { page-break-inside: avoid; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .field-guide { font-family: ui-sans-serif, system-ui, sans-serif; }
      `}</style>

      {/* Screen toolbar */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm">
        <Link href="/help" className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={14} /> All manuals
        </Link>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded"
        >
          <Printer size={13} /> Print / Save PDF
        </button>
      </div>

      <article className="max-w-[640px] mx-auto px-5 py-6 space-y-5">
        {/* Cover */}
        <header className="fg-section border-b-2 border-gray-900 pb-3">
          <div className="text-[10px] uppercase tracking-[0.15em] text-gray-500">Searcher Field Guide</div>
          <h1 className="text-2xl font-bold mt-0.5">How to use your team&apos;s phone app</h1>
          <p className="text-sm text-gray-600 mt-1">
            Read this before you deploy. It takes two minutes. Keep it in your pocket.
          </p>
        </header>

        {/* 1 — Getting in */}
        <section className="fg-section">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
            <QrCode size={16} /> 1. Getting signed in
          </h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>
              Scan the <strong>team QR code</strong> your controller hands you, or open the link
              they send by SMS. The field app opens in your phone&apos;s browser — no app install.
            </li>
            <li>
              <strong>Name in</strong> if prompted. Your name appears next to every report
              you send. You can Skip to stay anonymous unless the operation requires naming.
            </li>
            <li>
              Allow the site <strong>location</strong> permission when the phone asks. Without
              GPS your reports won&apos;t carry a position.
            </li>
            <li>
              Add the page to your home screen for one-tap access (Share → Add to Home Screen on iOS,
              three-dot menu → Install on Android).
            </li>
          </ul>
        </section>

        {/* 2 — The four actions */}
        <section className="fg-section">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
            <Radio size={16} /> 2. The four actions at the bottom
          </h2>
          <dl className="text-sm space-y-2">
            <div>
              <dt className="font-medium flex items-center gap-2"><MapPin size={14} /> Check in</dt>
              <dd className="text-gray-700 pl-5">Sends your current GPS position. Tap it on arrival, at turning points, and any time the controller asks for a check.</dd>
            </div>
            <div>
              <dt className="font-medium flex items-center gap-2"><Camera size={14} /> Photo</dt>
              <dd className="text-gray-700 pl-5">Opens the camera. Shoot the clue or scene. Photo is tagged with your GPS and sent automatically.</dd>
            </div>
            <div>
              <dt className="font-medium flex items-center gap-2"><Radio size={14} /> Report</dt>
              <dd className="text-gray-700 pl-5">Short text report: clue, area clear, hazard, welfare. Pick the severity — info / warn / urgent.</dd>
            </div>
            <div>
              <dt className="font-medium flex items-center gap-2 text-red-700"><AlertTriangle size={14} /> SOS</dt>
              <dd className="text-gray-700 pl-5">Escalates to critical. Use only if you or a casualty needs help now. Confirms before sending.</dd>
            </div>
          </dl>
        </section>

        {/* 3 — The street checklist */}
        <section className="fg-section">
          <h2 className="text-base font-semibold mb-1">3. Street-clear checklist</h2>
          <p className="text-sm text-gray-700">
            When your zone has named streets, they appear as a list. Tap each street as you finish
            sweeping it. The bar at the top shows the percentage cleared. It saves offline — taps
            sync the moment your phone has signal.
          </p>
        </section>

        {/* 4 — Offline + battery */}
        <section className="fg-section">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
            <Signal size={16} /> 4. When you lose signal
          </h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>
              Everything you do — check-ins, photos, reports, street toggles — is <strong>queued on
              the phone</strong> and sent automatically when signal returns.
            </li>
            <li>
              An amber bar across the top means the app is offline. A number next to it shows how
              many messages are waiting.
            </li>
            <li>
              The map tiles you&apos;ve already scrolled through will stay visible offline. Zoom
              to your zone <em>before</em> you drop into a signal dead-spot.
            </li>
          </ul>
        </section>

        {/* 5 — GPS pill */}
        <section className="fg-section">
          <h2 className="text-base font-semibold mb-1">5. GPS status bar</h2>
          <p className="text-sm text-gray-700 mb-2">A coloured pill shows the GPS state when it needs attention:</p>
          <ul className="text-sm space-y-1">
            <li><span className="inline-block w-3 h-3 rounded bg-red-500/80 mr-2 align-middle" /> <strong>Red</strong> — denied or no fix. Step outside / check device location settings.</li>
            <li><span className="inline-block w-3 h-3 rounded bg-amber-500/80 mr-2 align-middle" /> <strong>Amber</strong> — last fix is more than 10 minutes old. Tap check-in to refresh.</li>
            <li><span className="inline-block w-3 h-3 rounded bg-white border border-gray-300 mr-2 align-middle" /> <strong>Hidden</strong> — GPS is healthy.</li>
          </ul>
        </section>

        {/* 6 — Re-identify */}
        <section className="fg-section">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
            <UserCheck size={16} /> 6. Changing your name
          </h2>
          <p className="text-sm text-gray-700">
            Tap the <em>named-as</em> pill in the top-right of the header to re-enter your name
            — useful when the phone is shared between searchers in a team.
          </p>
        </section>

        {/* 7 — Battery + safety */}
        <section className="fg-section">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
            <Battery size={16} /> 7. Battery &amp; safety
          </h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Start fully charged. GPS + screen-on drains 15-25% per hour.</li>
            <li>Carry a power-bank and cable. Don&apos;t run below 20% in the field — that&apos;s your lifeline.</li>
            <li>Always work in pairs. Radio comms take priority over phone reports in an emergency.</li>
            <li>If the phone dies, call your controller on the number on the reverse of your team card.</li>
          </ul>
        </section>

        {/* 8 — quick reference grid */}
        <section className="fg-section">
          <h2 className="text-base font-semibold mb-1">8. Quick reference</h2>
          <table className="w-full text-xs border border-gray-300 rounded overflow-hidden">
            <tbody>
              <tr className="border-b border-gray-200"><td className="px-2 py-1 bg-gray-50 font-medium w-1/2">Amber bar at top</td><td className="px-2 py-1">Offline — queued messages, will auto-send</td></tr>
              <tr className="border-b border-gray-200"><td className="px-2 py-1 bg-gray-50 font-medium">Red pill</td><td className="px-2 py-1">GPS denied or no fix</td></tr>
              <tr className="border-b border-gray-200"><td className="px-2 py-1 bg-gray-50 font-medium">No zone shown</td><td className="px-2 py-1">Controller hasn&apos;t assigned you yet — standby</td></tr>
              <tr className="border-b border-gray-200"><td className="px-2 py-1 bg-gray-50 font-medium">Strikethrough street</td><td className="px-2 py-1">Already cleared — don&apos;t tap again</td></tr>
              <tr><td className="px-2 py-1 bg-gray-50 font-medium">SOS confirmation</td><td className="px-2 py-1">Prevents accidental trigger — tap OK only for real emergency</td></tr>
            </tbody>
          </table>
        </section>

        <footer className="text-[10px] text-gray-500 pt-3 border-t border-gray-200">
          search.wispayr.online · Searcher Field Guide · keep this card with you
        </footer>
      </article>
    </div>
  );
}
