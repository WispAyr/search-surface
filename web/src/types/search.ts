// ── Search Grid Operations TypeScript interfaces ──

export type OperationType = 'missing_person' | 'security_sweep' | 'event_patrol' | 'welfare_check' | 'custom';
export type OperationStatus = 'planning' | 'active' | 'suspended' | 'completed' | 'stood_down';
export type SearchMethod = 'sector' | 'parallel_grid' | 'expanding_square' | 'route_corridor' | 'point_search' | 'river_corridor' | 'river_collection_point';
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
  sitrep_recipients?: string[];
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

// Smart-grid Tier A1: per-cell terrain classification. `null` means the cell
// hasn't been classified (legacy zone or Overpass failed during generation).
export type TerrainClass = 'land' | 'water' | 'intertidal' | 'mixed';

export interface TerrainComposition {
  land_pct: number;       // 0..1
  water_pct: number;      // 0..1
  intertidal_pct: number; // 0..1
  dominant_class: TerrainClass;
  // Optional provenance so the UI can hedge the badge ("partial OSM data").
  partial?: boolean;
}

// Smart-grid Tier B1: corridor metadata packed onto a zone's geometry.properties
// (and mirrored to a DB column for querying). `kind: 'parent'` is the main
// corridor polygon; `kind: 'collection_point'` is a weir/dam/bridge sub-zone.
export type CorridorMetadata =
  | {
      kind: 'parent';
      lkp: [number, number];
      hours: number;
      velocity_ms: number;
      floater: boolean;
      body_velocity_ms: number;
      head_distance_m: number;
      head_corridor_width_m: number;
      river_name: string | null;
      centreline: Array<[number, number]>;
      chainage: Array<{ lon: number; lat: number; d: number }>;
      warnings: string[];
      // Smart-grid Tier B3 — snapshot of the nearest river gauge at generation
      // time, if the operator invoked "Use nearest gauge". Frozen at plan time
      // so the zone card shows what the operator was looking at, not what the
      // gauge reads an hour later.
      gauge_ref?: {
        id: string;
        label: string;
        source: 'SEPA' | 'EA';
        stage_m: number | null;
        trend: 'rising' | 'falling' | 'steady' | 'unknown';
        observed_at: string;
        distance_m: number;
      } | null;
    }
  | {
      kind: 'collection_point';
      collection_kind: string;
      chainage_m: number;
      parent_lkp: [number, number];
      osm_id: number;
      osm_name: string | null;
    };

// Smart-grid Tier B2: per-zone tide windows. Non-null only for zones whose
// geometry intersects the intertidal band. Backed by Open-Meteo Marine's
// hourly sea_level_height_msl forecast; windows are contiguous runs where the
// predicted sea level is at or below `threshold_m` (default 1.5 m MSL ≈ MLWS
// on the Ayrshire coast). Start/end are linearly interpolated across the
// threshold so they don't snap to the hourly grid.
export interface TideWindow {
  start_iso: string;     // inclusive
  end_iso: string;       // inclusive
  min_height_m: number;  // minimum sea level in the window
  max_height_m: number;  // maximum sea level in the window
}
export interface SearchableWindows {
  source: 'open-meteo marine' | 'unavailable';
  centre: { lat: number; lon: number } | null;
  threshold_m: number;
  windows: TideWindow[];
  generated_at: string;
  ttl_minutes: number;
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
  // Smart-grid Tier A1. Both nullable for legacy + partial data.
  terrain_class?: TerrainClass | null;
  terrain_composition?: TerrainComposition | null;
  // Smart-grid Tier B1 — only set on river_corridor / river_collection_point zones.
  corridor_metadata?: CorridorMetadata | null;
  // Smart-grid Tier B2 — tide-gated search windows for intertidal zones.
  searchable_windows?: SearchableWindows | null;
}

export interface SearchStreetItem {
  name: string;
  cleared_at: string | null;
  cleared_by: string | null;
}

// Smart-grid Tier A2: platform type enum. Drives the capability matrix in
// web/src/lib/capabilities.ts — legacy teams stay null and the guard treats
// them as "unknown, no warning". Adding a new value here requires updating
// the server mirror (server/lib/capabilities.js) AND the matrix.
export type PlatformType =
  | 'ground'
  | 'ground_k9'
  | 'mounted'
  | 'boat_observer'
  | 'boat_sonar'
  | 'diver'
  | 'drone_visual'
  | 'drone_thermal'
  | 'aerial';

export interface SearchTeam {
  id: string;
  operation_id: string;
  name: string;
  callsign: string;
  token: string;
  color: string;
  members: string[];
  capability: string;
  platform_type?: PlatformType | null;
  status: TeamStatus;
  last_lat: number | null;
  last_lon: number | null;
  last_position_at: string | null;
  // Set when status flips into deployed/returning, cleared when it leaves.
  // Used by fatigue alarm (isTeamFatigued helper).
  deployed_at: string | null;
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
  type: 'parallel' | 'hex' | 'expanding_square' | 'route_buffer' | 'point' | 'k9_scent' | 'drone_lawnmower' | 'river_corridor';
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
  // River corridor (Tier B1) — LKP taken from params.datum; network + collection
  // points fetched by the caller and passed in so generator stays sync + pure.
  hours?: number;
  velocityMs?: number;
  floater?: boolean;
  rivers?: GeoJSON.Feature<GeoJSON.LineString>[];
  collectionPoints?: GeoJSON.Feature<GeoJSON.Point>[];
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
