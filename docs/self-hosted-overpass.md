# Self-hosted Overpass — Scotland mirror

Written 2026-04-18 as a deferred plan. **Triggered and executing 2026-04-19**:
all three public mirrors (overpass-api.de, kumi.systems, private.coffee) were
returning 504 / timeout concurrently during a live IC session — the exact
failure mode the trigger criteria below anticipated.

## Execution log (2026-04-19)

- `osm-3s_v0.7.62.11` compiled native at `/srv/overpass/install` (BUILD_OK).
- Scotland extract (318 MB PBF) already in `/srv/overpass/scotland-latest.osm.pbf`.
- DB init uses `osmium cat … -o - -f osm | update_database --db-dir=/srv/overpass/db/
  --compression-method=gz --map-compression-method=gz` (pipe direct rather
  than via `init_osm3s.sh`, which wants `.bz2` XML).
- **First attempt crashed the disk at 100%** — `--meta` + no-compression
  produced a 37GB partial DB for Scotland before failing on File_Error. The
  10–15GB estimate in the original plan was wrong; that was only true with
  compression. Second attempt (current): drop `--meta`, add both
  `--compression-method=gz` flags. Expected size ~8–12GB.
- Replication diffs still work without meta; we just lose per-feature
  author/timestamp fields, which SAR never reads.
- **Live 2026-04-19 01:02 BST.** First `/osm/stats` after cutover:
  `mirror_wins: { "127.0.0.1:12345": 3 }`, `latency_live.p95: 395 ms`
  (vs. 29.5 s on public mirrors immediately before). Search Ops is no
  longer bottlenecked on public Overpass.
- `dispatcher Type=forking` in the unit file hung during activation even
  though the binary daemonises; switched to `Type=simple` and it came up
  clean. Kept in the unit for future maintainers.
- Minutely replication not wired yet — DB is a static Geofabrik snapshot
  from 2026-04-18. Good enough for SAR for weeks; add `fetch_osc.sh` +
  `apply_osc_to_db.sh` unit later if freshness matters.
- systemd units: `overpass-dispatcher.service`, `fcgiwrap-overpass.{service,socket}`.
  fcgiwrap runs as `pmsvc` (not www-data) so it can `connect()` to the
  dispatcher socket in `/srv/overpass/db`.
- nginx local vhost: `127.0.0.1:12345/api/*` → fcgiwrap → `/srv/overpass/install/cgi-bin/*`.
- `OVERPASS_URLS` env var in `server/.env` (not source change): puts local
  mirror first, public mirrors as fallback.

## Original rationale (kept for future similar decisions)

## Why defer

The cache is the cheaper first lever. A self-hosted mirror only pays off if
public Overpass actually is the bottleneck the IC feels. We don't yet know
that: there have been brownouts in testing, but we also hadn't shipped
stale-if-error, tile-quantised keys, or 429 backoff at the time. With those
in place, the public mirrors may be tolerable.

## Trigger — build it when these hold

Check `GET /api/search/osm/stats` after a week of real use.

1. `by_source.error` ≥ 10% of `total_requests`, **or**
2. `cache_hit_ratio` < 0.6 during active IC sessions (grid regenerations),
   **or**
3. `latency_live.p95` > 15000 ms sustained — ICs will feel grid generation
   stalling regardless of cache hit ratio.

Any one is enough. Errors matter most — cache misses we can live with if
they eventually succeed; hard errors break the grid tool outright.

## Target scope

**Scotland only**, not full Great Britain. Two reasons:

- SAR Search Ops is currently Ayrshire-focused; every tenant we expect in
  the next year is Scotland-based. A region that matches the actual user
  base keeps the DB small and fresh.
- big-server is at 48% disk (40 GB free as of 2026-04-18). GB extract
  inflates to 50–80 GB of Overpass DB — uncomfortable given the other 17
  vhosts. Scotland is ~10–15 GB and leaves headroom.

If the tenant list later extends south of the border, we either (a) add a
second Scotland-sized region alongside or (b) roll to full GB on a
purpose-built VPS. Don't try to crowbar the full island onto big-server.

