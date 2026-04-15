const express = require('express');
const { operations, zones, teams, reports, comms, datums, audit, generateSitrep } = require('../search-db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const router = express.Router();

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

// ── Require admin (no tenant = admin, or tenant with admin role) ──
function requireSearchAdmin(req, res, next) {
  // If a field team token is present, deny admin access
  if (req.searchTeam) return res.status(403).json({ error: 'Admin access required' });
  // Tenant viewers can't modify
  if (req.tenant && req.tenant.role === 'viewer') return res.status(403).json({ error: 'Edit access required' });
  next();
}

// ════════════════════════════════════════════════
// OPERATIONS
// ════════════════════════════════════════════════

router.get('/operations', (req, res) => {
  const list = operations.list(req.query.status || null);
  res.json({ operations: list });
});

router.post('/operations', requireSearchAdmin, (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  const op = operations.create(req.body);
  broadcast(op.id, { type: 'operation_updated', data: op });
  res.status(201).json(op);
});

router.get('/operations/:id', (req, res) => {
  const op = operations.get(req.params.id);
  if (!op) return res.status(404).json({ error: 'Operation not found' });
  res.json(op);
});

router.patch('/operations/:id', requireSearchAdmin, (req, res) => {
  const op = operations.update(req.params.id, req.body);
  if (!op) return res.status(404).json({ error: 'Operation not found' });
  broadcast(op.id, { type: 'operation_updated', data: { id: op.id, status: op.status, name: op.name } });
  res.json(op);
});

router.delete('/operations/:id', requireSearchAdmin, (req, res) => {
  const removed = operations.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Operation not found' });
  broadcast(req.params.id, { type: 'operation_deleted', data: { id: req.params.id } });
  res.json({ ok: true });
});

router.post('/operations/:id/activate', requireSearchAdmin, (req, res) => {
  const op = operations.update(req.params.id, { status: 'active' });
  if (!op) return res.status(404).json({ error: 'Operation not found' });
  broadcast(op.id, { type: 'operation_updated', data: { id: op.id, status: 'active' } });
  res.json(op);
});

// ── SSE Stream ──
router.get('/operations/:id/stream', (req, res) => {
  const opId = req.params.id;
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
  const { name, geometry } = req.body;
  if (!name || !geometry) return res.status(400).json({ error: 'name and geometry required' });
  const zone = zones.create(req.params.id, req.body);
  broadcast(req.params.id, { type: 'zone_updated', data: zone });
  res.status(201).json(zone);
});

router.post('/operations/:id/zones/batch', requireSearchAdmin, (req, res) => {
  const { zones: zoneList } = req.body;
  if (!Array.isArray(zoneList) || zoneList.length === 0) {
    return res.status(400).json({ error: 'zones array required' });
  }
  const result = zones.createBatch(req.params.id, zoneList);
  broadcast(req.params.id, { type: 'operation_updated', data: { id: req.params.id } });
  res.status(201).json({ zones: result });
});

router.patch('/zones/:zoneId', requireSearchAdmin, (req, res) => {
  const zone = zones.update(req.params.zoneId, req.body);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  broadcast(zone.operation_id, { type: 'zone_updated', data: zone });
  res.json(zone);
});

router.delete('/zones/:zoneId', requireSearchAdmin, (req, res) => {
  const zone = zones.get(req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  zones.delete(req.params.zoneId);
  broadcast(zone.operation_id, { type: 'operation_updated', data: { id: zone.operation_id } });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
// DATUMS (named reference points: LKP / PLP / sightings etc.)
// ════════════════════════════════════════════════

router.post('/operations/:id/datums', requireSearchAdmin, (req, res) => {
  const { label, kind, lat, lon, notes } = req.body || {};
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'lat and lon (numbers) required' });
  }
  const datum = datums.create(req.params.id, { label, kind, lat, lon, notes });
  broadcast(req.params.id, { type: 'operation_updated', data: { id: req.params.id } });
  res.status(201).json(datum);
});

router.patch('/datums/:datumId', requireSearchAdmin, (req, res) => {
  const updated = datums.update(req.params.datumId, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Datum not found' });
  broadcast(updated.operation_id, { type: 'operation_updated', data: { id: updated.operation_id } });
  res.json(updated);
});

router.delete('/datums/:datumId', requireSearchAdmin, (req, res) => {
  const d = datums.get(req.params.datumId);
  if (!d) return res.status(404).json({ error: 'Datum not found' });
  datums.delete(req.params.datumId);
  broadcast(d.operation_id, { type: 'operation_updated', data: { id: d.operation_id } });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
// TEAMS
// ════════════════════════════════════════════════

router.post('/operations/:id/teams', requireSearchAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const team = teams.create(req.params.id, req.body);
  res.status(201).json(team);
});

router.patch('/teams/:teamId', requireSearchAdmin, (req, res) => {
  const team = teams.update(req.params.teamId, req.body);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  broadcast(team.operation_id, { type: 'operation_updated', data: { id: team.operation_id } });
  res.json(team);
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

router.get('/operations/:id/reports', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const list = reports.listByOperation(req.params.id, limit);
  res.json({ reports: list });
});

router.post('/operations/:id/reports/:reportId/acknowledge', requireSearchAdmin, (req, res) => {
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
  });
});

router.post('/field/report', fieldAuth, (req, res) => {
  const team = req.searchTeam;
  const { type, lat, lon, grid_ref, description, severity, zone_id } = req.body;
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
  });
  broadcast(team.operation_id, { type: 'report_submitted', data: { ...report, team_name: team.name, team_callsign: team.callsign } });
  res.status(201).json(report);
});

