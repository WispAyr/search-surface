// ── Smart-grid Tier A2 — Platform capability matrix (server mirror) ──
//
// Must stay byte-identical in intent to web/src/lib/capabilities.ts.
// The server uses this only to validate that platform_type is one of the
// recognised enum values on team create/update — the match-score UI lives
// on the client (operators need the advisory, the server doesn't gate it).
//
// If you add a platform here, add it to the TS file AND the
// `PlatformType` union in web/src/types/search.ts.

const CAPABILITY_MATRIX = {
  ground:         { land: 1.0, water: 0.0, intertidal: 0.5 },
  ground_k9:      { land: 1.0, water: 0.0, intertidal: 0.4 },
  mounted:        { land: 0.9, water: 0.0, intertidal: 0.3 },
  boat_observer:  { land: 0.0, water: 1.0, intertidal: 0.6 },
  boat_sonar:     { land: 0.0, water: 1.0, intertidal: 0.2 },
  diver:          { land: 0.0, water: 1.0, intertidal: 0.3 },
  drone_visual:   { land: 0.7, water: 0.8, intertidal: 0.9 },
  drone_thermal:  { land: 0.8, water: 0.6, intertidal: 0.9 },
  aerial:         { land: 0.7, water: 0.8, intertidal: 0.9 },
};

const PLATFORM_TYPES = Object.keys(CAPABILITY_MATRIX);

function isValidPlatform(v) {
  if (v == null) return true; // null/undefined = unknown, allowed
  return PLATFORM_TYPES.includes(v);
}

module.exports = {
  CAPABILITY_MATRIX,
  PLATFORM_TYPES,
  isValidPlatform,
};
