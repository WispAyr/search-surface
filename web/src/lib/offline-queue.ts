// IndexedDB-backed outbox for field-team mutations.
// The field view is used in rural / low-signal areas. When offline, checklist
// toggles / check-ins / reports go here instead of dying; when connectivity
// returns, we drain in order. Each entry carries `client_ts` so the backend can
// honor the real time-of-action instead of the drain time (matters for audit).

const DB_NAME = "search-field-offline-v1";
const DB_VERSION = 1;
const STORE = "outbox";

export type OutboxKind = "street" | "checkin" | "report";

export interface OutboxEntry {
  id?: number;
  kind: OutboxKind;
  url: string;
  method: "POST" | "PATCH";
  body: unknown;
  // Client-side timestamp of the action, included so the backend can honour the
  // real time rather than the server-drain time. Included in the POST body as
  // `client_ts` when draining.
  client_ts: string;
  created_at: number;
  attempts: number;
  last_error?: string;
  // Dedup key — we coalesce rapid toggles on the same street into one entry.
  dedup?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("dedup", "dedup", { unique: false });
        store.createIndex("created_at", "created_at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

function tx(mode: IDBTransactionMode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

async function tryCoalesce(entry: OutboxEntry): Promise<boolean> {
  if (!entry.dedup) return false;
  const store = await tx("readwrite");
  return new Promise((resolve) => {
    const idx = store.index("dedup");
    const req = idx.openCursor(IDBKeyRange.only(entry.dedup!));
    let matched = false;
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        cur.update({ ...(cur.value as OutboxEntry), body: entry.body, client_ts: entry.client_ts, attempts: 0 });
        matched = true;
        resolve(true);
      } else if (!matched) resolve(false);
    };
    req.onerror = () => resolve(false);
  });
}

export async function enqueue(entry: Omit<OutboxEntry, "id" | "created_at" | "attempts">) {
  const full: OutboxEntry = { ...entry, created_at: Date.now(), attempts: 0 };
  if (await tryCoalesce(full)) {
    notify();
    return;
  }
  const store = await tx("readwrite");
  await new Promise<void>((resolve, reject) => {
    const req = store.add(full);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  notify();
}

export async function count(): Promise<number> {
  const store = await tx("readonly");
  return new Promise((resolve) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });
}

async function list(): Promise<OutboxEntry[]> {
  const store = await tx("readonly");
  return new Promise((resolve) => {
    const req = store.index("created_at").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function remove(id: number) {
  const store = await tx("readwrite");
  await new Promise<void>((resolve) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

async function bump(id: number, error: string) {
  const store = await tx("readwrite");
  await new Promise<void>((resolve) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const e = getReq.result as OutboxEntry | undefined;
      if (!e) return resolve();
      e.attempts += 1;
      e.last_error = error;
      const put = store.put(e);
      put.onsuccess = () => resolve();
      put.onerror = () => resolve();
    };
    getReq.onerror = () => resolve();
  });
}

let draining = false;

export async function drain(): Promise<{ sent: number; failed: number }> {
  if (draining) return { sent: 0, failed: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { sent: 0, failed: 0 };
  draining = true;
  let sent = 0;
  let failed = 0;
  try {
    const entries = await list();
    for (const e of entries) {
      try {
        const body = { ...(e.body as object), client_ts: e.client_ts };
        const res = await fetch(e.url, {
          method: e.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        if (!res.ok) {
          // 4xx beyond 408/429 is terminal — token expired, team deleted, etc.
          // Drop these; the field UI will already be showing an error from its
          // own context fetch, and we don't want the queue to wedge forever.
          if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
            await remove(e.id!);
            failed++;
            continue;
          }
          throw new Error(`${res.status} ${res.statusText}`);
        }
        await remove(e.id!);
        sent++;
      } catch (err) {
        await bump(e.id!, err instanceof Error ? err.message : String(err));
        failed++;
        // Stop on first network failure — preserve ordering and avoid spamming.
        break;
      }
    }
  } finally {
    draining = false;
    notify();
  }
  return { sent, failed };
}

// Lightweight pub/sub so UI can show "N pending" without polling.
type Listener = (count: number) => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  count().then(fn).catch(() => fn(0));
  return () => { listeners.delete(fn); };
}
function notify() {
  count().then((n) => listeners.forEach((fn) => fn(n))).catch(() => {});
}

// Auto-drain when connectivity returns.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { drain(); });
}
