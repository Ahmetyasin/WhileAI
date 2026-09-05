import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Minimal chrome.* mock: in-memory storage.local/session, inert runtime,
// alarms, tabs, windows, notifications and sidePanel (broadcast half).
const localStore = new Map<string, unknown>();
const sessionStore = new Map<string, unknown>();

function areaMock(store: Map<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[]) => {
      const arr = typeof keys === 'string' ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const k of arr) if (store.has(k)) out[k] = store.get(k);
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of typeof keys === 'string' ? [keys] : keys) store.delete(k);
    }),
    clear: vi.fn(async () => store.clear()),
  };
}

const chromeMock = {
  storage: {
    local: areaMock(localStore),
    session: areaMock(sessionStore),
  },
  runtime: {
    sendMessage: vi.fn(async () => ({ ok: true })),
    onMessage: { addListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    openOptionsPage: vi.fn(),
  },
  alarms: {
    create: vi.fn(async () => {}),
    clear: vi.fn(async () => true),
    onAlarm: { addListener: vi.fn() },
  },
  tabs: {
    create: vi.fn(async () => ({ id: 1 })),
    get: vi.fn(async () => ({ id: 1, url: 'https://chatgpt.com/' })),
    query: vi.fn(async () => []),
    update: vi.fn(async () => ({ id: 1 })),
    remove: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => ({ ok: true })),
    onRemoved: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
  },
  windows: {
    create: vi.fn(async () => ({ id: 10, tabs: [] })),
    get: vi.fn(async () => ({ id: 10 })),
    update: vi.fn(async () => ({ id: 10 })),
    onRemoved: { addListener: vi.fn() },
  },
  scripting: { executeScript: vi.fn(async () => []) },
  notifications: { create: vi.fn(async () => 'n1'), onClicked: { addListener: vi.fn() } },
  sidePanel: {
    open: vi.fn(async () => {}),
    setPanelBehavior: vi.fn(async () => {}),
  },
  permissions: {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
  },
  webNavigation: { onHistoryStateUpdated: { addListener: vi.fn() } },
};

// @ts-expect-error test shim
globalThis.chrome = chromeMock;

export function clearChromeStorage(): void {
  localStore.clear();
  sessionStore.clear();
}
