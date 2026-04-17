// Platform-admin endpoints — cross-tenant visibility for the operator running
// this search-surface instance. Gated by requirePlatformAdmin: the caller must
// be a signed-in tenant_user whose email appeared in PLATFORM_ADMIN_EMAILS when
// the server last synced.
//
//   GET  /api/admin/overview         — headline counters + signup sparkline
//   GET  /api/admin/tenants          — every tenant + user/op/session counts
//   GET  /api/admin/tenants/:id      — detail incl. user list
//   PATCH /api/admin/tenants/:id     — { name?, plan? }
//   DELETE /api/admin/tenants/:id    — cascade wipe
//   GET  /api/admin/users            — every user across all tenants
//   PATCH /api/admin/users/:id       — { role?, is_platform_admin? }
//   GET  /api/admin/sessions         — active sessions (capped)
//   DELETE /api/admin/sessions/:tok  — revoke
//   GET  /api/admin/activity         — recent signups + logins feed

const express = require('express');
const { db } = require('./db');
const { tenants, users, sessions } = require('./auth-db');
const { operations } = require('./search-db');
const { attachTenant, requirePlatformAdmin } = require('./tenant-middleware');

const router = express.Router();
router.use(attachTenant);
router.use(requirePlatformAdmin);

// ── Overview ──
router.get('/overview', (req, res) => {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86400000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

  const tenantCount = db.prepare('SELECT COUNT(*) as n FROM tenants').get().n;
  const userCount = db.prepare('SELECT COUNT(*) as n FROM tenant_users').get().n;
  const activeSessions = db.prepare('SELECT COUNT(*) as n FROM tenant_sessions WHERE expires_at > ?').get(now.toISOString()).n;
  const opsCount = db.prepare('SELECT COUNT(*) as n FROM search_operations').get().n;

  const signups24h = db.prepare('SELECT COUNT(*) as n FROM tenant_users WHERE created_at >= ?').get(dayAgo).n;
  const signups7d = db.prepare('SELECT COUNT(*) as n FROM tenant_users WHERE created_at >= ?').get(weekAgo).n;
  const signups30d = db.prepare('SELECT COUNT(*) as n FROM tenant_users WHERE created_at >= ?').get(monthAgo).n;

  const tenants24h = db.prepare('SELECT COUNT(*) as n FROM tenants WHERE created_at >= ?').get(dayAgo).n;
  const tenants7d = db.prepare('SELECT COUNT(*) as n FROM tenants WHERE created_at >= ?').get(weekAgo).n;
  const tenants30d = db.prepare('SELECT COUNT(*) as n FROM tenants WHERE created_at >= ?').get(monthAgo).n;

  // 30-day sparkline: [{ day: 'YYYY-MM-DD', users: n, tenants: n }]
  const sparkline = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const nextIso = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
    const u = db.prepare("SELECT COUNT(*) as n FROM tenant_users WHERE substr(created_at, 1, 10) = ?").get(iso).n;
    const t = db.prepare("SELECT COUNT(*) as n FROM tenants WHERE substr(created_at, 1, 10) = ?").get(iso).n;
    sparkline.push({ day: iso, users: u, tenants: t });
    if (nextIso !== nextIso) { /* noop */ }
  }

  const dau24h = db.prepare('SELECT COUNT(DISTINCT user_id) as n FROM tenant_sessions WHERE last_seen_at >= ?').get(dayAgo).n;

  res.json({
    totals: { tenants: tenantCount, users: userCount, sessions_active: activeSessions, operations: opsCount },
    signups: { d1: signups24h, d7: signups7d, d30: signups30d },
    tenants_new: { d1: tenants24h, d7: tenants7d, d30: tenants30d },
    dau_24h: dau24h,
    sparkline,
  });
});

// ── Tenants ──
router.get('/tenants', (req, res) => {
  const rows = db.prepare(`
    SELECT
      t.id, t.slug, t.name, t.plan, t.created_at,
      (SELECT COUNT(*) FROM tenant_users u WHERE u.tenant_id = t.id) AS user_count,
      (SELECT COUNT(*) FROM search_operations o WHERE o.tenant_id = t.id) AS op_count,
      (SELECT COUNT(*) FROM tenant_sessions s WHERE s.tenant_id = t.id AND s.expires_at > datetime('now')) AS active_sessions,
      (SELECT MAX(last_seen_at) FROM tenant_sessions s WHERE s.tenant_id = t.id) AS last_activity_at,
      (SELECT MAX(last_login_at) FROM tenant_users u WHERE u.tenant_id = t.id) AS last_login_at
    FROM tenants t
    ORDER BY t.created_at DESC
  `).all();
  res.json({ tenants: rows });
});

