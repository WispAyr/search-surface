// Resolves the authenticated tenant/user from a session cookie and attaches
// req.tenant = { id, name, slug, user_id, email, role }.
//
// Three middleware levels:
//   attachTenant   — best-effort; sets req.tenant if a valid session exists. Does not reject.
//   requireTenant  — rejects 401 if no valid tenant.
//   requireRole    — factory, rejects 403 if role insufficient.

const { sessions, users, tenants } = require('./auth-db');

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'search_session';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function readSessionToken(req) {
  // Priority: X-Search-Session header (API clients) > cookie
  const hdr = req.headers['x-search-session'];
  if (hdr) return String(hdr);
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}

function resolveTenant(req) {
  const tok = readSessionToken(req);
  if (!tok) return null;
  const session = sessions.resolve(tok);
  if (!session) return null;
  const user = users.get(session.user_id);
  if (!user) return null;
  const tenant = tenants.get(session.tenant_id);
  if (!tenant) return null;
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    plan: tenant.plan,
    user_id: user.id,
    email: user.email,
    role: user.role,
    display_name: user.display_name,
    session_token: tok,
  };
}

function attachTenant(req, res, next) {
  req.tenant = resolveTenant(req);
  next();
}

function requireTenant(req, res, next) {
  if (!req.tenant) {
    if (!req.tenant) req.tenant = resolveTenant(req);
  }
  if (!req.tenant) return res.status(401).json({ error: 'Login required', auth_required: true });
  next();
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.tenant) return res.status(401).json({ error: 'Login required', auth_required: true });
    if (!allowed.includes(req.tenant.role)) {
      return res.status(403).json({ error: `Requires role: ${allowed.join(', ')}` });
    }
    next();
  };
}

module.exports = { attachTenant, requireTenant, requireRole, COOKIE_NAME };
