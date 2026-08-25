import { adapterForHost } from '../adapters/registry';
import type { PlatformAdapter } from '../adapters/types';
import { ADAPTER_VERSION, SCHEMA_VERSION } from '../core/constants';
import { getEffectiveConfig } from '../core/config';
import { classifyMode } from '../core/metrics';
import { TurnTracker } from '../core/TurnTracker';
import { VisibilityTracker } from '../core/VisibilityTracker';
import type { RuntimeMessage, Turn, TurnCore } from '../core/types';
import { ext } from '../core/browser';

function send(msg: RuntimeMessage): void {
  try {
    void ext.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // extension context invalidated (update/reload) — nothing to do
  }
}

async function main(): Promise<void> {
  const config = await getEffectiveConfig();
  const maybeAdapter: PlatformAdapter | null = adapterForHost(location.hostname, config);
  if (!maybeAdapter) return;
  const adapter: PlatformAdapter = maybeAdapter;

  // Push (possibly remote-updated) endpoint patterns to the MAIN world script.
  window.postMessage(
    { __dwell_cfg: true, endpointPatterns: adapter.config.endpointPatterns },
    '*',
  );

  send({ kind: 'platform:active', platform: adapter.id });

  const visibility = new VisibilityTracker();
  // Thinking indicator can vanish before the turn closes; latch it per turn.
  let sawThinking = false;

  const tracker = new TurnTracker({
    onOpen: ({ id, startedAt }) => {
      visibility.start();
      sawThinking = false;
      send({
        kind: 'turn:open',
        open: { id, platform: adapter.id, startedAt, updatedAt: Date.now() },
      });
    },
    onClose: (core: TurnCore) => {
      const vis = visibility.stop();
      const hiddenMs = Math.max(0, core.totalWaitMs - vis.visibleMs);
      const turn: Turn = {
        ...core,
        schemaVersion: SCHEMA_VERSION,
        platform: adapter.id,
        model: adapter.detectModel(),
        mode: classifyMode(core.totalWaitMs, sawThinking),
        visibleMs: Math.min(vis.visibleMs, core.totalWaitMs),
        hiddenMs,
        focusMs: Math.min(vis.focusMs, core.totalWaitMs),
        escapeCount: vis.escapeCount,
        adapterVersion: ADAPTER_VERSION,
      };
      send({ kind: 'turn:completed', turn });
    },
  });

  // ---- Signal A: network (MAIN world postMessage) ----
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const d = ev.data as { __dwell?: boolean; type?: string; bytes?: number } | null;
    if (!d || d.__dwell !== true) return;
    switch (d.type) {
      case 'stream:submit':
        tracker.signal('network', 'start');
        break;
      case 'stream:first_token':
        tracker.signal('network', 'first_token');
        break;
      case 'stream:end':
        tracker.signal('network', 'end', { bytes: d.bytes });
        break;
      case 'stream:error':
        tracker.signal('network', 'error');
        break;
    }
  });

  // ---- Signals B (stop button) & C (streaming DOM marker) ----
  // One throttled MutationObserver drives both presence checks.
  let wasGenerating = false;
  let wasStreamingDom = false;
  let checkScheduled = false;

  function checkSignals(): void {
    checkScheduled = false;

    const generating = adapter.isGenerating();
    if (generating && !wasGenerating) tracker.signal('button', 'start');
    if (!generating && wasGenerating) tracker.signal('button', 'end');
    wasGenerating = generating;

    if (adapter.streamingSelector) {
      let streaming = false;
      try {
        streaming = document.querySelector(adapter.streamingSelector) !== null;
      } catch {
        streaming = wasStreamingDom;
      }
      if (streaming && !wasStreamingDom) {
        tracker.signal('dom', 'start');
        tracker.signal('dom', 'first_token');
      }
      if (!streaming && wasStreamingDom) tracker.signal('dom', 'end');
      wasStreamingDom = streaming;
    }

    if (tracker.hasActiveTurn && !sawThinking && adapter.hasThinkingIndicator()) {
      sawThinking = true;
    }
  }

  const observer = new MutationObserver(() => {
    if (checkScheduled) return;
    checkScheduled = true;
    setTimeout(checkSignals, 150); // throttle: chat pages mutate constantly
  });

  function startObserving(): void {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-testid', 'data-is-streaming', 'class', 'aria-label'],
    });
    // Safety net: MutationObserver can miss states; poll slowly too.
    setInterval(checkSignals, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving, { once: true });
  } else {
    startObserving();
  }

  // Abort: user clicked the stop button (spec §2.5).
  document.addEventListener(
    'click',
    (ev) => {
      if (!tracker.hasActiveTurn) return;
      const stopBtn = adapter.findStopButton();
      if (stopBtn && ev.target instanceof Node && stopBtn.contains(ev.target)) {
        tracker.signal('button', 'abort');
      }
    },
    { capture: true },
  );

  // Tab closing with an open turn → orphaned (spec §2.5).
  window.addEventListener('pagehide', () => {
    const id = tracker.activeTurnId;
    if (id) {
      send({ kind: 'turn:pagehide', id });
      tracker.forceClose('orphaned');
    }
  });

  // Heartbeat so the service worker can distinguish live long turns
  // (deep research) from dead ones (spec §3.7).
  setInterval(() => {
    const id = tracker.activeTurnId;
    if (id) send({ kind: 'turn:heartbeat', id, updatedAt: Date.now() });
  }, 30_000);

  // Adapter health (spec §3.6) — wait for the app shell to render first.
  setTimeout(() => {
    const result = adapter.selfTest();
    send({ kind: 'adapter:selftest', platform: adapter.id, ok: result.ok, missing: result.missing });
  }, 10_000);
}

void main();
