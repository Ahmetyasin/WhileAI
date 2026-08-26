// Browser-only chrome.* shim so dist/dashboard.html and dist/popup.html can be
// previewed outside the extension (test harness /dashboard and /popup routes).
// Never shipped: lives in test-harness/, not dist/.
(() => {
  if (window.chrome?.storage) return;
  const mem = new Map();
  window.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const arr = typeof keys === 'string' ? [keys] : keys;
          const out = {};
          for (const k of arr) if (mem.has(k)) out[k] = mem.get(k);
          return out;
        },
        set: async (items) => {
          for (const [k, v] of Object.entries(items)) mem.set(k, v);
        },
        remove: async (keys) => {
          for (const k of typeof keys === 'string' ? [keys] : keys) mem.delete(k);
        },
      },
    },
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
