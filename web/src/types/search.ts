// ── Search Grid Operations TypeScript interfaces ──

export type OperationType = 'missing_person' | 'security_sweep' | 'event_patrol' | 'welfare_check' | 'custom';
export type OperationStatus = 'planning' | 'active' | 'suspended' | 'completed' | 'stood_down';
export type SearchMethod = 'sector' | 'parallel_grid' | 'expanding_square' | 'route_corridor' | 'point_search';
export type ZoneStatus = 'unassigned' | 'assigned' | 'in_progress' | 'complete' | 'suspended';
export type TeamStatus = 'standby' | 'deployed' | 'returning' | 'stood_down';
export type ReportType = 'clue' | 'area_clear' | 'hazard' | 'assist' | 'welfare' | 'photo' | 'checkin' | 'sitrep';
export type Severity = 'info' | 'warn' | 'urgent' | 'critical';

export interface SubjectInfo {
  name: string;
  age?: number;
  description?: string;
  photo_url?: string;
  medical?: string;
  last_seen?: string;
  last_seen_location?: [number, number];
}

export interface SearchOperation {
  id: string;
  name: string;
  type: OperationType;
  status: OperationStatus;
  datum_lat: number | null;
  datum_lon: number | null;
  bounds: string | null;
  subject_info: SubjectInfo | null;
  weather_notes: string | null;
  linked_event_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  zones: SearchZone[];
  teams: SearchTeam[];
  datums: SearchDatum[];
  zone_count?: number;
  team_count?: number;
  report_count?: number;
}

export type DatumKind = 'lkp' | 'plp' | 'sighting' | 'witness' | 'other';

export interface SearchDatum {
  id: string;
  operation_id: string;
  label: string;
  kind: DatumKind;
  lat: number;
  lon: number;
  notes: string | null;
  created_at: string;
}

export interface SearchZone {
  id: string;
  operation_id: string;
  name: string;
  geometry: GeoJSON.Feature;
  search_method: SearchMethod;
  status: ZoneStatus;
  priority: 1 | 2 | 3 | 4 | 5;
  assigned_team_id: string | null;
  pod: number;
  cumulative_pod: number;
  spacing_m: number | null;
  notes: string | null;
  poa: number;
  sweep_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface SearchStreetItem {
  name: string;
  cleared_at: string | null;
  cleared_by: string | null;
}

export interface SearchTeam {
  id: string;
  operation_id: string;
  name: string;
  callsign: string;
  token: string;
  color: string;
  members: string[];
  capability: string;
  status: TeamStatus;
  last_lat: number | null;
  last_lon: number | null;
  last_position_at: string | null;
  created_at: string;
  // Populated when the team is assigned to a zone — see server/routes/search.js
  // buildTeamAssignment. Checklist is street names from OSM; route is an OSRM
  // driving trip through sampled zone waypoints (vehicle-capable teams only).
  assigned_zone_id?: string | null;
  street_checklist?: SearchStreetItem[] | null;
  vehicle_route_geometry?: GeoJSON.LineString | null;
  vehicle_route_meta?: { distance_m: number; duration_s: number } | null;
}

export interface SearchReport {
  id: string;
  operation_id: string;
  zone_id: string | null;
  team_id: string | null;
  team_name?: string;
  team_callsign?: string;
  type: ReportType;
  lat: number | null;
  lon: number | null;
  grid_ref: string | null;
  description: string | null;
  photo_url: string | null;
  severity: Severity;
  acknowledged: boolean;
  acknowledged_by: string | null;
  created_at: string;
}

export interface CommsEntry {
  id: number;
  operation_id: string;
  from_callsign: string | null;
  to_callsign: string | null;
  message: string;
  type: 'radio' | 'note' | 'system';
  created_at: string;
}

export interface AuditEntry {
  id: number;
  operation_id: string;
  actor: string;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface SitrepSummary {
  total_zones: number;
  complete: number;
  in_progress: number;
  unassigned: number;
  avg_pod: number;
  deployed_teams: number;
  total_teams: number;
  clue_count: number;
  urgent_count: number;
}

export interface Sitrep {
  text: string;
  operation: string;
  status: OperationStatus;
  summary: SitrepSummary;
  generated_at: string;
}

// ── Grid generation params ──
export interface GridGenerationParams {
  type: 'parallel' | 'hex' | 'expanding_square' | 'route_buffer' | 'point' | 'k9_scent' | 'drone_lawnmower';
  bounds?: GeoJSON.Polygon;
  datum?: [number, number];
  cellSizeM?: number;
  route?: GeoJSON.LineString;
  bufferM?: number;
  radiusM?: number;
  maxLegs?: number;
  legM?: number;
  // K9 scent cone
  windDirection?: number;
  windSpeed?: number;
  scentRangeM?: number;
  // Drone
  droneCount?: number;
  droneAltM?: number;
  droneOverlap?: number;
}

// ── Field team context ──
export interface FieldContext {
  team: SearchTeam;
  operation: {
    id: string;
    name: string;
    type: OperationType;
    status: OperationStatus;
    subject_info: SubjectInfo | null;
    datum_lat: number | null;
    datum_lon: number | null;
  };
  assigned_zones: SearchZone[];
  recent_reports: SearchReport[];
}

// ── SSE event types ──
export type SearchStreamEvent =
  | { type: 'zone_updated'; data: SearchZone }
  | { type: 'team_position'; data: { team_id: string; lat: number; lon: number; at: string } }
  | { type: 'report_submitted'; data: SearchReport }
  | { type: 'operation_updated'; data: Partial<SearchOperation> }
  | { type: 'comms'; data: CommsEntry };