router.get('/tenants/:id', (req, res) => {
  const tenant = tenants.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const tenantUsers = users.listByTenant(tenant.id);
  // operations.list() hydrates zones/teams/datums per op — drop them for the
  // admin summary to keep the response tight.
  const ops = operations.list(null, tenant.id).map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type,
    status: o.status,
    created_at: o.created_at,
    updated_at: o.updated_at,
    created_by: o.created_by,
    zone_count: o.zone_count || 0,
    team_count: o.team_count || 0,
    report_count: o.report_count || 0,
  }));
  const activeSessions = db.prepare("SELECT COUNT(*) as n FROM tenant_sessions WHERE tenant_id = ? AND expires_at > datetime('now')").get(tenant.id).n;
  res.json({ tenant, users: tenantUsers, operations: ops, operations_count: ops.length, active_sessions: activeSessions });
});

router.patch('/tenants/:id', (req, res) => {
  const tenant = tenants.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const { name, plan } = req.body || {};
  if (name) db.prepare('UPDATE tenants SET name = ? WHERE id = ?').run(String(name), tenant.id);
  if (plan) db.prepare('UPDATE tenants SET plan = ? WHERE id = ?').run(String(plan), tenant.id);
  res.json({ tenant: tenants.get(tenant.id) });
});

router.delete('/tenants/:id', (req, res) => {
  const tenant = tenants.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  db.prepare('DELETE FROM tenants WHERE id = ?').run(tenant.id);
  res.json({ ok: true });
});

// ── Users ──
router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT u.id, u.email, u.display_name, u.role, u.is_platform_admin, u.created_at, u.last_login_at,
             t.id as tenant_id, t.slug as tenant_slug, t.name as tenant_name, t.plan as tenant_plan
      FROM tenant_users u JOIN tenants t ON t.id = u.tenant_id
      WHERE lower(u.email) LIKE ? OR lower(COALESCE(u.display_name,'')) LIKE ? OR lower(t.name) LIKE ? OR lower(t.slug) LIKE ?
      ORDER BY u.created_at DESC
      LIMIT 500
    `).all(like, like, like, like);
  } else {
    rows = db.prepare(`
      SELECT u.id, u.email, u.display_name, u.role, u.is_platform_admin, u.created_at, u.last_login_at,
             t.id as tenant_id, t.slug as tenant_slug, t.name as tenant_name, t.plan as tenant_plan
      FROM tenant_users u JOIN tenants t ON t.id = u.tenant_id
      ORDER BY u.created_at DESC
      LIMIT 500
    `).all();
  }
  res.json({ users: rows });
});

router.patch('/users/:id', (req, res) => {
  const user = users.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { role, is_platform_admin } = req.body || {};
  if (role) {
    try { users.setRole(user.id, role); } catch (err) { return res.status(400).json({ error: err.message }); }
  }
  if (typeof is_platform_admin === 'boolean') users.setPlatformAdmin(user.id, is_platform_admin);
  res.json({ user: users.get(user.id) });
});

// ── Sessions ──
router.get('/sessions', (req, res) => {
  const rows = db.prepare(`
    SELECT s.token, s.user_id, s.tenant_id, s.created_at, s.expires_at, s.last_seen_at,
           u.email, u.display_name, u.role, t.slug as tenant_slug, t.name as tenant_name
    FROM tenant_sessions s
    JOIN tenant_users u ON u.id = s.user_id
    JOIN tenants t ON t.id = s.tenant_id
    WHERE s.expires_at > datetime('now')
    ORDER BY s.last_seen_at DESC
    LIMIT 200
  `).all();
  // Truncate tokens; never leak the full value.
  const out = rows.map((r) => ({ ...r, token_preview: `${r.token.slice(0, 8)}…`, token: undefined }));
  res.json({ sessions: out });
});

router.delete('/sessions/:tok', (req, res) => {
  sessions.revoke(req.params.tok);
  res.json({ ok: true });
});

// ── Activity feed (recent signups + logins combined, most recent 100) ──
router.get('/activity', (req, res) => {
  const signups = db.prepare(`
    SELECT 'signup' as kind, u.created_at as at, u.email, u.role, t.slug as tenant_slug, t.name as tenant_name
    FROM tenant_users u JOIN tenants t ON t.id = u.tenant_id
    ORDER BY u.created_at DESC LIMIT 100
  `).all();
  const logins = db.prepare(`
    SELECT 'login' as kind, u.last_login_at as at, u.email, u.role, t.slug as tenant_slug, t.name as tenant_name
    FROM tenant_users u JOIN tenants t ON t.id = u.tenant_id
    WHERE u.last_login_at IS NOT NULL
    ORDER BY u.last_login_at DESC LIMIT 100
  `).all();
  const merged = [...signups, ...logins]
    .filter((e) => e.at)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 100);
  res.json({ events: merged });
});

module.exports = router;
