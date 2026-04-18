const { db } = require('./db');
const crypto = require('crypto');

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS search_operations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('missing_person','security_sweep','event_patrol','welfare_check','custom')),
    status TEXT DEFAULT 'planning' CHECK(status IN ('planning','active','suspended','completed','stood_down')),
    datum_lat REAL,
    datum_lon REAL,
    bounds TEXT,
    subject_info TEXT,
    weather_notes TEXT,
    linked_event_id TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS search_zones (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES search_operations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    geometry TEXT NOT NULL,
    search_method TEXT DEFAULT 'sector' CHECK(search_method IN ('sector','parallel_grid','expanding_square','route_corridor','point_search')),
    status TEXT DEFAULT 'unassigned' CHECK(status IN ('unassigned','assigned','in_progress','complete','suspended')),
    priority INTEGER DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
    assigned_team_id TEXT,
    pod REAL DEFAULT 0,
    cumulative_pod REAL DEFAULT 0,
    spacing_m REAL,
    notes TEXT,
    poa REAL DEFAULT 0,
    sweep_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS search_teams (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES search_operations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    callsign TEXT,
    token TEXT UNIQUE NOT NULL,
    color TEXT DEFAULT '#00d4ff',
    members TEXT,
    capability TEXT,
    status TEXT DEFAULT 'standby' CHECK(status IN ('standby','deployed','returning','stood_down')),
    last_lat REAL,
    last_lon REAL,
    last_position_at TEXT,
    -- Street-clear checklist: populated when a team is assigned to a zone.
    -- Foot teams get a sorted street list; vehicle teams also get a driving route.
    assigned_zone_id TEXT,
    street_checklist TEXT,         -- JSON array of { name, cleared_at, cleared_by }
    vehicle_route_geometry TEXT,   -- GeoJSON LineString (vehicle teams only)
    vehicle_route_meta TEXT,       -- JSON { distance_m, duration_s }
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS search_reports (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES search_operations(id) ON DELETE CASCADE,
    zone_id TEXT,
    team_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('clue','area_clear','hazard','assist','welfare','photo','checkin','sitrep')),
    lat REAL,
    lon REAL,
    grid_ref TEXT,
    description TEXT,
    photo_url TEXT,
    severity TEXT DEFAULT 'info' CHECK(severity IN ('info','warn','urgent','critical')),
    acknowledged INTEGER DEFAULT 0,
    acknowledged_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS search_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL,
    actor TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS search_comms_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL,
    from_callsign TEXT,
    to_callsign TEXT,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'radio' CHECK(type IN ('radio','note','system')),
    source_channel TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sz_op ON search_zones(operation_id);
  CREATE INDEX IF NOT EXISTS idx_st_op ON search_teams(operation_id);
  CREATE INDEX IF NOT EXISTS idx_st_token ON search_teams(token);
  CREATE INDEX IF NOT EXISTS idx_sr_op ON search_reports(operation_id);
  CREATE INDEX IF NOT EXISTS idx_sal_op ON search_audit_log(operation_id);
  CREATE INDEX IF NOT EXISTS idx_scl_op ON search_comms_log(operation_id);

  CREATE TABLE IF NOT EXISTS search_datums (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES search_operations(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    kind TEXT DEFAULT 'other' CHECK(kind IN ('lkp','plp','sighting','witness','other')),
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sd_op ON search_datums(operation_id);

  -- Read-only public share links. Tokens scope to one operation and optionally expire.
  -- Used for shared briefing URLs (stakeholders, incoming units) and print view.
  CREATE TABLE IF NOT EXISTS search_share_tokens (
    token TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES search_operations(id) ON DELETE CASCADE,
    created_by TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    revoked INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sst_op ON search_share_tokens(operation_id);
`);

// Additive migrations for pre-checklist DBs — SQLite will error on dup-column
// so we swallow quietly. Runs once per boot, negligible cost.
for (const col of [
  'assigned_zone_id TEXT',
  'street_checklist TEXT',
  'vehicle_route_geometry TEXT',
  'vehicle_route_meta TEXT',
  // Timestamp of most recent deploy → used for fatigue alarm (4h rest
  // threshold). Cleared whenever status leaves 'deployed'/'returning'.
  'deployed_at TEXT',
]) {
  try { db.exec(`ALTER TABLE search_teams ADD COLUMN ${col}`); } catch { /* already present */ }
}

// Persist the last SITREP recipient list per operation so controllers don't
// retype on every broadcast.
for (const col of [
  'sitrep_recipients TEXT',
]) {
  try { db.exec(`ALTER TABLE search_operations ADD COLUMN ${col}`); } catch { /* already present */ }
}

// Additive migration: source_channel on comms log (tracks which integration
// a message came from for cross-channel routing and UI badging).
try { db.exec(`ALTER TABLE search_comms_log ADD COLUMN source_channel TEXT`); } catch { /* already present */ }
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_scl_source ON search_comms_log(source_channel)`); } catch { /* ok */ }

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function generateToken() { return crypto.randomBytes(24).toString('hex'); }

function parseJSON(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

// ── Operations ──
//
// All reads/writes accept an optional `tenantId`. Routes that have an
// authenticated tenant MUST pass it; callers without one (field team tokens
// resolved independently, brief tokens) pass null and the DB layer will trust
// the caller's scoping (field/brief endpoints already look up by operation_id
// and enforce their own auth).
const operations = {
  list(status, tenantId) {
    const base = `
      SELECT o.*,
        (SELECT COUNT(*) FROM search_zones WHERE operation_id = o.id) as zone_count,
        (SELECT COUNT(*) FROM search_teams WHERE operation_id = o.id) as team_count,
        (SELECT COUNT(*) FROM search_reports WHERE operation_id = o.id) as report_count
      FROM search_operations o
    `;
    const where = [];
    const vals = [];
    if (tenantId) { where.push('o.tenant_id = ?'); vals.push(tenantId); }
    if (status) { where.push('o.status = ?'); vals.push(status); }
    const sql = `${base}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY o.updated_at DESC`;
    const rows = db.prepare(sql).all(...vals);
    return rows.map(r => ({ ...r, subject_info: parseJSON(r.subject_info) }));
  },

  get(id, tenantId) {
    const op = tenantId
      ? db.prepare('SELECT * FROM search_operations WHERE id = ? AND tenant_id = ?').get(id, tenantId)
      : db.prepare('SELECT * FROM search_operations WHERE id = ?').get(id);
    if (!op) return null;
    op.subject_info = parseJSON(op.subject_info);
    op.sitrep_recipients = parseJSON(op.sitrep_recipients) || [];
    op.zones = zones.listByOperation(id);
    op.teams = teams.listByOperation(id);
    op.datums = datums.listByOperation(id);
    return op;
  },

  // Lightweight lookup used by middleware/field-auth to fetch just the
  // tenant_id for a given operation id without hydrating zones/teams/datums.
  getTenantId(id) {
    const row = db.prepare('SELECT tenant_id FROM search_operations WHERE id = ?').get(id);
    return row?.tenant_id || null;
  },

  create({ name, type, datum_lat, datum_lon, bounds, subject_info, weather_notes, linked_event_id, created_by, tenant_id }) {
    const id = uuid();
    const ts = now();
    db.prepare(`
      INSERT INTO search_operations (id, tenant_id, name, type, datum_lat, datum_lon, bounds, subject_info, weather_notes, linked_event_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenant_id || null, name, type, datum_lat || null, datum_lon || null, bounds || null,
      subject_info ? JSON.stringify(subject_info) : null, weather_notes || null,
      linked_event_id || null, created_by || 'operator', ts, ts);
    audit.log(id, created_by || 'operator', 'operation_created', { name, type });
    return this.get(id);
  },

  update(id, fields) {
    const allowed = ['name', 'type', 'status', 'datum_lat', 'datum_lon', 'bounds', 'subject_info', 'weather_notes', 'linked_event_id', 'sitrep_recipients'];
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.includes(k)) continue;
      if (k === 'subject_info' || k === 'sitrep_recipients') {
        sets.push(`${k} = ?`);
        vals.push(JSON.stringify(v));
      } else {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (fields.status === 'completed' || fields.status === 'stood_down') {
      sets.push('closed_at = ?');
      vals.push(now());
    }
    if (!sets.length) return this.get(id);
    sets.push('updated_at = ?');
    vals.push(now());
    vals.push(id);
    db.prepare(`UPDATE search_operations SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    audit.log(id, 'operator', 'operation_updated', fields);
    return this.get(id);
  },

  remove(id) {
    // Cascades defined on child tables (zones/teams/reports/etc) drop their rows.
    const info = db.prepare('DELETE FROM search_operations WHERE id = ?').run(id);
    return info.changes > 0;
  },
};

// ── Zones ──
const zones = {
  listByOperation(operationId) {
    return db.prepare('SELECT * FROM search_zones WHERE operation_id = ? ORDER BY priority ASC, name ASC')
      .all(operationId)
      .map(z => ({ ...z, geometry: parseJSON(z.geometry) }));
  },

  get(id) {
    const z = db.prepare('SELECT * FROM search_zones WHERE id = ?').get(id);
    if (!z) return null;
    z.geometry = parseJSON(z.geometry);
    return z;
  },

  create(operationId, { name, geometry, search_method, priority, spacing_m, poa, notes }) {
    const id = uuid();
    const ts = now();
    db.prepare(`
      INSERT INTO search_zones (id, operation_id, name, geometry, search_method, priority, spacing_m, poa, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, operationId, name, JSON.stringify(geometry), search_method || 'sector',
      priority || 3, spacing_m || null, poa || 0, notes || null, ts, ts);
    audit.log(operationId, 'operator', 'zone_created', { zone_id: id, name, search_method });
    // Touch operation
    db.prepare('UPDATE search_operations SET updated_at = ? WHERE id = ?').run(ts, operationId);
    return this.get(id);
  },

  createBatch(operationId, zoneList) {
    const ts = now();
    const stmt = db.prepare(`
      INSERT INTO search_zones (id, operation_id, name, geometry, search_method, priority, spacing_m, poa, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const created = [];
    const tx = db.transaction(() => {
      for (const z of zoneList) {
        const id = uuid();
        stmt.run(id, operationId, z.name, JSON.stringify(z.geometry), z.search_method || 'sector',
          z.priority || 3, z.spacing_m || null, z.poa || 0, z.notes || null, ts, ts);
        created.push(id);
      }
      db.prepare('UPDATE search_operations SET updated_at = ? WHERE id = ?').run(ts, operationId);
    });
    tx();
    audit.log(operationId, 'operator', 'zones_batch_created', { count: created.length });
    return this.listByOperation(operationId);
  },

  update(id, fields) {
    const z = this.get(id);
    if (!z) return null;
    const allowed = ['name', 'geometry', 'search_method', 'status', 'priority', 'assigned_team_id', 'pod', 'cumulative_pod', 'spacing_m', 'notes', 'poa', 'sweep_count'];
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.includes(k)) continue;
      if (k === 'geometry') {
        sets.push(`${k} = ?`);
        vals.push(JSON.stringify(v));
      } else {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (fields.status === 'complete' && !z.completed_at) {
      sets.push('completed_at = ?');
      vals.push(now());
    }
    // Auto-deploy team when assigned to a zone
    if (fields.assigned_team_id && fields.assigned_team_id !== z.assigned_team_id) {
      const team = teams.get(fields.assigned_team_id);
      if (team && team.status === 'standby') {
        db.prepare('UPDATE search_teams SET status = ? WHERE id = ?').run('deployed', team.id);
        audit.log(z.operation_id, 'operator', 'team_auto_deployed', { team_id: team.id, zone_id: id });
      }
    }
    // Bayesian cumulative POD update
    if (fields.pod !== undefined && fields.pod > 0) {
      const newCumPOD = 1 - (1 - (z.cumulative_pod || 0)) * (1 - fields.pod);
      sets.push('cumulative_pod = ?');
      vals.push(Math.round(newCumPOD * 1000) / 1000);
      sets.push('sweep_count = ?');
      vals.push((z.sweep_count || 0) + 1);
    }
    if (!sets.length) return z;
    sets.push('updated_at = ?');
    vals.push(now());
    vals.push(id);
    db.prepare(`UPDATE search_zones SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    audit.log(z.operation_id, 'operator', 'zone_updated', { zone_id: id, ...fields });
    db.prepare('UPDATE search_operations SET updated_at = ? WHERE id = ?').run(now(), z.operation_id);
    return this.get(id);
  },

  delete(id) {
    const z = this.get(id);
    if (!z) return false;
    db.prepare('DELETE FROM search_zones WHERE id = ?').run(id);
    audit.log(z.operation_id, 'operator', 'zone_deleted', { zone_id: id, name: z.name });
    db.prepare('UPDATE search_operations SET updated_at = ? WHERE id = ?').run(now(), z.operation_id);
    return true;
  },
};

// ── Teams ──
function hydrateTeam(t) {
  if (!t) return t;
  t.members = parseJSON(t.members) || [];
  t.street_checklist = parseJSON(t.street_checklist) || null;
  t.vehicle_route_geometry = parseJSON(t.vehicle_route_geometry) || null;
  t.vehicle_route_meta = parseJSON(t.vehicle_route_meta) || null;
  return t;
}

const teams = {
  listByOperation(operationId) {
    return db.prepare('SELECT * FROM search_teams WHERE operation_id = ? ORDER BY name ASC')
      .all(operationId)
      .map(hydrateTeam);
  },

  get(id) {
    return hydrateTeam(db.prepare('SELECT * FROM search_teams WHERE id = ?').get(id));
  },

  getByToken(token) {
    return hydrateTeam(db.prepare('SELECT * FROM search_teams WHERE token = ?').get(token));
  },

  create(operationId, { name, callsign, color, members, capability }) {
    const id = uuid();
    const token = generateToken();
    db.prepare(`
      INSERT INTO search_teams (id, operation_id, name, callsign, token, color, members, capability, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, operationId, name, callsign || name, token, color || '#00d4ff',
      members ? JSON.stringify(members) : '[]', capability || 'foot', now());
    audit.log(operationId, 'operator', 'team_created', { team_id: id, name, callsign: callsign || name });
    db.prepare('UPDATE search_operations SET updated_at = ? WHERE id = ?').run(now(), operationId);
    return this.get(id);
  },

  update(id, fields) {
    const t = this.get(id);
    if (!t) return null;
    const allowed = ['name', 'callsign', 'color', 'members', 'capability', 'status'];
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.includes(k)) continue;
      if (k === 'members') {
        sets.push(`${k} = ?`);
        vals.push(JSON.stringify(v));
      } else {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    // Track deployment clock for fatigue alarm. Set when flipping TO deployed
    // (if not already set), clear when leaving deployed/returning. Untouched
    // if status isn't in the update — avoids resetting on unrelated edits.
    if (Object.prototype.hasOwnProperty.call(fields, 'status')) {
      const nextStatus = fields.status;
      const wasActive = t.status === 'deployed' || t.status === 'returning';
      const willBeActive = nextStatus === 'deployed' || nextStatus === 'returning';
      if (willBeActive && !wasActive) {
        sets.push('deployed_at = ?');
        vals.push(now());
      } else if (!willBeActive && wasActive) {
        sets.push('deployed_at = ?');
        vals.push(null);
      }
    }
    if (!sets.length) return t;
    vals.push(id);
    db.prepare(`UPDATE search_teams SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    audit.log(t.operation_id, 'operator', 'team_updated', { team_id: id, ...fields });
    return this.get(id);
  },

  updatePosition(id, lat, lon) {
    db.prepare('UPDATE search_teams SET last_lat = ?, last_lon = ?, last_position_at = ? WHERE id = ?')
      .run(lat, lon, now(), id);
  },

  // Persist the street checklist + (optional) driving route for a team when
  // it gets assigned to a zone. Pass null for streets to clear an assignment.
  setAssignment(id, { zoneId, streets, routeGeometry, routeMeta }) {
    db.prepare(`
      UPDATE search_teams
      SET assigned_zone_id = ?, street_checklist = ?, vehicle_route_geometry = ?, vehicle_route_meta = ?
      WHERE id = ?
    `).run(
      zoneId || null,
      streets ? JSON.stringify(streets) : null,
      routeGeometry ? JSON.stringify(routeGeometry) : null,
      routeMeta ? JSON.stringify(routeMeta) : null,
      id,
    );
    return this.get(id);
  },

  // Mark a single street on the checklist as cleared (or re-open it).
  setStreetCleared(id, streetName, cleared, clearedBy) {
    const t = this.get(id);
    if (!t || !t.street_checklist) return null;
    let found = false;
    const updated = t.street_checklist.map((s) => {
      if (s.name !== streetName) return s;
      found = true;
      return cleared
        ? { ...s, cleared_at: now(), cleared_by: clearedBy || 'field' }
        : { ...s, cleared_at: null, cleared_by: null };
    });
    if (!found) return t;
    db.prepare('UPDATE search_teams SET street_checklist = ? WHERE id = ?')
      .run(JSON.stringify(updated), id);
    return this.get(id);
  },
};

// ── Reports ──
const reports = {
  listByOperation(operationId, limit = 100) {
    return db.prepare(`
      SELECT r.*, t.name as team_name, t.callsign as team_callsign
      FROM search_reports r
      LEFT JOIN search_teams t ON r.team_id = t.id
      WHERE r.operation_id = ?
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(operationId, limit);
  },

  // created_at can be overridden by the caller when a report is being drained
  // from the field offline queue — we keep the real time-of-action in the audit
  // trail instead of the server-drain time. Clamp to a sane window to reject
  // obvious clock skew / spoofed backdates.
  create(operationId, { zone_id, team_id, type, lat, lon, grid_ref, description, photo_url, severity, created_at }) {
    const id = uuid();
    const nowTs = now();
    let ts = nowTs;
    if (created_at) {
      const t = new Date(created_at).getTime();
      // Accept up to 7 days backwards (offline stint) and 60s forward (clock drift).
      if (!Number.isNaN(t) && t >= Date.now() - 7 * 86400_000 && t <= Date.now() + 60_000) {
        ts = new Date(t).toISOString();
      }
    }
    db.prepare(`
      INSERT INTO search_reports (id, operation_id, zone_id, team_id, type, lat, lon, grid_ref, description, photo_url, severity, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, operationId, zone_id || null, team_id || null, type, lat || null, lon || null,
      grid_ref || null, description || null, photo_url || null, severity || 'info', ts);
    audit.log(operationId, team_id || 'operator', 'report_submitted', { report_id: id, type, severity, queued: ts !== nowTs });
    db.prepare('UPDATE search_operations SET updated_at = ? WHERE id = ?').run(nowTs, operationId);
    return db.prepare('SELECT * FROM search_reports WHERE id = ?').get(id);
  },

  acknowledge(id, by) {
    db.prepare('UPDATE search_reports SET acknowledged = 1, acknowledged_by = ? WHERE id = ?').run(by || 'operator', id);
    const r = db.prepare('SELECT * FROM search_reports WHERE id = ?').get(id);
    if (r) audit.log(r.operation_id, by || 'operator', 'report_acknowledged', { report_id: id });
    return r;
  },
};

// ── Comms ──
const comms = {
  list(operationId, limit = 200) {
    return db.prepare('SELECT * FROM search_comms_log WHERE operation_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(operationId, limit);
  },

  add(operationId, { from_callsign, to_callsign, message, type, source_channel }) {
    db.prepare(`
      INSERT INTO search_comms_log (operation_id, from_callsign, to_callsign, message, type, source_channel, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(operationId, from_callsign || null, to_callsign || null, message, type || 'radio', source_channel || null, now());
    return this.list(operationId, 1)[0];
  },
};

// ── Datums (named reference points: LKP / PLP / sightings / witness locations) ──
const datums = {
  listByOperation(operationId) {
    return db.prepare('SELECT * FROM search_datums WHERE operation_id = ? ORDER BY created_at ASC')
      .all(operationId);
  },

  get(id) {
    return db.prepare('SELECT * FROM search_datums WHERE id = ?').get(id) || null;
  },

  create(operationId, { label, kind, lat, lon, notes }) {
    const id = uuid();
    const ts = now();
    db.prepare(`
      INSERT INTO search_datums (id, operation_id, label, kind, lat, lon, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, operationId, label || 'Datum', kind || 'other', lat, lon, notes || null, ts);
    audit.log(operationId, 'operator', 'datum_created', { id, label, kind, lat, lon });
    db.prepare('UPDATE search_operations SET updated_at = ? WHERE id = ?').run(ts, operationId);
    return this.get(id);
  },

  update(id, fields) {
    const d = this.get(id);
    if (!d) return null;
    const allowed = ['label', 'kind', 'lat', 'lon', 'notes'];
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.includes(k)) continue;
      sets.push(`${k} = ?`);
      vals.push(v);
    }
    if (!sets.length) return d;
    vals.push(id);
    db.prepare(`UPDATE search_datums SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    audit.log(d.operation_id, 'operator', 'datum_updated', { id, ...fields });
    db.prepare('UPDATE search_operations SET updated_at = ? WHERE id = ?').run(now(), d.operation_id);
    return this.get(id);
  },

  delete(id) {
    const d = this.get(id);
    if (!d) return false;
    db.prepare('DELETE FROM search_datums WHERE id = ?').run(id);
    audit.log(d.operation_id, 'operator', 'datum_deleted', { id, label: d.label });
    db.prepare('UPDATE search_operations SET updated_at = ? WHERE id = ?').run(now(), d.operation_id);
    return true;
  },
};

// ── Audit ──
const audit = {
  log(operationId, actor, action, detail) {
    db.prepare(`
      INSERT INTO search_audit_log (operation_id, actor, action, detail, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(operationId, actor, action, detail ? JSON.stringify(detail) : null, now());
  },

  list(operationId, limit = 200) {
    return db.prepare('SELECT * FROM search_audit_log WHERE operation_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(operationId, limit)
      .map(r => ({ ...r, detail: parseJSON(r.detail) }));
  },
};

// ── SITREP generator ──
function generateSitrep(operationId) {
  const op = operations.get(operationId);
  if (!op) return null;

  const totalZones = op.zones.length;
  const complete = op.zones.filter(z => z.status === 'complete').length;
  const inProgress = op.zones.filter(z => z.status === 'in_progress').length;
  const unassigned = op.zones.filter(z => z.status === 'unassigned').length;
  const avgPOD = totalZones > 0 ? op.zones.reduce((s, z) => s + (z.cumulative_pod || 0), 0) / totalZones : 0;
  const deployedTeams = op.teams.filter(t => t.status === 'deployed').length;
  const recentReports = reports.listByOperation(operationId, 20);
  const urgentReports = recentReports.filter(r => r.severity === 'urgent' || r.severity === 'critical');
  const clueReports = recentReports.filter(r => r.type === 'clue');

  const lines = [
    `SITREP — ${op.name}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `OPERATION: ${op.name} (${op.type.replace(/_/g, ' ')})`,
    `STATUS: ${op.status.toUpperCase()}`,
    op.subject_info ? `SUBJECT: ${op.subject_info.name || 'Unknown'}${op.subject_info.age ? `, age ${op.subject_info.age}` : ''}` : null,
    op.datum_lat ? `DATUM: ${op.datum_lat.toFixed(5)}, ${op.datum_lon.toFixed(5)}` : null,
    ``,
    `COVERAGE:`,
    `  Zones: ${totalZones} total — ${complete} complete, ${inProgress} in progress, ${unassigned} unassigned`,
    `  Average cumulative POD: ${(avgPOD * 100).toFixed(1)}%`,
    `  Teams deployed: ${deployedTeams} of ${op.teams.length}`,
    ``,
    `REPORTS (last 20):`,
    `  Clues: ${clueReports.length}`,
    `  Urgent/Critical: ${urgentReports.length}`,
    `  Total: ${recentReports.length}`,
  ].filter(Boolean);

  if (clueReports.length > 0) {
    lines.push('', 'CLUE DETAIL:');
    for (const c of clueReports) {
      lines.push(`  [${c.created_at}] ${c.team_name || 'Unknown'}: ${c.description || 'No description'}${c.grid_ref ? ` (${c.grid_ref})` : ''}`);
    }
  }

  if (urgentReports.length > 0) {
    lines.push('', 'URGENT REPORTS:');
    for (const r of urgentReports) {
      lines.push(`  [${r.created_at}] ${r.team_name || 'Unknown'} — ${r.type}: ${r.description || 'No description'}`);
    }
  }

  return {
    text: lines.join('\n'),
    operation: op.name,
    status: op.status,
    summary: {
      total_zones: totalZones,
      complete,
      in_progress: inProgress,
      unassigned,
      avg_pod: Math.round(avgPOD * 1000) / 1000,
      deployed_teams: deployedTeams,
      total_teams: op.teams.length,
      clue_count: clueReports.length,
      urgent_count: urgentReports.length,
    },
    generated_at: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════
// SHARE TOKENS (read-only briefing links)
// ════════════════════════════════════════════════

const shareTokens = {
  create(operationId, { createdBy = null, ttlHours = null } = {}) {
    const token = generateToken();
    const expires = ttlHours ? new Date(Date.now() + ttlHours * 3600 * 1000).toISOString() : null;
    db.prepare(`
      INSERT INTO search_share_tokens (token, operation_id, created_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, operationId, createdBy, now(), expires);
    return { token, operation_id: operationId, expires_at: expires };
  },
  getByToken(token) {
    const row = db.prepare(`SELECT * FROM search_share_tokens WHERE token = ? AND revoked = 0`).get(token);
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    return row;
  },
  listByOperation(operationId) {
    return db.prepare(`SELECT token, created_by, created_at, expires_at, revoked FROM search_share_tokens WHERE operation_id = ? ORDER BY created_at DESC`).all(operationId);
  },
  revoke(token) {
    db.prepare(`UPDATE search_share_tokens SET revoked = 1 WHERE token = ?`).run(token);
  },
};

module.exports = { operations, zones, teams, reports, comms, datums, audit, shareTokens, generateSitrep };
