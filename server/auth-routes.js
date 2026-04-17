// Auth endpoints for search-surface.
//
//   POST /api/auth/signup   — new tenant + owner user (tenant self-serve signup)
//   POST /api/auth/login    — email + password → session cookie
//   POST /api/auth/logout   — revoke current session
//   GET  /api/auth/me       — current session context
//   POST /api/auth/password — change current user's password
//   GET  /api/auth/users    — list users in current tenant (owner only)
//   POST /api/auth/users    — invite a user to current tenant (owner only)
//   PATCH /api/auth/users/:id — change role (owner only)
//   DELETE /api/auth/users/:id — remove user (owner only)
//
// The default behavior is signups are ALLOWED (to self-onboard). Set
// DISABLE_SIGNUP=1 in env to lock signups and force owners to invite.

const express = require('express');
const { tenants, users, sessions, settings, verifyPassword, syncPlatformAdmins } = require('./auth-db');
const { attachTenant, requireTenant, requireRole, COOKIE_NAME } = require('./tenant-middleware');

const router = express.Router();
router.use(attachTenant);

const DISABLE_SIGNUP = process.env.DISABLE_SIGNUP === '1';
const SESSION_DAYS = 30;

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function uniqueSlug(base) {
  let slug = base || 'team';
  let n = 0;
  while (tenants.getBySlug(slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

function setSessionCookie(res, token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function sanitizeUser(user, tenant) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    is_platform_admin: !!user.is_platform_admin,
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, plan: tenant.plan },
  };
}

// ── Signup: creates a new tenant with the caller as owner. ──
router.post('/signup', (req, res) => {
  if (DISABLE_SIGNUP) return res.status(403).json({ error: 'Signup is disabled on this instance' });
  const { email, password, display_name, tenant_name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!tenant_name) return res.status(400).json({ error: 'tenant_name required' });

  const slug = uniqueSlug(slugify(tenant_name));
  let tenant;
  let user;
  try {
    tenant = tenants.create({ slug, name: tenant_name });
    user = users.create({
      tenantId: tenant.id,
      email,
      password,
      displayName: display_name,
      role: 'owner',
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Re-run platform-admin sync so allowlisted emails are promoted at signup
  // time, not just on restart. No-op for non-matching emails.
  try { syncPlatformAdmins(); } catch { /* best-effort */ }

  const session = sessions.create(user.id, tenant.id);
  users.recordLogin(user.id);
  setSessionCookie(res, session.token, session.expires_at);
  const refreshed = users.get(user.id) || user;
  res.status(201).json({
    ok: true,
    user: sanitizeUser(refreshed, tenant),
    session: { expires_at: session.expires_at, days: SESSION_DAYS },
  });
});

// ── Login: finds matching tenant_user by email. If the same email exists in
// multiple tenants, the caller can pass `tenant_slug` to disambiguate; else
// we return a 409 with the list of tenants to choose from. ──
router.post('/login', (req, res) => {
  const { email, password, tenant_slug } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const matches = users.findByEmail(email);
  if (matches.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

  let candidates = matches;
  if (tenant_slug) {
    const tenant = tenants.getBySlug(tenant_slug);
    if (!tenant) return res.status(401).json({ error: 'Invalid email or password' });
    candidates = matches.filter((u) => u.tenant_id === tenant.id);
  }

  // Try each candidate (same email in different tenants may have different passwords)
  for (const row of candidates) {
    if (verifyPassword(password, row.password_hash, row.password_salt)) {
      const tenant = tenants.get(row.tenant_id);
      const session = sessions.create(row.id, tenant.id);
      users.recordLogin(row.id);
      setSessionCookie(res, session.token, session.expires_at);
      return res.json({
        ok: true,
        user: sanitizeUser(row, tenant),
        session: { expires_at: session.expires_at, days: SESSION_DAYS },
      });
    }
  }

  // If password failed but there are multiple tenants with this email, give
  // the client a way to retry with a tenant_slug. Leak nothing useful.
  if (candidates.length > 1) {
    return res.status(409).json({
      error: 'Multiple tenants use this email. Pass tenant_slug to disambiguate.',
      tenants: candidates.map((u) => {
        const t = tenants.get(u.tenant_id);
        return { slug: t.slug, name: t.name };
      }),
    });
  }
  return res.status(401).json({ error: 'Invalid email or password' });
});

router.post('/logout', (req, res) => {
  if (req.tenant?.session_token) sessions.revoke(req.tenant.session_token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.tenant) return res.json({ user: null });
  res.json({
    user: {
      id: req.tenant.user_id,
      email: req.tenant.email,
      display_name: req.tenant.display_name,
      role: req.tenant.role,
      is_platform_admin: !!req.tenant.is_platform_admin,
      tenant: {
        id: req.tenant.id,
        slug: req.tenant.slug,
        name: req.tenant.name,
        plan: req.tenant.plan,
      },
    },
  });
});

router.post('/password', requireTenant, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password required' });
  if (String(new_password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const row = users.getWithHash(req.tenant.user_id);
  if (!row || !verifyPassword(current_password, row.password_hash, row.password_salt)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  users.changePassword(req.tenant.user_id, new_password);
  sessions.revokeAllForUser(req.tenant.user_id);
  // Re-issue a new session so the user stays logged in on this device.
  const session = sessions.create(req.tenant.user_id, req.tenant.id);
  setSessionCookie(res, session.token, session.expires_at);
  res.json({ ok: true });
});

// ── Team management (owner only) ──

router.get('/users', requireTenant, (req, res) => {
  res.json({ users: users.listByTenant(req.tenant.id) });
});

router.post('/users', requireTenant, requireRole('owner'), (req, res) => {
  const { email, password, display_name, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const u = users.create({
      tenantId: req.tenant.id,
      email,
      password,
      displayName: display_name,
      role: role || 'operator',
    });
    res.status(201).json({ user: u });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/users/:id', requireTenant, requireRole('owner'), (req, res) => {
  const target = users.get(req.params.id);
  if (!target || target.tenant_id !== req.tenant.id) return res.status(404).json({ error: 'User not found' });
  try {
    if (req.body?.role) users.setRole(req.params.id, req.body.role);
    res.json({ user: users.get(req.params.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/users/:id', requireTenant, requireRole('owner'), (req, res) => {
  const target = users.get(req.params.id);
  if (!target || target.tenant_id !== req.tenant.id) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.tenant.user_id) return res.status(400).json({ error: 'Cannot remove yourself' });
  users.remove(req.params.id);
  sessions.revokeAllForUser(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
