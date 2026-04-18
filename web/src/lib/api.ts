// API client for search-surface (extracted from prism-surface).
// All requests go through Next.js rewrites to the local Express backend on :4078,
// which serves /api/search/* directly and proxies /api/siphon/* and /api/prism/*
// to their upstream services.

const BASE = "/api";

// Subscribers get notified on 401 (auth required) so the shell can surface the
// login modal without threading state through every call-site.
type AuthFailureHandler = () => void;
let authFailureHandler: AuthFailureHandler | null = null;
export function onAuthFailure(handler: AuthFailureHandler) { authFailureHandler = handler; }

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.headers) Object.assign(headers, opts.headers as Record<string, string>);

  // Include credentials so the session cookie travels — required for both same
  // and cross-origin (dev: web on :4077, api on :4078; prod: both on same host).
  const res = await fetch(`${BASE}${path}`, { credentials: "include", ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 401 && authFailureHandler) authFailureHandler();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Auth / multi-tenant ──
export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  role: "owner" | "operator" | "viewer";
  is_platform_admin?: boolean;
  tenant: { id: string; slug: string; name: string; plan: string };
}

export const auth = {
  me: () => request<{ user: AuthUser | null }>(`/auth/me`),
  signup: (data: { email: string; password: string; tenant_name: string; display_name?: string }) =>
    request<{ ok: boolean; user: AuthUser }>(`/auth/signup`, { method: "POST", body: JSON.stringify(data) }),
  login: (data: { email: string; password: string; tenant_slug?: string }) =>
    request<{ ok: boolean; user: AuthUser }>(`/auth/login`, { method: "POST", body: JSON.stringify(data) }),
  logout: () => request<{ ok: boolean }>(`/auth/logout`, { method: "POST" }),
  changePassword: (data: { current_password: string; new_password: string }) =>
    request<{ ok: boolean }>(`/auth/password`, { method: "POST", body: JSON.stringify(data) }),
  listTeamUsers: () =>
    request<{ users: Array<{ id: string; email: string; display_name: string | null; role: string; created_at: string; last_login_at: string | null }> }>(`/auth/users`),
  inviteUser: (data: { email: string; password: string; display_name?: string; role?: string }) =>
    request<{ user: { id: string; email: string; role: string } }>(`/auth/users`, { method: "POST", body: JSON.stringify(data) }),
  setUserRole: (userId: string, role: string) =>
    request<{ user: unknown }>(`/auth/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeUser: (userId: string) =>
    request<{ ok: boolean }>(`/auth/users/${userId}`, { method: "DELETE" }),
};

// ── Platform admin (cross-tenant) ──
export interface AdminOverview {
  totals: { tenants: number; users: number; sessions_active: number; operations: number };
  signups: { d1: number; d7: number; d30: number };
  tenants_new: { d1: number; d7: number; d30: number };
  dau_24h: number;
  sparkline: Array<{ day: string; users: number; tenants: number }>;
}
export interface AdminTenantRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  created_at: string;
  user_count: number;
  op_count: number;
  active_sessions: number;
  last_activity_at: string | null;
  last_login_at: string | null;
}
export interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  is_platform_admin: number;
  created_at: string;
  last_login_at: string | null;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_plan: string;
}
export interface AdminSession {
  token_preview: string;
  user_id: string;
  tenant_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  email: string;
  display_name: string | null;
  role: string;
  tenant_slug: string;
  tenant_name: string;
}
export interface AdminActivity {
  kind: "signup" | "login";
  at: string;
  email: string;
  role: string;
  tenant_slug: string;
  tenant_name: string;
}
export const admin = {
  overview: () => request<AdminOverview>(`/admin/overview`),
  tenants: () => request<{ tenants: AdminTenantRow[] }>(`/admin/tenants`),
  tenant: (id: string) =>
    request<{
      tenant: { id: string; slug: string; name: string; plan: string; created_at: string };
      users: Array<{ id: string; email: string; role: string; created_at: string; last_login_at: string | null; is_platform_admin: number; display_name: string | null }>;
      operations: Array<{ id: string; name: string; type: string; status: string; created_at: string; updated_at: string; created_by: string | null; zone_count: number; team_count: number; report_count: number }>;
      operations_count: number;
      active_sessions: number;
    }>(`/admin/tenants/${id}`),
  patchTenant: (id: string, data: { name?: string; plan?: string }) =>
    request<{ tenant: unknown }>(`/admin/tenants/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTenant: (id: string) =>
    request<{ ok: boolean }>(`/admin/tenants/${id}`, { method: "DELETE" }),
  users: (q?: string) =>
    request<{ users: AdminUserRow[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  patchUser: (id: string, data: { role?: string; is_platform_admin?: boolean }) =>
    request<{ user: unknown }>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  sessions: () => request<{ sessions: AdminSession[] }>(`/admin/sessions`),
  activity: () => request<{ events: AdminActivity[] }>(`/admin/activity`),
};

// ── Siphon (data collection) — proxied through backend ──
export const siphon = {
  metar: (icao = "EGPK") => request<MetarData>(`/siphon/metar/${icao}`),
  sunPosition: (lat?: number, lon?: number) => {
    const qs = typeof lat === "number" && typeof lon === "number" ? `?lat=${lat}&lon=${lon}` : "";
    return request<AstroSun>(`/siphon/astro/sun${qs}`);
  },
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

  // Street-clear checklist. Works with either an admin session or a field team
  // token (passed in the query string) — driver ticks off from their phone,
  // controller can also correct from the ops console.
  markStreetCleared: (teamId: string, streetName: string, cleared: boolean, token?: string) =>
    request<unknown>(
      `/search/teams/${teamId}/streets/${encodeURIComponent(streetName)}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
      { method: "PATCH", body: JSON.stringify({ cleared }) },
    ),

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
  emailSitrep: (opId: string, recipients: string[], message?: string) =>
    request<{ ok: boolean; sent: number; recipients: string[]; share_token: string }>(
      `/search/operations/${opId}/sitrep/email`,
      { method: "POST", body: JSON.stringify({ recipients, message }) },
    ),

  // Export URLs (download links)
  exportGeoJSON: (opId: string) => `${BASE}/search/operations/${opId}/export/geojson`,
  exportGPX: (opId: string) => `${BASE}/search/operations/${opId}/export/gpx`,
  exportKML: (opId: string) => `${BASE}/search/operations/${opId}/export/kml`,

  // Share / briefing links
  createShare: (opId: string, ttlHours?: number) =>
    request<{ token: string; operation_id: string; expires_at: string | null }>(
      `/search/operations/${opId}/share`,
      { method: "POST", body: JSON.stringify({ ttl_hours: ttlHours || null }) },
    ),
  listShares: (opId: string) =>
    request<{ shares: Array<{ token: string; created_by?: string; created_at: string; expires_at: string | null; revoked: number }> }>(
      `/search/operations/${opId}/shares`,
    ),
  revokeShare: (token: string) =>
    request<{ ok: true }>(`/search/shares/${token}`, { method: "DELETE" }),
  getBrief: (token: string) =>
    request<{ operation: any; sitrep: any; reports: any[]; share: { token: string; expires_at: string | null }; generated_at: string }>(
      `/search/brief/${token}`,
    ),

  // Operator auth status
  authStatus: () => request<{ required: boolean; authed: boolean }>(`/search/auth/status`),

  // Field team API (uses token auth)
  fieldContext: (token: string) =>
    request<unknown>(`/search/field/context?token=${token}`),
  fieldReport: (token: string, data: Record<string, unknown>) =>
    request<unknown>(`/search/field/report?token=${token}`, { method: "POST", body: JSON.stringify(data) }),
  fieldCheckin: (token: string, lat: number, lon: number) =>
    request<unknown>(`/search/field/checkin?token=${token}`, { method: "POST", body: JSON.stringify({ lat, lon }) }),
};

// ── Types (subset used by search components) ──
export interface AstroSun {
  sunrise: string;
  sunset: string;
  solar_noon: string;
  day_length_hours: number;
  civil_twilight_begin: string;
  civil_twilight_end: string;
  nautical_twilight_begin: string;
  nautical_twilight_end: string;
  astronomical_twilight_begin: string;
  astronomical_twilight_end: string;
}

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
