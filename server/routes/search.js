const express = require('express');
const { operations, zones, teams, reports, comms, datums, audit, shareTokens, generateSitrep } = require('../search-db');
const searchHelpers = require('../search-helpers');
const { isValidPlatform } = require('../lib/capabilities');
const { attachTenant, requireTenant } = require('../tenant-middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios').default || require('axios');
const { EventEmitter } = require('events');

// Mail relay — see user memory reference_mail_relay. big-server must go via
// the nginx-fronted public port; small-server-local services use :3880 on
// loopback. Defaults here work for big-server deployment.
const MAIL_RELAY_URL = process.env.MAIL_RELAY_URL || 'http://172.81.61.36:13880/send';
const MAIL_RELAY_KEY = process.env.MAIL_RELAY_KEY || 'skynet-mail-relay-key-2026';
const MAIL_FROM = process.env.SITREP_MAIL_FROM || 'no-reply@wispayr.online';
const MAIL_FROM_NAME = process.env.SITREP_MAIL_FROM_NAME || 'Search Ops';
const PUBLIC_BASE = process.env.PUBLIC_BASE || 'https://search.wispayr.online';

const router = express.Router();

// Attach tenant context to every request on this router. Individual endpoints
// decide whether to require a tenant (operator routes) or allow through
// (field-team routes protected by a team token, brief routes protected by a
// share token).
router.use(attachTenant);

// Assert the operation belongs to the current tenant. Call AFTER requireTenant.
// Returns the op (hydrated) or sends 404/403 itself and returns null.
function opForTenant(req, res, id) {
  const op = operations.get(id, req.tenant.id);
  if (!op) {
    res.status(404).json({ error: 'Operation not found' });
    return null;
  }
  return op;
}

// Zone/team/datum/report lookups by id don't naturally know the tenant; this
// checks the parent operation and rejects cross-tenant access.
function guardOperationId(req, res, operationId) {
  if (!req.tenant) { res.status(401).json({ error: 'Login required', auth_required: true }); return false; }
  const ownerTenantId = operations.getTenantId(operationId);
  if (!ownerTenantId) { res.status(404).json({ error: 'Operation not found' }); return false; }
  if (ownerTenantId !== req.tenant.id) { res.status(404).json({ error: 'Operation not found' }); return false; }
  return true;
}

// Pull an outer ring out of a zone geometry (Polygon or MultiPolygon, and the
// server stores GeoJSON [lon,lat] while OSM helpers expect [lat,lon]).
function zoneOuterRing(geom) {
  const g = geom?.geometry || geom;
  if (!g?.type || !g.coordinates) return null;
  let ring = null;
  if (g.type === 'Polygon') ring = g.coordinates[0];
  else if (g.type === 'MultiPolygon') ring = g.coordinates[0]?.[0];
  if (!Array.isArray(ring)) return null;
  return ring.map(([lon, lat]) => [lat, lon]);
}

// Fire-and-forget: when a team gets assigned to a zone, build a street checklist
// from OSM (and, for vehicle-capable teams, a driving route through sampled
// waypoints). Stored on the team row and broadcast to the operation bus so the
// controller UI and the field view both pick it up without a refresh.
async function buildTeamAssignment(teamId, zoneId) {
  try {
    const team = teams.get(teamId);
    const zone = zones.get(zoneId);
    if (!team || !zone) return;
    const ring = zoneOuterRing(zone.geometry);
    if (!ring) return;

    const streets = await searchHelpers.streetsInPolygon(ring).catch(() => []);
    const checklist = streets.map((s) => ({ name: s.name, cleared_at: null, cleared_by: null }));

    let routeGeometry = null;
    let routeMeta = null;
    if ((team.capability || '').toLowerCase().includes('vehicle') && ring.length >= 3) {
      // Sample ≤20 waypoints evenly around the ring — OSRM trip caps at 50.
      const step = Math.max(1, Math.floor(ring.length / 20));
      const waypoints = ring.filter((_, i) => i % step === 0).slice(0, 20);
      const route = await searchHelpers.vehicleRouteThrough(waypoints).catch(() => null);
      if (route) {
        routeGeometry = route.geometry;
        routeMeta = { distance_m: route.distance_m, duration_s: route.duration_s };
      }
    }

    teams.setAssignment(teamId, {
      zoneId,
      streets: checklist,
      routeGeometry,
      routeMeta,
    });
    audit.log(team.operation_id, 'operator', 'team_assignment_built', {
      team_id: teamId,
      zone_id: zoneId,
      streets: checklist.length,
      has_route: !!routeGeometry,
    });
    const updated = teams.get(teamId);
    broadcast(team.operation_id, { type: 'team_assigned', data: updated });
    broadcast(team.operation_id, { type: 'operation_updated', data: { id: team.operation_id } });
  } catch (err) {
    console.error('[search] buildTeamAssignment failed:', err?.message || err);
  }
}

