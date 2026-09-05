// Browser-only chrome.* shim so dist/dashboard.html and dist/popup.html can be
// previewed outside the extension (test harness /dashboard and /popup routes).
// Never shipped: lives in test-harness/, not dist/.
(() => {
  if (window.chrome?.storage) return;
  const mem = new Map();
  const sess = new Map();
  const area = (store) => ({
    get: async (keys) => {
      const arr = typeof keys === 'string' ? [keys] : keys;
      const out = {};
      for (const k of arr) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    },
    remove: async (keys) => {
      for (const k of typeof keys === 'string' ? [keys] : keys) store.delete(k);
    },
  });
  window.chrome = {
    storage: { local: area(mem), session: area(sess) },
    // The side panel asks for a provider's host permission when it is enabled;
    // in the preview there is nothing to grant, so accept.
    permissions: { contains: async () => true, request: async () => true },
    runtime: {
      // Records every message so harness tests can inspect what the content
      // script would have sent to the service worker.
      sendMessage: async (msg) => {
        (window.__msgs = window.__msgs || []).push(msg);
        return { ok: true };
      },
      openOptionsPage: () => (location.pathname = '/dashboard'),
    },
  };
})();

// Harness-only: mirror open-turn bookkeeping into a shared, cross-tab store so
// the concurrency behaviour can be exercised without loading the extension.
(() => {
  const KEY = 'whileai_harness_openTurns';
  const readAll = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const writeAll = (v) => localStorage.setItem(KEY, JSON.stringify(v));
  const origGet = window.chrome.storage.local.get;
  const origSet = window.chrome.storage.local.set;
  const origRemove = window.chrome.storage.local.remove;
  window.chrome.storage.local.get = async (keys) => {
    const out = await origGet(keys);
    const arr = typeof keys === 'string' ? [keys] : keys;
    if (arr.includes('openTurns')) out.openTurns = readAll();
    return out;
  };
  window.chrome.storage.local.set = async (items) => {
    if ('openTurns' in items) writeAll(items.openTurns);
    return origSet(items);
  };
  window.chrome.storage.local.remove = async (keys) => {
    const arr = typeof keys === 'string' ? [keys] : keys;
    if (arr.includes('openTurns')) writeAll({});
    return origRemove(keys);
  };
})();
