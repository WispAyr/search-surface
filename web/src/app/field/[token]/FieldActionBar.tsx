"use client";

import { Navigation, Camera, FileText, Siren } from "lucide-react";

interface Props {
  onCheckin: () => void;
  onPhoto: () => void;
  onReport: () => void;
  onSOS: () => void;
  pending?: boolean;
}

// Fixed bottom action bar for the field view. Uses env(safe-area-inset-bottom)
// so iOS home-indicator devices don't eat the bottom row. Each button is a
// generous tap target (min-h-14) with icon + label stacked for one-hand use.
export function FieldActionBar({ onCheckin, onPhoto, onReport, onSOS, pending }: Props) {
  const baseBtn =
    "flex-1 flex flex-col items-center justify-center gap-1 py-3 text-[11px] font-medium transition disabled:opacity-60";
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-surface-700 bg-surface-900/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex">
        <button onClick={onCheckin} disabled={pending} className={`${baseBtn} text-fg-1 hover:bg-surface-800`}>
          <Navigation size={20} className="text-accent" />
          Check-in
        </button>
        <button onClick={onPhoto} disabled={pending} className={`${baseBtn} text-fg-1 hover:bg-surface-800 border-l border-surface-700`}>
          <Camera size={20} className="text-accent" />
          Photo
        </button>
        <button onClick={onReport} disabled={pending} className={`${baseBtn} text-fg-1 hover:bg-surface-800 border-l border-surface-700`}>
          <FileText size={20} className="text-accent" />
          Report
        </button>
        <button onClick={onSOS} className={`${baseBtn} text-white bg-red-600 hover:bg-red-500 border-l border-red-700`}>
          <Siren size={20} />
          SOS
        </button>
      </div>
    </nav>
  );
}