// ── SSE event bus (per-operation) ──
const operationBus = new EventEmitter();
operationBus.setMaxListeners(200);

function broadcast(operationId, event) {
  operationBus.emit(operationId, event);
}

// ── Photo uploads ──
const uploadsDir = path.join(__dirname, '..', 'uploads', 'search');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// ── Field team auth middleware ──
function fieldAuth(req, res, next) {
  const token = req.query.token || req.headers['x-search-token'] || req.cookies?.search_token;
  if (!token) return res.status(401).json({ error: 'Team token required' });
  const team = teams.getByToken(token);
  if (!team) return res.status(401).json({ error: 'Invalid team token' });
  req.searchTeam = team;
  next();
}

// Require an authenticated operator (owner or operator role). Viewers can read
// but not mutate. Field-team endpoints are handled separately via fieldAuth.
function requireSearchAdmin(req, res, next) {
  if (req.searchTeam) return res.status(403).json({ error: 'Admin access required' });
  if (!req.tenant) return res.status(401).json({ error: 'Login required', auth_required: true });
  if (req.tenant.role === 'viewer') return res.status(403).json({ error: 'Edit access required' });
  next();
}

// ════════════════════════════════════════════════
// OPERATIONS
// ════════════════════════════════════════════════

router.get('/operations', requireTenant, (req, res) => {
  const list = operations.list(req.query.status || null, req.tenant.id);
  res.json({ operations: list });
});

router.post('/operations', requireSearchAdmin, (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  const op = operations.create({ ...req.body, tenant_id: req.tenant.id, created_by: req.tenant.email });
  broadcast(op.id, { type: 'operation_updated', data: op });
  res.status(201).json(op);
});

router.get('/operations/:id', requireTenant, (req, res) => {
  const op = opForTenant(req, res, req.params.id);
  if (!op) return;
  res.json(op);
});

router.patch('/operations/:id', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const op = operations.update(req.params.id, req.body);
  if (!op) return res.status(404).json({ error: 'Operation not found' });
  broadcast(op.id, { type: 'operation_updated', data: { id: op.id, status: op.status, name: op.name } });
  res.json(op);
});

router.delete('/operations/:id', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const removed = operations.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Operation not found' });
  broadcast(req.params.id, { type: 'operation_deleted', data: { id: req.params.id } });
  res.json({ ok: true });
});

router.post('/operations/:id/activate', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const op = operations.update(req.params.id, { status: 'active' });
  if (!op) return res.status(404).json({ error: 'Operation not found' });
  broadcast(op.id, { type: 'operation_updated', data: { id: op.id, status: 'active' } });
  res.json(op);
});

// Subject photo upload. Returns { photo_url } and also merges it into the
// operation's subject_info so the brief/print view and operation header can
// render it without an extra round-trip.
router.post('/operations/:id/subject/photo', requireSearchAdmin, upload.single('photo'), (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const op = operations.get(req.params.id);
  if (!op) return res.status(404).json({ error: 'Operation not found' });
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const photoUrl = `/api/search/uploads/${req.file.filename}`;
  const subjectInfo = { ...(op.subject_info || {}), photo_url: photoUrl };
  const updated = operations.update(req.params.id, { subject_info: subjectInfo });
  audit.log(req.params.id, 'operator', 'subject_photo_uploaded', { photo_url: photoUrl });
  broadcast(req.params.id, { type: 'operation_updated', data: { id: req.params.id, subject_info: subjectInfo } });
  res.status(201).json({ photo_url: photoUrl, operation: updated });
});

// ── SSE Stream ──
router.get('/operations/:id/stream', requireTenant, (req, res) => {
  const opId = req.params.id;
  if (!guardOperationId(req, res, opId)) return;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial state
  const op = operations.get(opId);
  if (op) {
    res.write(`data: ${JSON.stringify({ type: 'init', data: op })}\n\n`);
  }

  const handler = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  operationBus.on(opId, handler);

  // Heartbeat every 30s
  const hb = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  req.on('close', () => {
    operationBus.off(opId, handler);
    clearInterval(hb);
  });
});

// ════════════════════════════════════════════════
// ZONES
// ════════════════════════════════════════════════

router.post('/operations/:id/zones', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const { name, geometry } = req.body;
  if (!name || !geometry) return res.status(400).json({ error: 'name and geometry required' });
  const zone = zones.create(req.params.id, req.body);
  broadcast(req.params.id, { type: 'zone_updated', data: zone });
  res.status(201).json(zone);
});

router.post('/operations/:id/zones/batch', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const { zones: zoneList } = req.body;
  if (!Array.isArray(zoneList) || zoneList.length === 0) {
    return res.status(400).json({ error: 'zones array required' });
  }
  const result = zones.createBatch(req.params.id, zoneList);
  broadcast(req.params.id, { type: 'operation_updated', data: { id: req.params.id } });
  res.status(201).json({ zones: result });
});

