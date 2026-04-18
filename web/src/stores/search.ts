import { create } from "zustand";
import type {
  SearchOperation,
  SearchZone,
  SearchTeam,
  SearchReport,
  CommsEntry,
  Sitrep,
  OperationStatus,
} from "@/types/search";
import { prefs as prefsApi, type MapPrefs } from "@/lib/api";

export const DEFAULT_MAP_PREFS: Required<MapPrefs> = {
  basemap: "carto-dark",
  show_3d: false,
  show_terrain: true,
  show_hillshade: true,
  extrude_zones: true,
  show_airspace: false,
  show_teams: true,
  show_datums: true,
  show_zone_labels: true,
  show_tide_overlay: false,
  pitch: 55,
  exaggeration: 1.3,
};

interface SearchState {
  // ── Operation list ──
  operations: SearchOperation[];
  operationsLoading: boolean;

  // ── Active operation ──
  activeOperation: SearchOperation | null;
  activeOperationLoading: boolean;

  // ── Reports ──
  reports: SearchReport[];

  // ── Comms ──
  commsLog: CommsEntry[];

  // ── SITREP ──
  sitrep: Sitrep | null;

  // ── UI state ──
  selectedZoneId: string | null;
  selectedTeamId: string | null;
  previewZones: Array<Record<string, unknown>>;
  mobilePanelOpen: boolean;
  // Secondary-datum picker: click map to drop a named datum (e.g. "last seen at house", "possible: park")
  addingDatum: boolean;
  // Map click captured while addingDatum=true — form in DatumsPanel then saves it
  pendingDatumPoint: [number, number] | null;
  // The datum id selected for the next grid pattern generation (null = use operation primary datum)
  gridDatumId: string | null;
  showGridGenerator: boolean;
  showPODCalculator: boolean;
  showExportPanel: boolean;
  showSitrepPanel: boolean;
  settingDatum: boolean;
  showAirspace: boolean;
  rightPanel: "zones" | "datums" | "timeline" | "reports" | "comms" | "teams" | "conditions" | "audit" | "sar" | "zello";
  // ── SAR Tools (subject profile + rings + isochrones + hazards) ──
  showSarTools: boolean;
  subjectProfileId: string | null; // e.g. 'dementia', 'child_7_9', 'dog'
  showLpbRings: boolean;           // statistical probability rings around primary datum
  travelModes: { foot: boolean; bike: boolean; car: boolean }; // isochrone rings
  travelMinutes: number;           // minutes elapsed since LKP (for isochrones)
  showHazards: boolean;
  showAttractors: boolean;
  hazards: Array<{ kind: string; name: string; lat: number; lon: number }>;
  attractors: Array<{ kind: string; name: string; lat: number; lon: number }>;
  hazardsHint: string | null;
  vehicleRoute: GeoJSON.LineString | null;
  vehicleRouteMeta: { distance_m: number; duration_s: number } | null;

  // Alarms the IC has dismissed for this session — keyed by alarm.id (see
  // AlarmBar). Cleared when the operation changes. Not persisted: re-surfacing
  // on reload is desirable; a dismiss that hides the alarm forever would risk
  // real incidents being silenced.
  dismissedAlarmIds: Set<string>;

  // Map fly-to target. Set by panels (timeline, reports, teams) to pan the map
  // to a point. A monotonically incrementing nonce makes repeated clicks on
  // the same coords re-trigger the effect.
  mapFlyTo: { lat: number; lon: number; zoom?: number; nonce: number } | null;

  // Per-user map preferences. Hydrated from GET /api/preferences/map on shell
  // mount, and PUT back (debounced) whenever a MapLayerPanel toggle fires.
  mapPrefs: Required<MapPrefs>;
  mapPrefsLoaded: boolean;
  showMapLayerPanel: boolean;

  // ── Actions ──
  setOperations: (ops: SearchOperation[]) => void;
  setOperationsLoading: (v: boolean) => void;
  setActiveOperation: (op: SearchOperation | null) => void;
  setActiveOperationLoading: (v: boolean) => void;
  setReports: (reports: SearchReport[]) => void;
  addReport: (report: SearchReport) => void;
  setCommsLog: (comms: CommsEntry[]) => void;
  addCommsEntry: (entry: CommsEntry) => void;
  setSitrep: (s: Sitrep | null) => void;

  // Zone updates
  updateZoneInState: (zone: SearchZone) => void;

  // Team position updates
  updateTeamPosition: (teamId: string, lat: number, lon: number, at: string) => void;

