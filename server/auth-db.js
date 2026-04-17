// Multi-tenant auth for search-surface.
//
// Three concepts:
//   - tenant: an org/customer with its own operations, settings, and users
//   - tenant_user: a person inside a tenant (role: owner|operator|viewer)
//   - tenant_session: a cookie-backed session row (rotating session token)
//
// Password hashing uses node's built-in scrypt — no native compile deps.
// Session tokens are random 32-byte hex; the cookie carries the token directly.

const { db } = require('./db');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    plan TEXT DEFAULT 'free',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tenant_users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('owner','operator','viewer')),
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    UNIQUE(tenant_id, email)
  );
  CREATE INDEX IF NOT EXISTS idx_tu_email ON tenant_users(email);

  CREATE TABLE IF NOT EXISTS tenant_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ts_user ON tenant_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_ts_expires ON tenant_sessions(expires_at);

  -- Free-form per-tenant settings. Values that contain secrets are encrypted
  -- at rest with AUTH_SECRET (AES-256-GCM) and stored base64-encoded.
  CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT,
    encrypted INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, key)
  );
`);

// Backfill column on search_operations so existing rows attach to a default
// tenant. First-boot-with-rows path creates the default tenant and associates
// orphan operations with it. New installs get the column and nothing else.
try {
  db.exec(`ALTER TABLE search_operations ADD COLUMN tenant_id TEXT`);
} catch { /* already present */ }

function nowIso() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function token(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

// ── Tenants ──
const tenants = {
  create({ slug, name, plan = 'free' }) {
    const id = uuid();
    db.prepare(`
      INSERT INTO tenants (id, slug, name, plan, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, slug, name, plan, nowIso());
    return this.get(id);
  },
  get(id) {
    return db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) || null;
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug) || null;
  },
  ensureDefault() {
    // Used when pre-tenancy search_operations rows exist. Attaches them to a
    // single "Default" tenant so data isn't orphaned when tenancy turns on.
    const existing = this.getBySlug('default');
    if (existing) return existing;
    return this.create({ slug: 'default', name: 'Default', plan: 'legacy' });
  },
};

// Backfill: if there are operations without a tenant_id, attach them to the
// default tenant. Runs once per boot; no-op on clean installs.
const orphans = db.prepare('SELECT COUNT(*) as n FROM search_operations WHERE tenant_id IS NULL').get();
if (orphans && orphans.n > 0) {
  const def = tenants.ensureDefault();
  db.prepare('UPDATE search_operations SET tenant_id = ? WHERE tenant_id IS NULL').run(def.id);
}