router.patch('/zones/:zoneId', requireSearchAdmin, (req, res) => {
  const before = zones.get(req.params.zoneId);
  if (!before) return res.status(404).json({ error: 'Zone not found' });
  if (!guardOperationId(req, res, before.operation_id)) return;
  const zone = zones.update(req.params.zoneId, req.body);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  broadcast(zone.operation_id, { type: 'zone_updated', data: zone });

  // Reactive: if the team assignment changed, build the street checklist /
  // driving route for the new team and clear it off the previous team.
  const prevTeamId = before?.assigned_team_id || null;
  const nextTeamId = zone.assigned_team_id || null;
  if (prevTeamId !== nextTeamId) {
    if (prevTeamId) {
      teams.setAssignment(prevTeamId, { zoneId: null, streets: null, routeGeometry: null, routeMeta: null });
      const clearedTeam = teams.get(prevTeamId);
      if (clearedTeam) broadcast(zone.operation_id, { type: 'team_assigned', data: clearedTeam });
    }
    if (nextTeamId) {
      setImmediate(() => buildTeamAssignment(nextTeamId, zone.id));
    }
  }

  res.json(zone);
});

router.delete('/zones/:zoneId', requireSearchAdmin, (req, res) => {
  const zone = zones.get(req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  if (!guardOperationId(req, res, zone.operation_id)) return;
  zones.delete(req.params.zoneId);
  broadcast(zone.operation_id, { type: 'operation_updated', data: { id: zone.operation_id } });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
// DATUMS (named reference points: LKP / PLP / sightings etc.)
// ════════════════════════════════════════════════

router.post('/operations/:id/datums', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const { label, kind, lat, lon, notes } = req.body || {};
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'lat and lon (numbers) required' });
  }
  const datum = datums.create(req.params.id, { label, kind, lat, lon, notes });
  broadcast(req.params.id, { type: 'operation_updated', data: { id: req.params.id } });
  res.status(201).json(datum);
});

router.patch('/datums/:datumId', requireSearchAdmin, (req, res) => {
  const existing = datums.get(req.params.datumId);
  if (!existing) return res.status(404).json({ error: 'Datum not found' });
  if (!guardOperationId(req, res, existing.operation_id)) return;
  const updated = datums.update(req.params.datumId, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Datum not found' });
  broadcast(updated.operation_id, { type: 'operation_updated', data: { id: updated.operation_id } });
  res.json(updated);
});

router.delete('/datums/:datumId', requireSearchAdmin, (req, res) => {
  const d = datums.get(req.params.datumId);
  if (!d) return res.status(404).json({ error: 'Datum not found' });
  if (!guardOperationId(req, res, d.operation_id)) return;
  datums.delete(req.params.datumId);
  broadcast(d.operation_id, { type: 'operation_updated', data: { id: d.operation_id } });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
// TEAMS
// ════════════════════════════════════════════════

router.post('/operations/:id/teams', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const { name, platform_type } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!isValidPlatform(platform_type)) {
    return res.status(400).json({ error: `Unknown platform_type: ${platform_type}` });
  }
  const team = teams.create(req.params.id, req.body);
  res.status(201).json(team);
});

router.patch('/teams/:teamId', requireSearchAdmin, (req, res) => {
  const existing = teams.get(req.params.teamId);
  if (!existing) return res.status(404).json({ error: 'Team not found' });
  if (!guardOperationId(req, res, existing.operation_id)) return;
  if (Object.prototype.hasOwnProperty.call(req.body, 'platform_type') && !isValidPlatform(req.body.platform_type)) {
    return res.status(400).json({ error: `Unknown platform_type: ${req.body.platform_type}` });
  }
  const team = teams.update(req.params.teamId, req.body);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  broadcast(team.operation_id, { type: 'operation_updated', data: { id: team.operation_id } });
  res.json(team);
});

// Mark a street on the team's checklist as cleared (or re-open it). Accepts
// either a field-team token (so the driver / walker can tick it on their phone)
// or admin access (so the controller can correct). Broadcasts a
// `checklist_updated` event so the other side sees it instantly, and posts a
// `area_clear` report for audit/ops visibility.
router.patch('/teams/:teamId/streets/:streetName', (req, res) => {
  const teamId = req.params.teamId;
  const streetName = decodeURIComponent(req.params.streetName);
  const cleared = !!req.body?.cleared;
  const target = teams.get(teamId);
  if (!target) return res.status(404).json({ error: 'Team not found' });

  // Auth: field token must match THIS team, otherwise fall back to admin.
  const tokenFromReq = req.query.token || req.headers['x-search-token'] || req.cookies?.search_token;
  let actor = 'operator';
  if (tokenFromReq) {
    const holder = teams.getByToken(tokenFromReq);
    if (!holder || holder.id !== teamId) return res.status(403).json({ error: 'Token does not match team' });
    actor = holder.callsign || holder.name;
  }

  const updated = teams.setStreetCleared(teamId, streetName, cleared, actor);
  if (!updated) return res.status(404).json({ error: 'Checklist or street not found' });

  broadcast(updated.operation_id, { type: 'checklist_updated', data: updated });

  // Only log + report on the "cleared" transition; re-opening is just a correction.
  if (cleared) {
    audit.log(updated.operation_id, actor, 'street_cleared', { team_id: teamId, street: streetName });
    if (updated.assigned_zone_id) {
      reports.create(updated.operation_id, {
        zone_id: updated.assigned_zone_id,
        team_id: teamId,
        type: 'area_clear',
        description: `Cleared: ${streetName}`,
        severity: 'info',
        created_at: req.body?.client_ts,
      });
    }
  }
  res.json(updated);
});

router.post('/teams/:teamId/position', (req, res) => {
  const { lat, lon } = req.body;
  if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });
  teams.updatePosition(req.params.teamId, lat, lon);
  const team = teams.get(req.params.teamId);
  if (team) {
    broadcast(team.operation_id, {
      type: 'team_position',
      data: { team_id: team.id, lat, lon, at: new Date().toISOString(), name: team.name, callsign: team.callsign, color: team.color },
    });
  }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════════════

router.get('/operations/:id/reports', requireTenant, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const limit = parseInt(req.query.limit) || 100;
  const list = reports.listByOperation(req.params.id, limit);
  res.json({ reports: list });
});

