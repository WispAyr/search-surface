// GeoJSON builders shared by the 2D and 3D air-activity renderers.
//
// The 3D view is not decoration here: ADS-B carries real altitude, and the
// difference between a helicopter holding 300 ft and one transiting at 4000 ft
// is the difference between a search asset and a passer-by. On the flat map that
// distinction lives in a tooltip; in 3D it is the shape of the thing.

import type { AirLive, AirTracks, AirTrack } from "@/lib/api";
import type { FeatureCollection, LineString, Point, Polygon } from "geojson";

export const AIR_CAT_COLORS: Record<string, string> = {
  coastguard: "#22d3ee",
  police: "#60a5fa",
  "air-ambulance": "#f87171",
  sar: "#34d399",
  helicopter: "#f59e0b",
  "probable-rotorcraft": "#fbbf24",
  other: "#64748b",
};

export const AIR_CAT_LABELS: Record<string, string> = {
  coastguard: "Coastguard",
  police: "Police / NPAS",
  "air-ambulance": "Air ambulance",
  sar: "SAR",
  helicopter: "Helicopter",
  "probable-rotorcraft": "Probable rotorcraft (by profile)",
  other: "Other",
};

export function airColor(category: string) {
  return AIR_CAT_COLORS[category] || AIR_CAT_COLORS.other;
}

export function airIdent(t: { registration?: string | null; callsign?: string | null; icao24: string }) {
  return t.registration || t.callsign || t.icao24;
}

const EMPTY = { type: "FeatureCollection" as const, features: [] };
export function emptyFC<T>(): FeatureCollection<any, any> { return EMPTY as any; }

/** Keep a track under `max` points without losing its shape at the ends. */
function decimate<T>(pts: T[], max: number): T[] {
  if (pts.length <= max) return pts;
  const step = Math.ceil(pts.length / max);
  const out: T[] = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/** Flat ground lines for every track — cheap context under the curtains. */
export function buildTrackLines(data: AirTracks | null, hidden?: Set<string>): FeatureCollection<LineString, any> {
  if (!data) return emptyFC();
  const features = data.tracks
    .filter((t) => !hidden?.has(t.icao24))
    .map((t) => {
      const pts = decimate(t.points_geo, 400);
      if (pts.length < 2) return null;
      return {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: pts.map((p) => [p[1], p[0]]) },
        properties: {
          icao24: t.icao24,
          ident: airIdent(t),
          category: t.category,
          color: airColor(t.category),
          loiter: t.loiter,
          minutes: t.minutes_on_station,
          min_alt_m: t.min_alt_m,
          centroid_dist_m: t.centroid_dist_m,
        },
      };
    })
    .filter(Boolean);
  return { type: "FeatureCollection", features: features as any };
}

/**
 * Altitude curtains: one thin extruded footprint per track segment, rising from
 * the ground to the aircraft's altitude at that point. A low orbit reads as a
 * short wall hugging the terrain; a transit towers over it.
 *
 * Loiter tracks only — curtaining every transit would bury the map in walls.
 */
export function buildTrackCurtains(
  data: AirTracks | null,
  opts?: { widthM?: number; maxSegmentsPerTrack?: number; hidden?: Set<string> },
): FeatureCollection<Polygon, any> {
  if (!data) return emptyFC();
  const widthM = opts?.widthM ?? 28;
  const maxSeg = opts?.maxSegmentsPerTrack ?? 220;
  const features: any[] = [];

  for (const t of data.tracks) {
    if (!t.loiter) continue;
    if (opts?.hidden?.has(t.icao24)) continue;
    const pts = decimate(t.points_geo, maxSeg + 1);
    const color = airColor(t.category);
    for (let i = 0; i < pts.length - 1; i++) {
      const [lat1, lon1, alt1] = pts[i];
      const [lat2, lon2, alt2] = pts[i + 1];
      if (alt1 == null && alt2 == null) continue;
      const alt = Math.max(alt1 ?? 0, alt2 ?? 0);
      if (alt <= 0) continue;

      // Perpendicular offset, computed in metres then converted back to degrees
      // so the ribbon keeps a constant real width regardless of latitude.
      const mPerDegLat = 111320;
      const mPerDegLon = 111320 * Math.cos((lat1 * Math.PI) / 180) || 1;
      const dxM = (lon2 - lon1) * mPerDegLon;
      const dyM = (lat2 - lat1) * mPerDegLat;
      const len = Math.hypot(dxM, dyM);
      if (len < 0.5) continue;            // stationary sample — no segment to draw
      const px = (-dyM / len) * (widthM / 2);
      const py = (dxM / len) * (widthM / 2);
      const dLon = px / mPerDegLon;
      const dLat = py / mPerDegLat;

      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [lon1 + dLon, lat1 + dLat],
            [lon2 + dLon, lat2 + dLat],
            [lon2 - dLon, lat2 - dLat],
            [lon1 - dLon, lat1 - dLat],
            [lon1 + dLon, lat1 + dLat],
          ]],
        },
        properties: {
          icao24: t.icao24,
          ident: airIdent(t),
          category: t.category,
          color,
          alt_m: Math.round(alt),
          alt_ft: Math.round(alt * 3.28084),
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** Loiter centroids — where the crews actually concentrated. */
export function buildCentroids(data: AirTracks | null, hidden?: Set<string>): FeatureCollection<Point, any> {
  if (!data) return emptyFC();
  const features = data.tracks
    .filter((t) => t.loiter && !hidden?.has(t.icao24))
    .map((t) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [t.centroid[1], t.centroid[0]] },
      properties: {
        icao24: t.icao24,
        ident: airIdent(t),
        category: t.category,
        color: airColor(t.category),
        label: `${airIdent(t)} · ${t.centroid_dist_m} m`,
        minutes: t.minutes_on_station,
        min_alt_m: t.min_alt_m,
        centroid_dist_m: t.centroid_dist_m,
        points: t.points,
      },
    }));
  return { type: "FeatureCollection", features: features as any };
}

/** Current airborne contacts. */
export function buildLive(data: AirLive | null): FeatureCollection<Point, any> {
  if (!data) return emptyFC();
  const features = data.aircraft
    .filter((a) => !a.on_ground)
    .map((a) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [a.lon, a.lat] },
      properties: {
        icao24: a.icao24,
        ident: airIdent(a),
        category: a.category,
        color: airColor(a.category),
        of_interest: a.of_interest,
        alt_m: a.alt_m ?? 0,
        alt_ft: a.alt_m == null ? null : Math.round(a.alt_m * 3.28084),
        dist_km: Number((a.dist_m / 1000).toFixed(1)),
        type_code: a.type_code,
      },
    }));
  return { type: "FeatureCollection", features: features as any };
}