router.post('/field/checkin', fieldAuth, (req, res) => {
  const team = req.searchTeam;
  const { lat, lon } = req.body;
  if (lat == null || lon == null) return res.status(400).json({ error: 'lat and lon required' });

  teams.updatePosition(team.id, lat, lon);
  broadcast(team.operation_id, {
    type: 'team_position',
    data: { team_id: team.id, lat, lon, at: new Date().toISOString(), name: team.name, callsign: team.callsign, color: team.color },
  });

  // Also create a checkin report
  reports.create(team.operation_id, {
    team_id: team.id,
    type: 'checkin',
    lat,
    lon,
    description: `Check-in from ${team.callsign}`,
    severity: 'info',
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

router.get('/operations/:id/comms', (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const list = comms.list(req.params.id, limit);
  res.json({ comms: list });
});

router.post('/operations/:id/comms', requireSearchAdmin, (req, res) => {
  const { from_callsign, to_callsign, message, type } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const entry = comms.add(req.params.id, { from_callsign, to_callsign, message, type });
  broadcast(req.params.id, { type: 'comms', data: entry });
  res.status(201).json(entry);
});

// ════════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════════

router.get('/operations/:id/audit', (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const list = audit.list(req.params.id, limit);
  res.json({ audit: list });
});

// ════════════════════════════════════════════════
// SITREP
// ════════════════════════════════════════════════

router.get('/operations/:id/sitrep', (req, res) => {
  const sitrep = generateSitrep(req.params.id);
  if (!sitrep) return res.status(404).json({ error: 'Operation not found' });
  res.json(sitrep);
});

// ════════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════════

router.get('/operations/:id/export/geojson', (req, res) => {
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

router.get('/operations/:id/export/gpx', (req, res) => {
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

router.get('/operations/:id/export/kml', (req, res) => {
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
router.get('/zones/:zoneId/flight-plan/gpx', (req, res) => {
  const zone = zones.get(req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });

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
router.get('/zones/:zoneId/flight-plan/kml', (req, res) => {
  const zone = zones.get(req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });

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
router.get('/zones/:zoneId/flight-plan', (req, res) => {
  const zone = zones.get(req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });

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