router.post('/operations/:id/reports/:reportId/acknowledge', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const r = reports.acknowledge(req.params.reportId, req.body.by);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  res.json(r);
});

// ════════════════════════════════════════════════
// FIELD TEAM ENDPOINTS
// ════════════════════════════════════════════════

router.get('/field/context', fieldAuth, (req, res) => {
  const team = req.searchTeam;
  const op = operations.get(team.operation_id);
  if (!op) return res.status(404).json({ error: 'Operation not found' });

  const assignedZones = op.zones.filter(z => z.assigned_team_id === team.id);
  const recentReports = reports.listByOperation(team.operation_id, 50)
    .filter(r => r.team_id === team.id);

  res.json({
    team: { ...team, token: undefined }, // Don't echo token back
    operation: {
      id: op.id,
      name: op.name,
      type: op.type,
      status: op.status,
      subject_info: op.subject_info,
      datum_lat: op.datum_lat,
      datum_lon: op.datum_lon,
    },
    assigned_zones: assignedZones,
    recent_reports: recentReports,
    // Street-clear checklist and (optional) driving route already live on the
    // team row via teams.setAssignment; echo them for clarity on the field UI.
    street_checklist: team.street_checklist || [],
    vehicle_route: team.vehicle_route_geometry
      ? { geometry: team.vehicle_route_geometry, meta: team.vehicle_route_meta }
      : null,
  });
});

router.post('/field/report', fieldAuth, (req, res) => {
  const team = req.searchTeam;
  const { type, lat, lon, grid_ref, description, severity, zone_id, client_ts } = req.body;
  if (!type) return res.status(400).json({ error: 'type required' });

  const report = reports.create(team.operation_id, {
    zone_id,
    team_id: team.id,
    type,
    lat,
    lon,
    grid_ref,
    description,
    severity,
    created_at: client_ts,
  });
  broadcast(team.operation_id, { type: 'report_submitted', data: { ...report, team_name: team.name, team_callsign: team.callsign } });
  res.status(201).json(report);
});

router.post('/field/checkin', fieldAuth, (req, res) => {
  const team = req.searchTeam;
  const { lat, lon, client_ts } = req.body;
  if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });

  teams.updatePosition(team.id, lat, lon);
  broadcast(team.operation_id, {
    type: 'team_position',
    data: { team_id: team.id, lat, lon, at: client_ts || new Date().toISOString(), name: team.name, callsign: team.callsign, color: team.color },
  });

  // Also create a checkin report — honors client_ts when drained from offline queue.
  reports.create(team.operation_id, {
    team_id: team.id,
    type: 'checkin',
    lat,
    lon,
    description: `Check-in from ${team.callsign}`,
    severity: 'info',
    created_at: client_ts,
  });

  res.json({ ok: true });
});

router.post('/field/photo', fieldAuth, upload.single('photo'), (req, res) => {
  const team = req.searchTeam;
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

  const photoUrl = `/api/search/uploads/${req.file.filename}`;
  const { lat, lon, grid_ref, description, zone_id } = req.body;

  const report = reports.create(team.operation_id, {
    zone_id: zone_id || null,
    team_id: team.id,
    type: 'photo',
    lat: lat ? parseFloat(lat) : null,
    lon: lon ? parseFloat(lon) : null,
    grid_ref,
    description: description || 'Photo report',
    photo_url: photoUrl,
    severity: 'info',
  });
  broadcast(team.operation_id, { type: 'report_submitted', data: { ...report, team_name: team.name } });
  res.status(201).json(report);
});

// Serve uploaded photos
router.use('/uploads', express.static(uploadsDir));