// ── Users ──
const users = {
  create({ tenantId, email, password, displayName, role = 'operator' }) {
    const normEmail = String(email).trim().toLowerCase();
    if (!normEmail || !password) throw new Error('email and password required');
    if (!['owner', 'operator', 'viewer'].includes(role)) throw new Error('invalid role');
    const existing = db.prepare('SELECT id FROM tenant_users WHERE tenant_id = ? AND email = ?').get(tenantId, normEmail);
    if (existing) throw new Error('email already registered in this tenant');
    const id = uuid();
    const { hash, salt } = hashPassword(password);
    db.prepare(`
      INSERT INTO tenant_users (id, tenant_id, email, password_hash, password_salt, display_name, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, normEmail, hash, salt, displayName || null, role, nowIso());
    return this.get(id);
  },

  get(id) {
    const u = db.prepare('SELECT id, tenant_id, email, display_name, role, created_at, last_login_at FROM tenant_users WHERE id = ?').get(id);
    return u || null;
  },

  getWithHash(id) {
    return db.prepare('SELECT * FROM tenant_users WHERE id = ?').get(id) || null;
  },

  findByEmail(email) {
    const normEmail = String(email).trim().toLowerCase();
    return db.prepare('SELECT * FROM tenant_users WHERE email = ?').all(normEmail);
  },

  listByTenant(tenantId) {
    return db.prepare('SELECT id, email, display_name, role, created_at, last_login_at FROM tenant_users WHERE tenant_id = ? ORDER BY created_at ASC').all(tenantId);
  },

  setRole(userId, role) {
    if (!['owner', 'operator', 'viewer'].includes(role)) throw new Error('invalid role');
    db.prepare('UPDATE tenant_users SET role = ? WHERE id = ?').run(role, userId);
    return this.get(userId);
  },

  remove(userId) {
    db.prepare('DELETE FROM tenant_users WHERE id = ?').run(userId);
  },

  recordLogin(id) {
    db.prepare('UPDATE tenant_users SET last_login_at = ? WHERE id = ?').run(nowIso(), id);
  },

  changePassword(id, newPassword) {
    const { hash, salt } = hashPassword(newPassword);
    db.prepare('UPDATE tenant_users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, id);
  },
};

// ── Sessions ──
const SESSION_TTL_DAYS = 30;

const sessions = {
  create(userId, tenantId) {
    const tok = token();
    const ts = nowIso();
    const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString();
    db.prepare(`
      INSERT INTO tenant_sessions (token, user_id, tenant_id, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tok, userId, tenantId, ts, expires, ts);
    return { token: tok, expires_at: expires };
  },

  resolve(tok) {
    if (!tok) return null;
    const row = db.prepare('SELECT * FROM tenant_sessions WHERE token = ?').get(tok);
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      this.revoke(tok);
      return null;
    }
    // Touch last_seen_at at most once per 5 minutes to avoid hot writes.
    const lastSeen = new Date(row.last_seen_at).getTime();
    if (Date.now() - lastSeen > 5 * 60 * 1000) {
      db.prepare('UPDATE tenant_sessions SET last_seen_at = ? WHERE token = ?').run(nowIso(), tok);
    }
    return row;
  },

  revoke(tok) {
    db.prepare('DELETE FROM tenant_sessions WHERE token = ?').run(tok);
  },

  revokeAllForUser(userId) {
    db.prepare('DELETE FROM tenant_sessions WHERE user_id = ?').run(userId);
  },

  purgeExpired() {
    db.prepare('DELETE FROM tenant_sessions WHERE expires_at < ?').run(nowIso());
  },
};

// Purge expired sessions once per hour. Cheap on SQLite + indexed on expires_at.
setInterval(() => {
  try { sessions.purgeExpired(); } catch { /* best-effort */ }
}, 3600 * 1000).unref();

// ── Settings (with optional encryption) ──
// AUTH_SECRET protects at-rest secrets (Zello keys, etc). If the operator
// doesn't set one we generate a 48-byte random value and persist it to a
// sidecar file so it survives restarts. Losing the file invalidates any
// previously-encrypted settings but is otherwise harmless.
const AUTH_SECRET_FILE = path.join(__dirname, 'data', '.auth-secret');
let AUTH_SECRET = process.env.AUTH_SECRET || null;
if (!AUTH_SECRET) {
  try {
    AUTH_SECRET = fs.readFileSync(AUTH_SECRET_FILE, 'utf8').trim();
  } catch {
    AUTH_SECRET = crypto.randomBytes(48).toString('base64');
    try {
      fs.mkdirSync(path.dirname(AUTH_SECRET_FILE), { recursive: true });
      fs.writeFileSync(AUTH_SECRET_FILE, AUTH_SECRET, { mode: 0o600 });
      console.log(`[auth] generated AUTH_SECRET → ${AUTH_SECRET_FILE}`);
    } catch (err) {
      console.warn(`[auth] could not persist AUTH_SECRET (${err.message}); using in-memory key for this process only`);
    }
  }
}

