// API client for search-surface (extracted from prism-surface).
// All requests go through Next.js rewrites to the local Express backend on :4078,
// which serves /api/search/* directly and proxies /api/siphon/* and /api/prism/*
// to their upstream services.

const BASE = "/api";

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Siphon (data collection) — proxied through backend ──
export const siphon = {
  metar: (icao = "EGPK") => request<MetarData>(`/siphon/metar/${icao}`),
  sunPosition: () => request<Record<string, unknown>>("/siphon/astro/sun"),
  weather: (key: string) => request<unknown>(`/siphon/weather/${key}`),
  ukAirspace: async () => {
    try {
      return await request<unknown>("/siphon/aviation/uk_airspace");
    } catch {
      return await request<unknown>("/search/airspace");
    }
  },
};

// ── Prism (intelligence / lenses) — proxied through backend ──
export const prism = {
  stormWatch: (region = "ayrshire") => request<unknown>(`/prism/storm-watch/${region}`),
  windConsensus: (region = "ayrshire") => request<unknown>(`/prism/wind-consensus/${region}`),
};

// ── Search helpers (SAR-specific utilities) ──
export const searchHelpers = {
  profiles: () => request<{ profiles: Record<string, { label: string; rings_km: number[]; water_risk: number; notes: string }> }>("/search/profiles"),
  geocode: (q: string) => request<{ results: Array<{ lat: number; lon: number; display_name: string; type: string; class: string; importance: number; boundingbox: string[] }> }>(`/search/geocode?q=${encodeURIComponent(q)}`),
  reverse: (lat: number, lon: number) => request<{ display_name: string; address: Record<string, string>; postcode?: string }>(`/search/reverse?lat=${lat}&lon=${lon}`),
  w3wFromCoords: (lat: number, lon: number) => request<{ words: string; nearestPlace: string; map: string }>(`/w3w/convert?lat=${lat}&lng=${lon}`),
  w3wToCoords: (words: string) => request<{ lat: number; lng: number; words: string; nearestPlace: string }>(`/w3w/coords?words=${encodeURIComponent(words)}`),
  osmStreets: (polygon: Array<[number, number]>) =>
    request<{ streets: Array<{ name: string; count: number; highway?: string }>; total: number }>("/search/osm/streets", {
      method: "POST",
      body: JSON.stringify({ polygon }),
    }),
  osmFeatures: (bbox: [number, number, number, number]) =>
    request<{ hazards: Array<{ kind: string; name: string; lat: number; lon: number }>; attractors: Array<{ kind: string; name: string; lat: number; lon: number }> }>("/search/osm/features", {
      method: "POST",
      body: JSON.stringify({ bbox }),
    }),
  vehicleRoute: (waypoints: Array<[number, number]>) =>
    request<{ geometry: GeoJSON.LineString; distance_m: number; duration_s: number }>("/search/route/vehicle", {
      method: "POST",
      body: JSON.stringify({ waypoints }),
    }),
};

// ── Search Grid Operations ──
export const search = {
  // Operations
  listOperations: (status?: string) =>
    request<{ operations: unknown[] }>(`/search/operations${status ? `?status=${status}` : ""}`),
  getOperation: (id: string) => request<unknown>(`/search/operations/${id}`),
  createOperation: (data: Record<string, unknown>) =>
    request<unknown>("/search/operations", { method: "POST", body: JSON.stringify(data) }),
  updateOperation: (id: string, data: Record<string, unknown>) =>
    request<unknown>(`/search/operations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  activateOperation: (id: string) =>
    request<unknown>(`/search/operations/${id}/activate`, { method: "POST" }),
  deleteOperation: (id: string) =>
    request<unknown>(`/search/operations/${id}`, { method: "DELETE" }),

  // Zones
  createZone: (opId: string, data: Record<string, unknown>) =>
    request<unknown>(`/search/operations/${opId}/zones`, { method: "POST", body: JSON.stringify(data) }),
  createZonesBatch: (opId: string, zones: Record<string, unknown>[]) =>
    request<unknown>(`/search/operations/${opId}/zones/batch`, { method: "POST", body: JSON.stringify({ zones }) }),
  updateZone: (zoneId: string, data: Record<string, unknown>) =>
    request<unknown>(`/search/zones/${zoneId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteZone: (zoneId: string) =>
    request<unknown>(`/search/zones/${zoneId}`, { method: "DELETE" }),

  // Datums (named reference points)
  createDatum: (opId: string, data: { label?: string; kind?: string; lat: number; lon: number; notes?: string }) =>
    request<unknown>(`/search/operations/${opId}/datums`, { method: "POST", body: JSON.stringify(data) }),
  updateDatum: (datumId: string, data: Record<string, unknown>) =>
    request<unknown>(`/search/datums/${datumId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteDatum: (datumId: string) =>
    request<unknown>(`/search/datums/${datumId}`, { method: "DELETE" }),

  // Teams
  createTeam: (opId: string, data: Record<string, unknown>) =>
    request<unknown>(`/search/operations/${opId}/teams`, { method: "POST", body: JSON.stringify(data) }),
  updateTeam: (teamId: string, data: Record<string, unknown>) =>
    request<unknown>(`/search/teams/${teamId}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Reports
  listReports: (opId: string, limit = 100) =>
    request<{ reports: unknown[] }>(`/search/operations/${opId}/reports?limit=${limit}`),
  acknowledgeReport: (opId: string, reportId: string) =>
    request<unknown>(`/search/operations/${opId}/reports/${reportId}/acknowledge`, { method: "POST", body: JSON.stringify({}) }),

  // Comms
  listComms: (opId: string) => request<{ comms: unknown[] }>(`/search/operations/${opId}/comms`),
  addComms: (opId: string, data: Record<string, unknown>) =>
    request<unknown>(`/search/operations/${opId}/comms`, { method: "POST", body: JSON.stringify(data) }),

  // Audit
  getAudit: (opId: string) => request<{ audit: unknown[] }>(`/search/operations/${opId}/audit`),

  // SITREP
  getSitrep: (opId: string) => request<unknown>(`/search/operations/${opId}/sitrep`),

  // Export URLs (download links)
  exportGeoJSON: (opId: string) => `${BASE}/search/operations/${opId}/export/geojson`,
  exportGPX: (opId: string) => `${BASE}/search/operations/${opId}/export/gpx`,
  exportKML: (opId: string) => `${BASE}/search/operations/${opId}/export/kml`,

  // Field team API (uses token auth)
  fieldContext: (token: string) =>
    request<unknown>(`/search/field/context?token=${token}`),
  fieldReport: (token: string, data: Record<string, unknown>) =>
    request<unknown>(`/search/field/report?token=${token}`, { method: "POST", body: JSON.stringify(data) }),
  fieldCheckin: (token: string, lat: number, lon: number) =>
    request<unknown>(`/search/field/checkin?token=${token}`, { method: "POST", body: JSON.stringify({ lat, lon }) }),
};

// ── Types (subset used by search components) ──
export interface MetarData {
  raw: string;
  station: string;
  time: string;
  wind_direction: number;
  wind_speed: number;
  wind_gust: number | null;
  wind_unit: string;
  visibility_m: number;
  temperature_c: number;
  dewpoint_c: number;
  pressure_hpa: number;
  clouds: { coverage: string; altitude_ft: number }[];
}