  // UI
  selectZone: (id: string | null) => void;
  selectTeam: (id: string | null) => void;
  toggleGridGenerator: () => void;
  togglePODCalculator: () => void;
  toggleExportPanel: () => void;
  toggleSitrepPanel: () => void;
  setSettingDatum: (v: boolean) => void;
  toggleAirspace: () => void;
  setRightPanel: (panel: SearchState["rightPanel"]) => void;
  setPreviewZones: (zones: Array<Record<string, unknown>>) => void;
  setMobilePanelOpen: (v: boolean) => void;
  setAddingDatum: (v: boolean) => void;
  setPendingDatumPoint: (p: [number, number] | null) => void;
  setGridDatumId: (id: string | null) => void;
  // SAR tools
  toggleSarTools: () => void;
  setSubjectProfile: (id: string | null) => void;
  setShowLpbRings: (v: boolean) => void;
  setTravelMode: (mode: "foot" | "bike" | "car", on: boolean) => void;
  setTravelMinutes: (m: number) => void;
  setShowHazards: (v: boolean) => void;
  setShowAttractors: (v: boolean) => void;
  setOsmFeatures: (h: SearchState["hazards"], a: SearchState["attractors"]) => void;
  setHazardsHint: (h: string | null) => void;
  setVehicleRoute: (g: GeoJSON.LineString | null, meta: SearchState["vehicleRouteMeta"]) => void;
  dismissAlarm: (id: string) => void;
  clearDismissedAlarms: () => void;
  setMapFlyTo: (lat: number, lon: number, zoom?: number) => void;
  // Map prefs
  loadMapPrefs: () => Promise<void>;
  updateMapPrefs: (patch: Partial<MapPrefs>) => void;
  toggleMapLayerPanel: () => void;
  setShowMapLayerPanel: (v: boolean) => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  operations: [],
  operationsLoading: false,
  activeOperation: null,
  activeOperationLoading: false,
  reports: [],
  commsLog: [],
  sitrep: null,
  selectedZoneId: null,
  selectedTeamId: null,
  previewZones: [],
  mobilePanelOpen: false,
  addingDatum: false,
  pendingDatumPoint: null,
  gridDatumId: null,
  showGridGenerator: false,
  showPODCalculator: false,
  showExportPanel: false,
  showSitrepPanel: false,
  settingDatum: false,
  showAirspace: false,
  rightPanel: "zones",
  showSarTools: false,
  subjectProfileId: null,
  showLpbRings: false,
  travelModes: { foot: false, bike: false, car: false },
  travelMinutes: 60,
  showHazards: false,
  showAttractors: false,
  hazards: [],
  attractors: [],
  hazardsHint: null,
  vehicleRoute: null,
  vehicleRouteMeta: null,
  dismissedAlarmIds: new Set<string>(),
  mapFlyTo: null,
  mapPrefs: { ...DEFAULT_MAP_PREFS },
  mapPrefsLoaded: false,
  showMapLayerPanel: false,

  setOperations: (ops) => set({ operations: ops }),
  setOperationsLoading: (v) => set({ operationsLoading: v }),
  setActiveOperation: (op) =>
    set((s) => {
      // Switching operations (or clearing) resets per-op UI state that would
      // otherwise bleed across incidents — most notably, dismissed alarms.
      if ((s.activeOperation?.id ?? null) !== (op?.id ?? null)) {
        return { activeOperation: op, dismissedAlarmIds: new Set<string>() };
      }
      return { activeOperation: op };
    }),
  setActiveOperationLoading: (v) => set({ activeOperationLoading: v }),
  setReports: (reports) => set({ reports }),
  addReport: (report) =>
    set((s) => ({ reports: [report, ...s.reports].slice(0, 200) })),
  setCommsLog: (comms) => set({ commsLog: comms }),
  addCommsEntry: (entry) =>
    set((s) => ({ commsLog: [entry, ...s.commsLog].slice(0, 500) })),
  setSitrep: (sitrep) => set({ sitrep }),

  updateZoneInState: (zone) =>
    set((s) => {
      if (!s.activeOperation) return s;
      const zones = s.activeOperation.zones.map((z) =>
        z.id === zone.id ? zone : z
      );
      return { activeOperation: { ...s.activeOperation, zones } };
    }),

  updateTeamPosition: (teamId, lat, lon, at) =>
    set((s) => {
      if (!s.activeOperation) return s;
      const teams = s.activeOperation.teams.map((t) =>
        t.id === teamId
          ? { ...t, last_lat: lat, last_lon: lon, last_position_at: at }
          : t
      );
      return { activeOperation: { ...s.activeOperation, teams } };
    }),