function encrypt(plaintext) {
  if (!AUTH_SECRET) throw new Error('AUTH_SECRET env required to store secrets');
  const key = crypto.createHash('sha256').update(AUTH_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(encoded) {
  if (!AUTH_SECRET) throw new Error('AUTH_SECRET env required to read secrets');
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const key = crypto.createHash('sha256').update(AUTH_SECRET).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

const settings = {
  get(tenantId, key) {
    const row = db.prepare('SELECT value, encrypted FROM tenant_settings WHERE tenant_id = ? AND key = ?').get(tenantId, key);
    if (!row) return null;
    if (!row.value) return null;
    if (row.encrypted) {
      try { return decrypt(row.value); } catch { return null; }
    }
    return row.value;
  },

  getJson(tenantId, key) {
    const raw = this.get(tenantId, key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  set(tenantId, key, value, { encrypted = false } = {}) {
    const stored = value == null ? null : encrypted ? encrypt(String(value)) : String(value);
    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, key, value, encrypted, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted, updated_at = excluded.updated_at
    `).run(tenantId, key, stored, encrypted ? 1 : 0, nowIso());
  },

  setJson(tenantId, key, obj, opts) {
    this.set(tenantId, key, obj == null ? null : JSON.stringify(obj), opts);
  },

  delete(tenantId, key) {
    db.prepare('DELETE FROM tenant_settings WHERE tenant_id = ? AND key = ?').run(tenantId, key);
  },
};

// ── First-run bootstrap ──
// If the auth tables are empty, provision a default tenant + owner so the
// operator can sign straight in rather than hitting /signup. Credentials come
// from env (BOOTSTRAP_OWNER_EMAIL + BOOTSTRAP_OWNER_PASSWORD) when provided;
// otherwise a random password is generated and printed once to stdout — plus
// written to data/.bootstrap-owner.txt (mode 0600) so it's recoverable.
(function bootstrapFirstOwner() {
  try {
    const existing = db.prepare('SELECT COUNT(*) as n FROM tenant_users').get();
    if (existing && existing.n > 0) return;

    const email = (process.env.BOOTSTRAP_OWNER_EMAIL || 'owner@search.local').trim().toLowerCase();
    const providedPw = process.env.BOOTSTRAP_OWNER_PASSWORD || '';
    const password = providedPw || crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 16);
    const tenantName = process.env.BOOTSTRAP_TENANT_NAME || 'Search Ops';
    const tenantSlug = (process.env.BOOTSTRAP_TENANT_SLUG || 'default').trim().toLowerCase();

    const tenant = tenants.getBySlug(tenantSlug) || tenants.create({ slug: tenantSlug, name: tenantName });
    users.create({ tenantId: tenant.id, email, password, displayName: 'Owner', role: 'owner' });

    // Orphan operations get attached to the new tenant too.
    db.prepare('UPDATE search_operations SET tenant_id = ? WHERE tenant_id IS NULL').run(tenant.id);

    const banner = '═'.repeat(64);
    console.log(`\n${banner}\n[auth] bootstrap owner created — sign in at /login:\n  email:    ${email}\n  password: ${password}\n  tenant:   ${tenantName} (${tenantSlug})\n${providedPw ? '  (from BOOTSTRAP_OWNER_PASSWORD env)' : '  (auto-generated — change it after first login)'}\n${banner}\n`);

    if (!providedPw) {
      try {
        const credFile = path.join(__dirname, 'data', '.bootstrap-owner.txt');
        fs.mkdirSync(path.dirname(credFile), { recursive: true });
        fs.writeFileSync(credFile, `email: ${email}\npassword: ${password}\ntenant: ${tenantName} (${tenantSlug})\ngenerated_at: ${nowIso()}\n`, { mode: 0o600 });
        console.log(`[auth] credentials also written to ${credFile}`);
      } catch (err) {
        console.warn(`[auth] could not persist bootstrap credentials: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[auth] bootstrap skipped: ${err.message}`);
  }
})();

module.exports = { tenants, users, sessions, settings, verifyPassword, hashPassword, SESSION_TTL_DAYS };
