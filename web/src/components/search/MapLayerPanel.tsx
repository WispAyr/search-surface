"use client";

import { useSearchStore } from "@/stores/search";
import { BASEMAPS } from "./SearchMap3D";
import { X, Mountain, Box, Layers, MapPin, Users, Tag, Sun, Waves } from "lucide-react";
import type { MapPrefs } from "@/lib/api";

/** Slide-in preferences panel for the map view — basemap + layer toggles.
 *  Every change goes through `updateMapPrefs` which debounces a PUT to the
 *  preferences API so each team member keeps their own defaults across
 *  sessions and devices. */
export function MapLayerPanel() {
  const { mapPrefs, updateMapPrefs, setShowMapLayerPanel } = useSearchStore();

  return (
    <div className="absolute top-12 right-3 z-[1050] w-72 bg-surface-800/95 backdrop-blur border border-surface-600 rounded-lg shadow-2xl text-fg-1">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-3">Map preferences</div>
        <button
          onClick={() => setShowMapLayerPanel(false)}
          className="text-fg-4 hover:text-fg-1"
          aria-label="Close map preferences"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-3 space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Basemap picker */}
        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-4 mb-1.5">Basemap</div>
          <div className="grid grid-cols-2 gap-1.5">
            {BASEMAPS.map((bm) => (
              <button
                key={bm.id}
                onClick={() => updateMapPrefs({ basemap: bm.id })}
                className={`px-2 py-2 rounded text-[11px] text-left border transition ${
                  mapPrefs.basemap === bm.id
                    ? "bg-accent/20 border-accent text-accent"
                    : "bg-surface-900 border-surface-600 text-fg-2 hover:border-surface-500"
                }`}
              >
                {bm.label}
              </button>
            ))}
          </div>
        </section>

        {/* 3D view */}
        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-4 mb-1.5">3D view</div>
          <Toggle
            label="Enable 3D"
            icon={<Box size={14} />}
            value={mapPrefs.show_3d}
            onChange={(v) => updateMapPrefs({ show_3d: v })}
          />
          <Toggle
            label="Terrain relief"
            icon={<Mountain size={14} />}
            value={mapPrefs.show_terrain}
            onChange={(v) => updateMapPrefs({ show_terrain: v })}
            disabled={!mapPrefs.show_3d}
          />
          <Toggle
            label="Extrude zones"
            icon={<Layers size={14} />}
            value={mapPrefs.extrude_zones}
            onChange={(v) => updateMapPrefs({ extrude_zones: v })}
            disabled={!mapPrefs.show_3d}
          />

          {mapPrefs.show_3d && (
            <div className="mt-2 pl-1 space-y-2">
              <RangeField
                label="Pitch"
                min={0}
                max={75}
                step={1}
                value={mapPrefs.pitch}
                suffix="°"
                onChange={(v) => updateMapPrefs({ pitch: v })}
              />
              <RangeField
                label="Terrain exaggeration"
                min={0}
                max={3}
                step={0.1}
                value={mapPrefs.exaggeration}
                suffix="×"
                onChange={(v) => updateMapPrefs({ exaggeration: v })}
              />
            </div>
          )}
        </section>

        {/* Optional layers */}
        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-4 mb-1.5">Layers</div>
          <Toggle
            label="Hillshading"
            icon={<Sun size={14} />}
            value={mapPrefs.show_hillshade}
            onChange={(v) => updateMapPrefs({ show_hillshade: v })}
          />
          <Toggle
            label="Datums"
            icon={<MapPin size={14} />}
            value={mapPrefs.show_datums}
            onChange={(v) => updateMapPrefs({ show_datums: v })}
          />
          <Toggle
            label="Teams"
            icon={<Users size={14} />}
            value={mapPrefs.show_teams}
            onChange={(v) => updateMapPrefs({ show_teams: v })}
          />
          <Toggle
            label="Zone labels"
            icon={<Tag size={14} />}
            value={mapPrefs.show_zone_labels}
            onChange={(v) => updateMapPrefs({ show_zone_labels: v })}
          />
          <Toggle
            label="Tide overlay (intertidal)"
            icon={<Waves size={14} />}
            value={!!mapPrefs.show_tide_overlay}
            onChange={(v) => updateMapPrefs({ show_tide_overlay: v })}
          />
        </section>

        <p className="text-[10px] text-fg-4 leading-relaxed">
          Saved to your account — these preferences follow you to any device you sign in on.
        </p>
      </div>
    </div>
  );
}

function Toggle({
  label,
  icon,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  icon?: React.ReactNode;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-[11px] transition ${
        disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-700/60"
      }`}
    >
      <span className="flex items-center gap-2 text-fg-2">
        {icon}
        {label}
      </span>
      <span
        className={`inline-flex items-center w-8 h-4 rounded-full transition ${
          value ? "bg-accent" : "bg-surface-600"
        }`}
      >
        <span
          className={`inline-block w-3 h-3 rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  suffix,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-[11px] text-fg-3">
      <span className="flex items-center justify-between mb-0.5">
        <span>{label}</span>
        <span className="font-mono text-fg-2">{value.toFixed(step < 1 ? 1 : 0)}{suffix}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}
