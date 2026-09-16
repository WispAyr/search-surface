"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";

type PremiseFeature = {
  name: string;
  lat: number;
  lon: number;
  distance_km: number;
  category: string;
  subcategory?: string;
  subcategory_tag?: string;
  tags?: Record<string, string>;
};

type ProximityResult = {
  preset: string;
  label: string;
  center: { lat: number; lon: number };
  radius_m: number;
  count: number;
  features: PremiseFeature[];
};

// Colour per OSM sub-category family for the broad "businesses" preset.
// For a narrower preset the whole layer gets a single category colour
// (picked by preset name via PRESET_COLOURS below).
const SUBCATEGORY_COLOURS: Record<string, string> = {
  shop: "#06b6d4",         // cyan
  amenity: "#f59e0b",      // amber
  tourism: "#a855f7",      // purple
  office: "#64748b",       // slate
  craft: "#eab308",        // yellow
};

const PRESET_COLOURS: Record<string, string> = {
  businesses: "#f59e0b",
  hospital: "#ef4444",
  pharmacy: "#22c55e",
  defibrillator: "#ef4444",
  police: "#3b82f6",
  fire_station: "#ef4444",
  hotel: "#a855f7",
  camp_site: "#22c55e",
  school: "#eab308",
  place_of_worship: "#a855f7",
  library: "#eab308",
  sports_centre: "#22c55e",
  fuel: "#ef4444",
  supermarket: "#06b6d4",
  post_office: "#ef4444",
  atm: "#22c55e",
  lifeboat: "#ef4444",
};

function dotIcon(colour: string) {
  return L.divIcon({
    html: `<div style="width:10px;height:10px;background:${colour};border:2px solid white;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.6)"></div>`,
    className: "",
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function escapeHtml(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] as string));
}

function buildPopup(f: PremiseFeature): string {
  const t = f.tags || {};
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const addrLine = [street, t["addr:city"], t["addr:postcode"]].filter(Boolean).join(", ");
  const phone = t.phone || t["contact:phone"];
  const website = t.website || t["contact:website"];
  const hours = t.opening_hours;
  const sub = f.subcategory ? `${f.subcategory}${f.subcategory_tag ? ` (${f.subcategory_tag})` : ""}` : "";
  const distM = Math.round(f.distance_km * 1000);

  const lines = [
    `<b>${escapeHtml(f.name)}</b>`,
    sub ? `<span style="color:#888;font-size:11px">${escapeHtml(sub)}</span>` : null,
    addrLine ? `<span style="font-size:11px">${escapeHtml(addrLine)}</span>` : null,
    phone ? `<span style="font-size:11px">☎ <a href="tel:${encodeURIComponent(phone)}">${escapeHtml(phone)}</a></span>` : null,
    website ? `<span style="font-size:11px">🌐 <a href="${escapeHtml(website)}" target="_blank" rel="noreferrer noopener">site</a></span>` : null,
    hours ? `<span style="font-size:11px">🕑 ${escapeHtml(hours)}</span>` : null,
    `<span style="color:#888;font-size:10px">${distM} m from datum</span>`,
  ].filter(Boolean);

  return `<div style="display:flex;flex-direction:column;gap:2px;max-width:240px">${lines.join("")}</div>`;
}

interface PremisesLayerProps {
  visible: boolean;
  datumLat: number | null | undefined;
  datumLon: number | null | undefined;
  preset: string;
  radiusM: number;
}

export function PremisesLayer({ visible, datumLat, datumLon, preset, radiusM }: PremisesLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [features, setFeatures] = useState<PremiseFeature[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch whenever inputs change. Debounced so dragging sliders doesn't hammer
  // the siphon proxy (which in turn rate-limits Overpass upstream).
  useEffect(() => {
    if (!visible || datumLat == null || datumLon == null) {
      setFeatures([]);
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const qs = new URLSearchParams({
          preset,
          lat: String(datumLat),
          lon: String(datumLon),
          radius: String(radiusM),
        });
        const base = process.env.NEXT_PUBLIC_API_BASE || "/api";
        const resp = await fetch(`${base}/siphon/osm/proximity?${qs}`, {
          credentials: "include",
          signal: ctrl.signal,
        });
        if (!resp.ok) {
          setFeatures([]);
          return;
        }
        const data = (await resp.json()) as ProximityResult;
        setFeatures(data.features || []);
      } catch (e: unknown) {
        if ((e as { name?: string })?.name !== "AbortError") setFeatures([]);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [visible, datumLat, datumLon, preset, radiusM]);

  // Render/hide markers
  useEffect(() => {
    if (!map) return;
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!visible || features.length === 0) return;

    const group = L.layerGroup();
    const presetColour = PRESET_COLOURS[preset] || "#f59e0b";

    for (const f of features) {
      const colour =
        preset === "businesses" && f.subcategory_tag
          ? SUBCATEGORY_COLOURS[f.subcategory_tag] || presetColour
          : presetColour;
      const m = L.marker([f.lat, f.lon], { icon: dotIcon(colour) });
      m.bindPopup(buildPopup(f), { maxWidth: 260 });
      m.bindTooltip(f.name, { direction: "top", offset: [0, -6], opacity: 0.9 });
      group.addLayer(m);
    }
    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, visible, features, preset]);

  return null;
}