## Technical plan

### Build

Ubuntu 24.04 native, no Docker (CLAUDE.md was stale — Docker isn't actually
installed on big-server; adding it to bring up one service bloats the
surface area). Compile `osm-3s` from source — pattern already used for
nginx VTS on big-server (see `reference_nginx_vts_module.md`).

```bash
apt install build-essential g++ make expat libexpat1-dev zlib1g-dev
cd /srv/overpass
wget https://dev.overpass-api.de/releases/osm-3s_latest.tar.gz
tar xzf osm-3s_latest.tar.gz && cd osm-3s_*
./configure --prefix=/srv/overpass/install
make && make install
```

Meta mode (`--meta`) is overkill for SAR; we only read geometries + tags.
Skipping it nearly halves the DB.

### Data

Scotland extract from Geofabrik, minutely replication for freshness:

```bash
# initial load
wget https://download.geofabrik.de/europe/united-kingdom/scotland-latest.osm.pbf
osmium cat scotland-latest.osm.pbf -o scotland.osm  # or use --osc source directly
/srv/overpass/install/bin/init_osm3s.sh scotland.osm /srv/overpass/db /srv/overpass/install
# minutely diffs
nohup /srv/overpass/install/bin/fetch_osc.sh 1 "https://planet.osm.org/replication/minute/" /srv/overpass/diffs &
nohup /srv/overpass/install/bin/apply_osc_to_db.sh /srv/overpass/diffs auto &
```

Expected resource usage once running:
- Disk: 10–15 GB DB + 1–2 GB diffs rotating
- RAM: 1–2 GB RSS under light load; Overpass uses mmap so kernel page cache
  grows freely but is reclaimable.
- CPU: near-zero idle; queries single-threaded, spiky during grid
  regeneration. Fine on 8-core big-server.

### Wire-up

Overpass dispatcher listens on a local UNIX socket; expose via the bundled
`cgi-bin/interpreter` behind nginx on 127.0.0.1:12345. Do **not** publish
externally — only search-surface consumes it.

In `server/search-helpers.js` the OVERPASS_ENDPOINTS array is already a
ranked list. Prepend the local mirror:

```js
const OVERPASS_ENDPOINTS = [
  'http://127.0.0.1:12345/api/interpreter',  // self-hosted — first pick
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
```

The existing `Promise.any` mirror race naturally prefers whichever answers
first — on a quiet self-hosted node that'll almost always be us. Public
mirrors stay wired as fallback so a local DB problem doesn't take search
offline.

### Health + rollback

- systemd unit `overpass-dispatcher.service` runs the dispatcher;
  `overpass-diff.service` runs the minutely import. Both with
  `Restart=on-failure` and `RestartSec=30`.
- Nagios-style check: `curl -s http://127.0.0.1:12345/api/status` should
  return a line starting with "Connection:". If not, remove the local
  endpoint from search-helpers.js and restart search-api — takes 10 s.
- Daily cron verifies the DB timestamp is < 10 min old; if it lags by more
  than 2 h, stop the diff service and re-init from a fresh Geofabrik dump
  (cheaper than unwinding a broken diff stream).

## What NOT to do

- Don't install Docker "just for this". It adds a maintenance axis for one
  service on a host that currently runs everything as systemd units. Native
  build fits the existing pattern.
- Don't pull the GB extract hoping it'll fit "if we're careful". It won't
  — the DB grows organically with applied diffs and will eventually push
  big-server into disk pressure during a bad moment (mid-incident,
  typically).
- Don't put the DB on `/tmp` or an ephemeral mount to dodge the disk
  question. Overpass DBs are expensive to rebuild; you want them on `/` or
  a proper attached volume.

## Effort estimate

Rough wall-clock once triggered:
- Compile: 20–30 min
- Initial import: 1–2 h for Scotland (CPU-bound, single-threaded)
- nginx + systemd wiring: 30 min
- search-helpers.js one-line change + deploy: 5 min
- Smoke test + watch `/osm/stats` for a session: 1 h

Half-day of calendar time; 3–4 h of active work.