// ════════════════════════════════════════════════
// COMMS LOG
// ════════════════════════════════════════════════

router.get('/operations/:id/comms', requireTenant, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const limit = parseInt(req.query.limit) || 200;
  const list = comms.list(req.params.id, limit);
  res.json({ comms: list });
});

router.post('/operations/:id/comms', requireSearchAdmin, async (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const { from_callsign, to_callsign, message, type, fan_out_to } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const entry = comms.add(req.params.id, { from_callsign, to_callsign, message, type, source_channel: 'ops-console' });
  broadcast(req.params.id, { type: 'comms', data: entry });
  res.status(201).json(entry);

  // Fire-and-forget cross-channel fan-out. The client may pass an explicit
  // channel list; otherwise we fall back to the tenant/operation routing
  // config so the operator doesn't have to re-pick channels each time.
  let channels = Array.isArray(fan_out_to) ? fan_out_to : null;
  if (!channels) {
    try {
      const { routing } = require('../search-db');
      const cfg = routing.getEffective(req.tenant.id, req.params.id);
      channels = cfg.enabled_channels || [];
    } catch { channels = []; }
  }
  if (channels.length > 0) {
    const gatewayUrl = process.env.DISPATCH_URL;
    const sharedSecret = process.env.DISPATCH_SHARED_SECRET;
    if (!gatewayUrl || !sharedSecret) return;
    const axios = require('axios');
    axios.post(`${gatewayUrl.replace(/\/+$/, '')}/send`, {
      tenant_id: req.tenant.id,
      operation_id: req.params.id,
      channels,
      message: { from: from_callsign || 'ops', body: message, meta: { operation_id: req.params.id } },
    }, {
      timeout: 15_000,
      headers: { 'x-comms-app': 'search-surface', 'x-comms-secret': sharedSecret },
      validateStatus: () => true,
    }).then((result) => {
      const results = result.data?.results || {};
      broadcast(req.params.id, { type: 'comms_fanout', data: { comms_id: entry.id, results } });
    }).catch((err) => {
      console.warn('[search] comms fan-out failed:', err.message);
    });
  }
});

// ════════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════════

router.get('/operations/:id/audit', requireTenant, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const limit = parseInt(req.query.limit) || 200;
  const list = audit.list(req.params.id, limit);
  res.json({ audit: list });
});

// ════════════════════════════════════════════════
// SITREP
// ════════════════════════════════════════════════

router.get('/operations/:id/sitrep', requireTenant, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const sitrep = generateSitrep(req.params.id);
  if (!sitrep) return res.status(404).json({ error: 'Operation not found' });
  res.json(sitrep);
});

// ════════════════════════════════════════════════
// SHARE TOKENS + BRIEF (public read-only)
// ════════════════════════════════════════════════

// Create a share token for an operation. Admin only. TTL in hours, optional.
router.post('/operations/:id/share', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const op = operations.get(req.params.id);
  if (!op) return res.status(404).json({ error: 'Operation not found' });
  const ttlHours = Number(req.body?.ttl_hours) || null;
  const result = shareTokens.create(req.params.id, { ttlHours });
  audit.log(req.params.id, 'operator', 'share_token_created', { expires_at: result.expires_at });
  res.status(201).json(result);
});

router.get('/operations/:id/shares', requireSearchAdmin, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  res.json({ shares: shareTokens.listByOperation(req.params.id) });
});

router.delete('/shares/:token', requireSearchAdmin, (req, res) => {
  const entry = shareTokens.getByToken(req.params.token);
  // If already revoked/missing the tenant guard can't resolve it — just 404
  // rather than leaking existence.
  if (!entry) return res.status(404).json({ error: 'Share not found' });
  if (!guardOperationId(req, res, entry.operation_id)) return;
  shareTokens.revoke(req.params.token);
  res.json({ ok: true });
});

// Public read-only briefing by token. Returns op, zones, datums, teams (no
// tokens leaked), reports + sitrep. Used by /brief/:token frontend page for
// stakeholders and print view.
router.get('/brief/:token', (req, res) => {
  const entry = shareTokens.getByToken(req.params.token);
  if (!entry) return res.status(404).json({ error: 'Invalid or expired share link' });
  const op = operations.get(entry.operation_id);
  if (!op) return res.status(404).json({ error: 'Operation not found' });
  const sitrep = generateSitrep(entry.operation_id);
  // Scrub team tokens before returning — share links must not leak field auth.
  const safeTeams = (op.teams || []).map(({ token, ...t }) => t);
  res.json({
    operation: { ...op, teams: safeTeams },
    sitrep,
    reports: reports.listByOperation(entry.operation_id, 50).map(({ photo_url, ...r }) => r),
    generated_at: new Date().toISOString(),
    share: { token: req.params.token, expires_at: entry.expires_at },
  });
});