  selectZone: (id) => set((s) => ({
    selectedZoneId: id,
    // Picking a zone on the map should surface its detail on the right — jump
    // to the Zones tab so the user sees streets, teams, reports, etc.
    rightPanel: id ? "zones" : s.rightPanel,
    mobilePanelOpen: id ? true : s.mobilePanelOpen,
  })),
  selectTeam: (id) => set({ selectedTeamId: id }),
  toggleGridGenerator: () => set((s) => ({ showGridGenerator: !s.showGridGenerator })),
  togglePODCalculator: () => set((s) => ({ showPODCalculator: !s.showPODCalculator })),
  toggleExportPanel: () => set((s) => ({ showExportPanel: !s.showExportPanel })),
  toggleSitrepPanel: () => set((s) => ({ showSitrepPanel: !s.showSitrepPanel })),
  // Pick modes are mutually exclusive — turning one on cancels the other and
  // clears any in-flight pending point so the map never ends up in a
  // confusing "both active" state. Only the *enabling* path enforces this;
  // turning a mode off leaves the others alone.
  setSettingDatum: (v) =>
    set((s) =>
      v
        ? { settingDatum: true, addingDatum: false, pendingDatumPoint: null }
        : { settingDatum: false }
    ),
  toggleAirspace: () => set((s) => ({ showAirspace: !s.showAirspace })),
  setRightPanel: (panel) => set({ rightPanel: panel }),
  setPreviewZones: (zones) => set({ previewZones: zones }),
  setMobilePanelOpen: (v) => set({ mobilePanelOpen: v }),
  setAddingDatum: (v) =>
    set((s) =>
      v
        ? { addingDatum: true, settingDatum: false, pendingDatumPoint: null }
        : { addingDatum: false }
    ),
  setPendingDatumPoint: (p) => set({ pendingDatumPoint: p }),
  setGridDatumId: (id) => set({ gridDatumId: id }),
  toggleSarTools: () => set((s) => ({ showSarTools: !s.showSarTools })),
  setSubjectProfile: (id) => set({ subjectProfileId: id }),
  setShowLpbRings: (v) => set({ showLpbRings: v }),
  setTravelMode: (mode, on) => set((s) => ({ travelModes: { ...s.travelModes, [mode]: on } })),
  setTravelMinutes: (m) => set({ travelMinutes: m }),
  setShowHazards: (v) => set({ showHazards: v }),
  setShowAttractors: (v) => set({ showAttractors: v }),
  setOsmFeatures: (hazards, attractors) => set({ hazards, attractors }),
  setHazardsHint: (h) => set({ hazardsHint: h }),
  setVehicleRoute: (g, meta) => set({ vehicleRoute: g, vehicleRouteMeta: meta }),
  dismissAlarm: (id) =>
    set((s) => {
      const next = new Set(s.dismissedAlarmIds);
      next.add(id);
      return { dismissedAlarmIds: next };
    }),
  clearDismissedAlarms: () => set({ dismissedAlarmIds: new Set<string>() }),
  setMapFlyTo: (lat, lon, zoom) =>
    set((s) => ({
      mapFlyTo: { lat, lon, zoom, nonce: (s.mapFlyTo?.nonce ?? 0) + 1 },
    })),

  loadMapPrefs: async () => {
    try {
      const { prefs: loaded } = await prefsApi.getMap();
      set({
        mapPrefs: { ...DEFAULT_MAP_PREFS, ...(loaded || {}) },
        mapPrefsLoaded: true,
      });
    } catch {
      // Unauthenticated or offline — fall back to defaults and keep working
      // locally. Next save attempt will surface the auth modal via the global
      // onAuthFailure handler.
      set({ mapPrefsLoaded: true });
    }
  },

  updateMapPrefs: (patch) =>
    set((s) => {
      const next = { ...s.mapPrefs, ...patch };
      scheduleMapPrefsSave(next);
      return { mapPrefs: next };
    }),

  toggleMapLayerPanel: () => set((s) => ({ showMapLayerPanel: !s.showMapLayerPanel })),
  setShowMapLayerPanel: (v) => set({ showMapLayerPanel: v }),
}));

// Debounced persistence — rapid toggles (e.g. dragging pitch slider) shouldn't
// hammer the API. Last-write-wins per 400ms window.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMapPrefsSave(next: MapPrefs) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    prefsApi.putMap(next).catch(() => { /* offline / auth — UI still works */ });
  }, 400);
}
