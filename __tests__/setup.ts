import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Minimal chrome.* mock: in-memory storage.local, inert runtime/alarms.
const localStore = new Map<string, unknown>();

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const arr = typeof keys === 'string' ? [keys] : keys;
        const out: Record<string, unknown> = {};
        for (const k of arr) if (localStore.has(k)) out[k] = localStore.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) localStore.set(k, v);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const k of typeof keys === 'string' ? [keys] : keys) localStore.delete(k);
      }),
      clear: vi.fn(async () => localStore.clear()),
    },
  },
  runtime: {
    sendMessage: vi.fn(async () => ({ ok: true })),
    onMessage: { addListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    openOptionsPage: vi.fn(),
  },
  alarms: {
    create: vi.fn(async () => {}),
    onAlarm: { addListener: vi.fn() },
  },
};

// @ts-expect-error test shim
globalThis.chrome = chromeMock;

export function clearChromeStorage(): void {
  localStore.clear();
}
