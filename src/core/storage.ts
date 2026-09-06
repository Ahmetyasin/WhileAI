import {
  DB_NAME,
  DB_VERSION,
  META_STORE,
  RESUME_PENALTY_DEFAULT_MS,
  RETENTION_DEFAULT_DAYS,
  SCHEMA_VERSION,
  TURNS_STORE,
} from './constants';
import { addTurnToSummary, dayKey, emptySummary } from './metrics';
import type {
  DailySummary,
  DebugLogEntry,
  OpenTurnState,
  PlatformActivity,
  Settings,
  Turn,
} from './types';
import { ext } from './browser';

// ---------------------------------------------------------------------------
// IndexedDB: raw turn records (spec §4.2)
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      // Migration ladder (spec §4.3): add `case` blocks per version bump.
      if (ev.oldVersion < 1) {
        const store = db.createObjectStore(TURNS_STORE, { keyPath: 'id' });
        store.createIndex('startedAt', 'startedAt');
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Test hook: drop the cached connection so a fresh DB can be opened. */
export function resetDbCache(): void {
  dbPromise = null;
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(TURNS_STORE, mode);
    const store = t.objectStore(TURNS_STORE);
    let result: T | undefined;
    const req = fn(store);
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result as T);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function saveTurn(turn: Turn): Promise<void> {
  const db = await openDb();
  await tx(db, 'readwrite', (s) => void s.put(turn));
}

export async function getTurnsSince(fromTs: number): Promise<Turn[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(TURNS_STORE, 'readonly');
    const idx = t.objectStore(TURNS_STORE).index('startedAt');
    const req = idx.getAll(IDBKeyRange.lowerBound(fromTs));
    req.onsuccess = () => resolve(req.result as Turn[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllTurns(): Promise<Turn[]> {
  return getTurnsSince(0);
}

export async function countTurns(): Promise<number> {
  const db = await openDb();
  return tx<number>(db, 'readonly', (s) => s.count());
}

export async function deleteAllTurns(): Promise<void> {
  const db = await openDb();
  await tx(db, 'readwrite', (s) => void s.clear());
}

export async function pruneOlderThan(days: number): Promise<number> {
  const cutoff = Date.now() - days * 86_400_000;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(TURNS_STORE, 'readwrite');
    const idx = t.objectStore(TURNS_STORE).index('startedAt');
    let deleted = 0;
    const req = idx.openCursor(IDBKeyRange.upperBound(cutoff, true));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        deleted++;
        cursor.continue();
      }
    };
    t.oncomplete = () => resolve(deleted);
    t.onerror = () => reject(t.error);
  });
}

// ---------------------------------------------------------------------------
// Export / import (spec §4.2)
// ---------------------------------------------------------------------------

export interface ExportEnvelope {
  product: 'whileai';
  schemaVersion: number;
  exportedAt: number;
  turns: Turn[];
}

export async function exportJSON(): Promise<string> {
  const turns = await getAllTurns();
  const envelope: ExportEnvelope = {
    product: 'whileai',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    turns,
  };
  return JSON.stringify(envelope, null, 2);
}

const CSV_COLUMNS: (keyof Turn)[] = [
  'id', 'platform', 'model', 'mode', 'startedAt', 'totalWaitMs', 'ttftMs',
  'streamMs', 'visibleMs', 'hiddenMs', 'focusMs', 'escapeCount', 'bytes',
  'status', 'confidence', 'signals', 'adapterVersion', 'schemaVersion',
];

export async function exportCSV(): Promise<string> {
  const turns = await getAllTurns();
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('|') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.join(',')];
  for (const t of turns) lines.push(CSV_COLUMNS.map((c) => esc(t[c])).join(','));
  return lines.join('\n');
}

/** Per-version migration functions for imported records (spec §4.3). */
const MIGRATIONS: Record<number, (t: Record<string, unknown>) => Record<string, unknown>> = {
  // 0 -> 1 example: (t) => ({ ...t, schemaVersion: 1 })
};

function migrateTurn(raw: Record<string, unknown>): Turn | null {
  let t = { ...raw };
  let v = typeof t.schemaVersion === 'number' ? t.schemaVersion : SCHEMA_VERSION;
  while (v < SCHEMA_VERSION) {
    const fn = MIGRATIONS[v];
    if (!fn) return null;
    t = fn(t);
    v++;
  }
  if (
    typeof t.id !== 'string' ||
    typeof t.platform !== 'string' ||
    typeof t.startedAt !== 'number' ||
    typeof t.totalWaitMs !== 'number' ||
    typeof t.status !== 'string'
  ) {
    return null;
  }
  return { ...t, schemaVersion: SCHEMA_VERSION } as unknown as Turn;
}