// Reports whether the caller is authed. Frontend uses this to decide whether
// to render the app or redirect to /login. `required: true` is hardcoded now
// that tenancy is mandatory; kept as a field so the frontend contract is stable.
router.get('/auth/status', (req, res) => {
  res.json({
    required: true,
    authed: !!req.tenant,
    user: req.tenant ? {
      id: req.tenant.user_id,
      email: req.tenant.email,
      display_name: req.tenant.display_name,
      role: req.tenant.role,
      tenant: { id: req.tenant.id, slug: req.tenant.slug, name: req.tenant.name, plan: req.tenant.plan },
    } : null,
  });
});

// Email the current SITREP to a list of stakeholders. Routed through the
// shared mail relay (see user memory reference_mail_relay). Creates a fresh
// 72h share token so recipients get a live-briefing link, not a snapshot.
router.post('/operations/:id/sitrep/email', requireSearchAdmin, async (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const op = operations.get(req.params.id);
  if (!op) return res.status(404).json({ error: 'Operation not found' });

  const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const clean = recipients
    .map((s) => String(s).trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  if (clean.length === 0) return res.status(400).json({ error: 'At least one valid recipient required' });
  if (clean.length > 30) return res.status(400).json({ error: 'Too many recipients (max 30)' });

  const extraNote = typeof req.body?.message === 'string' ? req.body.message.slice(0, 2000) : '';

  const sitrep = generateSitrep(req.params.id);
  if (!sitrep) return res.status(500).json({ error: 'Failed to generate SITREP' });

  // Fresh share token so the link stays live (stakeholders can reopen the
  // brief as teams move). 72h matches the Share button in ExportPanel.
  const share = shareTokens.create(req.params.id, { createdBy: 'sitrep_email', ttlHours: 72 });
  const briefUrl = `${PUBLIC_BASE}/brief/${share.token}`;

  const subject = `SITREP — ${op.name} (${op.status})`;
  const subjectInfo = op.subject_info;
  const subjectBlock = subjectInfo?.name
    ? `Subject: ${subjectInfo.name}${subjectInfo.age ? `, ${subjectInfo.age}y` : ''}${subjectInfo.description ? ` — ${subjectInfo.description}` : ''}`
    : '';

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 640px; margin: 0 auto; color: #111;">
      <h2 style="margin: 0 0 4px; color: #0f172a;">${escapeHtml(op.name)}</h2>
      <div style="color: #64748b; font-size: 13px; margin-bottom: 12px;">
        ${escapeHtml((op.type || '').replace(/_/g, ' '))} · <strong>${escapeHtml(op.status)}</strong>
      </div>
      ${subjectBlock ? `<div style="padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; font-size: 13px; margin-bottom: 14px;">${escapeHtml(subjectBlock)}</div>` : ''}
      ${extraNote ? `<div style="padding: 10px 12px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; font-size: 13px; margin-bottom: 14px; white-space: pre-wrap;">${escapeHtml(extraNote)}</div>` : ''}
      <pre style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.45; white-space: pre-wrap; color: #1e293b;">${escapeHtml(sitrep.text)}</pre>
      <p style="margin-top: 16px; font-size: 13px;">
        <a href="${briefUrl}" style="background: #0284c7; color: white; text-decoration: none; padding: 8px 14px; border-radius: 4px; display: inline-block;">Open live briefing</a>
      </p>
      <p style="margin-top: 8px; color: #64748b; font-size: 11px;">
        Live link valid 72h. Generated at ${new Date().toISOString()} from search.wispayr.online.
      </p>
    </div>
  `;

  const text = [
    op.name,
    `${op.type?.replace(/_/g, ' ') || ''} · ${op.status}`,
    subjectBlock ? '' : null,
    subjectBlock,
    extraNote ? `\n${extraNote}\n` : null,
    '',
    sitrep.text,
    '',
    `Live briefing: ${briefUrl} (72h)`,
  ].filter((x) => x !== null).join('\n');

  try {
    await axios.post(MAIL_RELAY_URL, {
      from: `${MAIL_FROM_NAME} <${MAIL_FROM}>`,
      to: clean,
      subject,
      text,
      html,
    }, {
      timeout: 15000,
      headers: { 'x-api-key': MAIL_RELAY_KEY, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    audit.log(req.params.id, 'operator', 'sitrep_email_failed', { error: String(detail).slice(0, 500) });
    return res.status(502).json({ error: 'Mail relay rejected the request', detail });
  }

  // Persist recipients so controllers don't retype next broadcast.
  operations.update(req.params.id, { sitrep_recipients: clean });
  audit.log(req.params.id, 'operator', 'sitrep_emailed', { recipients: clean, share_token: share.token });
  res.json({ ok: true, sent: clean.length, recipients: clean, share_token: share.token });
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ════════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════════

router.get('/operations/:id/export/geojson', requireTenant, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const op = operations.get(req.params.id);
  if (!op) return res.status(404).json({ error: 'Operation not found' });

  const features = op.zones.map(z => ({
    ...z.geometry,
    properties: {
      ...((z.geometry && z.geometry.properties) || {}),
      zone_id: z.id,
      name: z.name,
      status: z.status,
      priority: z.priority,
      pod: z.pod,
      cumulative_pod: z.cumulative_pod,
      search_method: z.search_method,
      assigned_team: op.teams.find(t => t.id === z.assigned_team_id)?.name || null,
    },
  }));

  // Add team positions
  for (const t of op.teams) {
    if (t.last_lat && t.last_lon) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [t.last_lon, t.last_lat] },
        properties: { type: 'team_position', name: t.name, callsign: t.callsign, status: t.status },
      });
    }
  }

  // Add datum
  if (op.datum_lat && op.datum_lon) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [op.datum_lon, op.datum_lat] },
      properties: { type: 'datum', name: 'Search Datum' },
    });
  }

  const fc = {
    type: 'FeatureCollection',
    properties: { operation: op.name, type: op.type, status: op.status, exported_at: new Date().toISOString() },
    features,
  };

  res.setHeader('Content-Type', 'application/geo+json');
  res.setHeader('Content-Disposition', `attachment; filename="${op.name.replace(/[^a-zA-Z0-9]/g, '_')}.geojson"`);
  res.json(fc);
});

router.get('/operations/:id/export/gpx', requireTenant, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const op = operations.get(req.params.id);
  if (!op) return res.status(404).json({ error: 'Operation not found' });

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PrismSurface" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(op.name)}</name><time>${new Date().toISOString()}</time></metadata>
`;

  // Datum waypoint
  if (op.datum_lat && op.datum_lon) {
    gpx += `  <wpt lat="${op.datum_lat}" lon="${op.datum_lon}"><name>Datum</name><sym>Flag</sym></wpt>\n`;
  }

  // Zone centroids as waypoints
  for (const z of op.zones) {
    const centroid = getPolygonCentroid(z.geometry);
    if (centroid) {
      gpx += `  <wpt lat="${centroid[1]}" lon="${centroid[0]}"><name>${escapeXml(z.name)}</name><desc>Status: ${z.status}, POD: ${Math.round(z.cumulative_pod * 100)}%</desc></wpt>\n`;
    }
  }

  // Team positions
  for (const t of op.teams) {
    if (t.last_lat && t.last_lon) {
      gpx += `  <wpt lat="${t.last_lat}" lon="${t.last_lon}"><name>${escapeXml(t.callsign || t.name)}</name><sym>Circle</sym></wpt>\n`;
    }
  }

  gpx += '</gpx>';

  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="${op.name.replace(/[^a-zA-Z0-9]/g, '_')}.gpx"`);
  res.send(gpx);
});

router.get('/operations/:id/export/kml', requireTenant, (req, res) => {
  if (!guardOperationId(req, res, req.params.id)) return;
  const op = operations.get(req.params.id);
  if (!op) return res.status(404).json({ error: 'Operation not found' });

  const statusColors = { unassigned: '7f7f7f7f', assigned: '7fff9900', in_progress: '7f00ccff', complete: '7f00cc00', suspended: '7f0000ff' };

  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><name>${escapeXml(op.name)}</name>
`;

  // Styles
  for (const [status, color] of Object.entries(statusColors)) {
    kml += `<Style id="zone-${status}"><PolyStyle><color>${color}</color></PolyStyle><LineStyle><color>ff${color.slice(2)}</color><width>2</width></LineStyle></Style>\n`;
  }

  // Datum
  if (op.datum_lat && op.datum_lon) {
    kml += `<Placemark><name>Datum</name><Point><coordinates>${op.datum_lon},${op.datum_lat},0</coordinates></Point></Placemark>\n`;
  }

  // Zones
  kml += '<Folder><name>Zones</name>\n';
  for (const z of op.zones) {
    if (z.geometry?.geometry?.type === 'Polygon' && z.geometry.geometry.coordinates?.[0]) {
      const coords = z.geometry.geometry.coordinates[0].map(c => `${c[0]},${c[1]},0`).join(' ');
      kml += `<Placemark><name>${escapeXml(z.name)}</name><styleUrl>#zone-${z.status}</styleUrl>
<description>Method: ${z.search_method}, POD: ${Math.round(z.cumulative_pod * 100)}%, Priority: ${z.priority}</description>
<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>\n`;
    }
  }
  kml += '</Folder>\n';

  // Teams
  kml += '<Folder><name>Teams</name>\n';
  for (const t of op.teams) {
    if (t.last_lat && t.last_lon) {
      kml += `<Placemark><name>${escapeXml(t.callsign || t.name)}</name><Point><coordinates>${t.last_lon},${t.last_lat},0</coordinates></Point></Placemark>\n`;
    }
  }
  kml += '</Folder>\n';

  kml += '</Document></kml>';

  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
  res.setHeader('Content-Disposition', `attachment; filename="${op.name.replace(/[^a-zA-Z0-9]/g, '_')}.kml"`);
  res.send(kml);
});

// ════════════════════════════════════════════════
// DRONE FLIGHT PLAN DOWNLOAD
// ════════════════════════════════════════════════

// Download flight plan for a specific drone zone as GPX with waypoint sequence
router.get('/zones/:zoneId/flight-plan/gpx', requireTenant, (req, res) => {
  const zone = zones.get(req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  if (!guardOperationId(req, res, zone.operation_id)) return;

  const plan = zone.geometry?.properties?.drone_flight_plan;
  if (!plan) return res.status(400).json({ error: 'Zone has no drone flight plan' });

  const wps = plan.waypoints || [];
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PrismSurface-DroneSearch" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(zone.name)} — Flight Plan</name>
    <desc>Altitude: ${plan.altitude_m}m AGL | Speed: ${plan.speed_ms}m/s | Passes: ${plan.num_passes} | Distance: ${plan.total_distance_km}km | Duration: ${plan.estimated_flight_min}min</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <rte>
    <name>${escapeXml(zone.name)}</name>
`;
  wps.forEach((wp, i) => {
    gpx += `    <rtept lat="${wp[1]}" lon="${wp[0]}"><ele>${plan.altitude_m}</ele><name>WP${i + 1}</name></rtept>\n`;
  });
  gpx += `  </rte>\n`;

  // Also include as a track for visualization
  gpx += `  <trk><name>${escapeXml(zone.name)} Track</name><trkseg>\n`;
  wps.forEach((wp) => {
    gpx += `    <trkpt lat="${wp[1]}" lon="${wp[0]}"><ele>${plan.altitude_m}</ele></trkpt>\n`;
  });
  gpx += `  </trkseg></trk>\n</gpx>`;

  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="${zone.name.replace(/[^a-zA-Z0-9]/g, '_')}_flight_plan.gpx"`);
  res.send(gpx);
});

// Download as KML (for Google Earth / DJI Ground Station)
router.get('/zones/:zoneId/flight-plan/kml', requireTenant, (req, res) => {
  const zone = zones.get(req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  if (!guardOperationId(req, res, zone.operation_id)) return;

  const plan = zone.geometry?.properties?.drone_flight_plan;
  if (!plan) return res.status(400).json({ error: 'Zone has no drone flight plan' });

  const wps = plan.waypoints || [];
  const coordStr = wps.map(wp => `${wp[0]},${wp[1]},${plan.altitude_m}`).join(' ');

  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escapeXml(zone.name)} — Flight Plan</name>
  <description>Altitude: ${plan.altitude_m}m AGL | Speed: ${plan.speed_ms}m/s | Passes: ${plan.num_passes} | Distance: ${plan.total_distance_km}km | Duration: ~${plan.estimated_flight_min}min</description>
  <Style id="flightpath"><LineStyle><color>ff00aaff</color><width>3</width></LineStyle></Style>
`;

  // Waypoints as placemarks
  wps.forEach((wp, i) => {
    kml += `  <Placemark><name>WP${i + 1}</name><Point><altitudeMode>relativeToGround</altitudeMode><coordinates>${wp[0]},${wp[1]},${plan.altitude_m}</coordinates></Point></Placemark>\n`;
  });

  // Flight path as linestring
  kml += `  <Placemark><name>Flight Path</name><styleUrl>#flightpath</styleUrl>
    <LineString><altitudeMode>relativeToGround</altitudeMode><coordinates>${coordStr}</coordinates></LineString>
  </Placemark>\n`;

  kml += '</Document></kml>';

  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
  res.setHeader('Content-Disposition', `attachment; filename="${zone.name.replace(/[^a-zA-Z0-9]/g, '_')}_flight_plan.kml"`);
  res.send(kml);
});

// Flight plan metadata (JSON — for UI display)
router.get('/zones/:zoneId/flight-plan', requireTenant, (req, res) => {
  const zone = zones.get(req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  if (!guardOperationId(req, res, zone.operation_id)) return;

  const plan = zone.geometry?.properties?.drone_flight_plan;
  if (!plan) return res.status(400).json({ error: 'Zone has no drone flight plan' });

  res.json({
    zone_id: zone.id,
    zone_name: zone.name,
    ...plan,
    download_gpx: `/api/search/zones/${zone.id}/flight-plan/gpx`,
    download_kml: `/api/search/zones/${zone.id}/flight-plan/kml`,
  });
});

// ── Helpers ──
function escapeXml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getPolygonCentroid(feature) {
  if (!feature?.geometry?.coordinates?.[0]) return null;
  const coords = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : null;
  if (!coords || coords.length === 0) return null;
  const sumLon = coords.reduce((s, c) => s + c[0], 0);
  const sumLat = coords.reduce((s, c) => s + c[1], 0);
  return [sumLon / coords.length, sumLat / coords.length];
}

module.exports = router;
module.exports.broadcast = broadcast;
