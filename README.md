# search-surface

Standalone Search Ops (SAR) command surface, extracted from `prism-surface`.
Hosted at **search.wispayr.online**.

- `web/` — Next.js 15 + Tailwind v4 + Zustand (port **4077**)
- `server/` — Express 5 + better-sqlite3 (port **4078**)

## Layout

```
search.wispayr.online
 ├─ /          →  Next.js       (pu2:4077)
 └─ /api/*     →  Express       (pu2:4078)
                   ├─ /api/search/*  → local SQLite (search.db)
                   ├─ /api/siphon/*  → SIPHON_URL proxy
                   └─ /api/prism/*   → PRISM_URL  proxy
```

## Local dev

```bash
# Terminal 1 — backend
cd server
cp .env.example .env
npm install
npm run dev          # :4078

# Terminal 2 — frontend
cd web
npm install
npm run dev          # :4077
```

Visit <http://localhost:4077>.

## DB seeding (one-time migration from prism-surface)

```bash
# On the host that has surface.db:
sqlite3 /path/to/surface.db ".dump search_%" | sqlite3 ./server/search.db
```

This copies the seven `search_*` tables (operations, zones, teams, reports,
comms_log, audit_log, datums) along with any field-team tokens.

## pu2 deployment

```bash
ssh pu2
cd /Users/noc/operations
git clone git@github.com:WispAyr/search-surface.git
cd search-surface/server && npm ci
cd ../web && npm ci && npm run build
# Seed DB (one-time)
sqlite3 /Users/noc/operations/prism-surface/server/surface.db ".dump search_%" \
  | sqlite3 /Users/noc/operations/search-surface/server/search.db
# Start
pm2 start ecosystem.config.cjs && pm2 save
```

## Nginx (on small-server)

Vhost for `search.wispayr.online` proxies:
- `/`      →  `pu2:4077`
- `/api/`  →  `pu2:4078`  (bypass Next.js; proxy direct to Express)

`/api/` must **not** route through Next.js — we learned that the hard way on
2026-04-15 when a blanket Next rewrite crashed live.wispayr.online.
