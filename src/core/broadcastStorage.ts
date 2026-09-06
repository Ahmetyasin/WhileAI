/**
 * Persistence for the broadcast half (CLAUDE.md §6).
 *
 * The queue lives in storage.local so it survives a service worker death
 * (§5.1); volatile tab/window ids live in storage.session so they cannot
 * outlive the browser and point at somebody else's tab (§5.2).
 */
import { ext } from './browser';
import {
  type BroadcastRuntime,
  type BroadcastSettings,
  type PromptItem,
  type ProviderId,
  type QueueState,
} from './broadcastTypes';

const QUEUE_KEY = 'broadcastQueue';
const SETTINGS_KEY = 'broadcastSettings';
const RUNTIME_KEY = 'broadcastRuntime';

/**
 * Same serialization discipline as core/storage.ts: the queue is mutated by
 * the service worker, the side panel and several content scripts, and a
 * read-modify-write race here silently drops runs.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

export const DEFAULT_BROADCAST_SETTINGS: BroadcastSettings = {
  version: 1,
  providers: {
    chatgpt: { enabled: false, maxWaitMs: 300_000, longMode: false },
    claude: { enabled: false, maxWaitMs: 300_000, longMode: false },
    perplexity: { enabled: false, maxWaitMs: 300_000, longMode: false },
    gemini: { enabled: false, maxWaitMs: 300_000, longMode: false },
    deepseek: { enabled: false, maxWaitMs: 300_000, longMode: false },
  },
  sourceProviderId: null,
  mode: 'continue',
  lockstep: false,
  keepHistory: false,
  notifications: true,
  broadcastEnabled: true,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Total validator in the house style: anything malformed falls back to defaults. */
export function validateSettings(raw: unknown): BroadcastSettings {
  if (!isRecord(raw)) return DEFAULT_BROADCAST_SETTINGS;
  const providers: BroadcastSettings['providers'] = {
    ...DEFAULT_BROADCAST_SETTINGS.providers,
  };
  if (isRecord(raw.providers)) {
    for (const [id, p] of Object.entries(raw.providers)) {
      if (!isRecord(p)) continue;
      const base = providers[id] ?? { enabled: false, maxWaitMs: 300_000, longMode: false };
      providers[id] = {
        enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
        maxWaitMs:
          typeof p.maxWaitMs === 'number' && p.maxWaitMs > 0 ? p.maxWaitMs : base.maxWaitMs,
        longMode: typeof p.longMode === 'boolean' ? p.longMode : base.longMode,
      };
    }
  }
  return {
    version: 1,
    providers,
    sourceProviderId:
      typeof raw.sourceProviderId === 'string' ? (raw.sourceProviderId as ProviderId) : null,
    mode: raw.mode === 'new_chat' ? 'new_chat' : 'continue',
    lockstep: raw.lockstep === true,
    keepHistory: raw.keepHistory === true,
    broadcastEnabled: raw.broadcastEnabled !== false,
    notifications: raw.notifications !== false,
  };
}

export async function getBroadcastSettings(): Promise<BroadcastSettings> {
  try {
    const res = await ext.storage.local.get(SETTINGS_KEY);
    return validateSettings(res[SETTINGS_KEY]);
  } catch {
    return DEFAULT_BROADCAST_SETTINGS;
  }
}

export async function setBroadcastSettings(s: BroadcastSettings): Promise<void> {
  await serialize(async () => {
    await ext.storage.local.set({ [SETTINGS_KEY]: s });
  });
}

/**
 * Read-modify-write inside the SAME lock.
 *
 * setBroadcastSettings only serializes the write, so two callers could both
 * read the old value and the second would clobber the first. Toggling several
 * provider chips quickly lost all but the last one or two (observed in the
 * loaded extension 2026-09-06). Anything that changes part of the settings
 * must go through here, not get-then-set.
 */
export async function updateBroadcastSettings(
  mutate: (current: BroadcastSettings) => BroadcastSettings,
): Promise<BroadcastSettings> {
  return serialize(async () => {
    let current: BroadcastSettings;
    try {
      const res = await ext.storage.local.get(SETTINGS_KEY);
      current = validateSettings(res[SETTINGS_KEY]);
    } catch {
      current = DEFAULT_BROADCAST_SETTINGS;
    }
    const next = mutate(current);
    await ext.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
}

/** Prompt text is only kept while the run is alive unless keepHistory (§5.26). */
export function validateQueue(raw: unknown): QueueState {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return { items: [] };
  const items: PromptItem[] = [];
  for (const it of raw.items) {
    if (!isRecord(it)) continue;
    if (typeof it.id !== 'string' || typeof it.text !== 'string') continue;
    if (!isRecord(it.runs)) continue;
    items.push(it as unknown as PromptItem);
  }
  return { items };
}

export async function getQueue(): Promise<QueueState> {
  try {
    const res = await ext.storage.local.get(QUEUE_KEY);
    return validateQueue(res[QUEUE_KEY]);
  } catch {
    return { items: [] };
  }
}

export async function setQueue(state: QueueState): Promise<void> {
  await serialize(async () => {
    await ext.storage.local.set({ [QUEUE_KEY]: state });
  });
}

/**
 * Read-modify-write the queue under the shared lock. Every mutation must go
 * through here so two concurrent updates cannot drop each other.
 */
export async function updateQueue(
  fn: (state: QueueState) => QueueState | Promise<QueueState>,
): Promise<QueueState> {
  return serialize(async () => {
    const res = await ext.storage.local.get(QUEUE_KEY);
    const current = validateQueue(res[QUEUE_KEY]);
    const next = await fn(current);
    await ext.storage.local.set({ [QUEUE_KEY]: next });
    return next;
  });
}

// ---- storage.session: ids that must not outlive the browser (§5.2) ----

export async function getRuntime(): Promise<BroadcastRuntime> {
  try {
    const res = await ext.storage.session.get(RUNTIME_KEY);
    const raw = res[RUNTIME_KEY];
    if (!isRecord(raw)) return { tabs: {} };
    return {
      compareWindowId:
        typeof raw.compareWindowId === 'number' ? raw.compareWindowId : undefined,
      groupId: typeof raw.groupId === 'number' ? raw.groupId : undefined,
      sourceTabId: typeof raw.sourceTabId === 'number' ? raw.sourceTabId : undefined,
      tabs: isRecord(raw.tabs) ? (raw.tabs as Record<string, number>) : {},
    };
  } catch {
    return { tabs: {} };
  }
}

export async function updateRuntime(
  fn: (r: BroadcastRuntime) => BroadcastRuntime,
): Promise<BroadcastRuntime> {
  return serialize(async () => {
    const res = await ext.storage.session.get(RUNTIME_KEY);
    const raw = res[RUNTIME_KEY];
    const current: BroadcastRuntime = isRecord(raw)
      ? {
          compareWindowId:
            typeof raw.compareWindowId === 'number' ? raw.compareWindowId : undefined,
          groupId: typeof raw.groupId === 'number' ? raw.groupId : undefined,
          sourceTabId: typeof raw.sourceTabId === 'number' ? raw.sourceTabId : undefined,
          tabs: isRecord(raw.tabs) ? (raw.tabs as Record<string, number>) : {},
        }
      : { tabs: {} };
    const next = fn(current);
    await ext.storage.session.set({ [RUNTIME_KEY]: next });
    return next;
  });
}

/** sha256 hex, for prompt dedupe (§5.13). */
export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