export async function importJSON(json: string): Promise<{ imported: number; skipped: number }> {
  const parsed = JSON.parse(json) as Partial<ExportEnvelope>;
  if (parsed.product !== 'whileai' || !Array.isArray(parsed.turns)) {
    throw new Error('Not a WhileAI export file');
  }
  let imported = 0;
  let skipped = 0;
  for (const raw of parsed.turns) {
    const turn = migrateTurn(raw as unknown as Record<string, unknown>);
    if (turn) {
      await saveTurn(turn);
      imported++;
    } else {
      skipped++;
    }
  }
  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// chrome.storage.local: settings, daily summaries, open-turn state (spec §4.2)
// ---------------------------------------------------------------------------

/**
 * Serializes read-modify-write cycles on chrome.storage.local. Several tabs
 * plus the service worker mutate the same keys; without this, two concurrent
 * updates each read the old map and the later write silently drops the other's
 * change — which resurrected removed open turns (live counter never stopped)
 * and lost turns when two chats ran at once.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

const SETTINGS_KEY = 'settings';
const SUMMARIES_KEY = 'dailySummaries';
const OPEN_TURNS_KEY = 'openTurns';
const ACTIVITY_KEY = 'platformActivity';
const SELFTEST_KEY = 'adapterSelfTests';

export const DEFAULT_SETTINGS: Settings = {
  trackingEnabled: true,
  resumePenaltyMs: RESUME_PENALTY_DEFAULT_MS,
  retentionDays: RETENTION_DEFAULT_DAYS,
  notificationsEnabled: false,
  // On during pre-release field testing; ship 1.0 with false.
  debugLogging: true,
};

export async function getSettings(): Promise<Settings> {
  const res = await ext.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] ?? {}) };
}

export function setSettings(patch: Partial<Settings>): Promise<Settings> {
  return serialize(async () => {
    const current = await getSettings();
    const next = { ...current, ...patch };
    await ext.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
}

export async function getDailySummaries(): Promise<Record<string, DailySummary>> {
  const res = await ext.storage.local.get(SUMMARIES_KEY);
  return res[SUMMARIES_KEY] ?? {};
}

export function recordTurnInSummary(turn: Turn): Promise<void> {
  return serialize(async () => {
    const summaries = await getDailySummaries();
    const key = dayKey(turn.startedAt);
    summaries[key] = addTurnToSummary(summaries[key] ?? emptySummary(), turn);
  // Keep the summary map bounded (400 days).
    const keys = Object.keys(summaries).sort();
    while (keys.length > 400) delete summaries[keys.shift()!];
    await ext.storage.local.set({ [SUMMARIES_KEY]: summaries });
  });
}

export async function clearSummaries(): Promise<void> {
  await ext.storage.local.remove(SUMMARIES_KEY);
}

export async function getOpenTurns(): Promise<Record<string, OpenTurnState>> {
  const res = await ext.storage.local.get(OPEN_TURNS_KEY);
  return res[OPEN_TURNS_KEY] ?? {};
}

export function setOpenTurn(state: OpenTurnState): Promise<void> {
  return serialize(async () => {
    const open = await getOpenTurns();
    // A removed turn must never come back: once closed, ignore late writes.
    if (closedTurnIds.has(state.id)) return;
    open[state.id] = state;
    await ext.storage.local.set({ [OPEN_TURNS_KEY]: open });
  });
}

/** Recently closed turn ids, so in-flight heartbeats cannot resurrect them. */
const closedTurnIds = new Set<string>();

export function removeOpenTurn(id: string): Promise<void> {
  closedTurnIds.add(id);
  if (closedTurnIds.size > 200) {
    closedTurnIds.delete(closedTurnIds.values().next().value as string);
  }
  return serialize(async () => {
    const open = await getOpenTurns();
    if (id in open) {
      delete open[id];
      await ext.storage.local.set({ [OPEN_TURNS_KEY]: open });
    }
  });
}

export async function getPlatformActivity(): Promise<Record<string, PlatformActivity>> {
  const res = await ext.storage.local.get(ACTIVITY_KEY);
  return res[ACTIVITY_KEY] ?? {};
}

export function touchPlatformActivity(
  platform: string,
  field: keyof PlatformActivity,
): Promise<void> {
  return serialize(async () => {
    const all = await getPlatformActivity();
    const entry = (all[platform] ??= { lastActiveAt: 0, lastTurnAt: 0 });
    entry[field] = Date.now();
    await ext.storage.local.set({ [ACTIVITY_KEY]: all });
  });
}

export async function getSelfTests(): Promise<Record<string, { ok: boolean; missing: string[]; at: number }>> {
  const res = await ext.storage.local.get(SELFTEST_KEY);
  return res[SELFTEST_KEY] ?? {};
}

export function setSelfTest(platform: string, ok: boolean, missing: string[]): Promise<void> {
  return serialize(async () => {
    const all = await getSelfTests();
    all[platform] = { ok, missing, at: Date.now() };
    await ext.storage.local.set({ [SELFTEST_KEY]: all });
  });
}

// ---------------------------------------------------------------------------
// Debug log ring buffer (field debugging; dashboard → Data → Download log)
// ---------------------------------------------------------------------------

const DEBUG_LOG_KEY = 'debugLog';
const DEBUG_LOG_MAX = 3000;

export function appendDebugLog(entry: DebugLogEntry): Promise<void> {
  return serialize(async () => {
    const res = await ext.storage.local.get(DEBUG_LOG_KEY);
    const log: DebugLogEntry[] = res[DEBUG_LOG_KEY] ?? [];
    log.push(entry);
    if (log.length > DEBUG_LOG_MAX) log.splice(0, log.length - DEBUG_LOG_MAX);
    await ext.storage.local.set({ [DEBUG_LOG_KEY]: log });
  });
}

export async function getDebugLog(): Promise<DebugLogEntry[]> {
  const res = await ext.storage.local.get(DEBUG_LOG_KEY);
  return res[DEBUG_LOG_KEY] ?? [];
}

export async function clearDebugLog(): Promise<void> {
  await ext.storage.local.remove(DEBUG_LOG_KEY);
}

/** Wipe everything: IndexedDB turns + summaries + open state. Settings survive. */
export async function deleteAllData(): Promise<void> {
  await deleteAllTurns();
  await ext.storage.local.remove([SUMMARIES_KEY, OPEN_TURNS_KEY, ACTIVITY_KEY, SELFTEST_KEY, DEBUG_LOG_KEY]);
}
