import { adapterForHost } from '../adapters/registry';
import type { PlatformAdapter } from '../adapters/types';
import { ADAPTER_VERSION, MAX_VALID_WAIT_MS, SCHEMA_VERSION } from '../core/constants';
import { getEffectiveConfig } from '../core/config';
import { classifyMode } from '../core/metrics';
import { getOpenTurns, getSettings } from '../core/storage';
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

  const settings = await getSettings();
  const dlog = (event: string, detail?: Record<string, unknown>): void => {
    if (!settings.debugLogging) return;
    send({ kind: 'debug:log', entry: { at: Date.now(), src: 'content', platform: adapter.id, event, detail } });
  };

  // Push (possibly remote-updated) endpoint patterns to the MAIN world script.
  window.postMessage(
    { __whileai_cfg: true, endpointPatterns: adapter.config.endpointPatterns },
    '*',
  );

  send({ kind: 'platform:active', platform: adapter.id });
  dlog('content:init', { href: location.pathname });

  const visibility = new VisibilityTracker();
  // Thinking indicator can vanish before the turn closes; latch it per turn.
  let sawThinking = false;
  let wasStreamingDom = false;

  // Platform truth used by the state machine to survive multi-request
  // generations (deep research) and to gate ambiguity decisions.
  const isStillGenerating = (): boolean => {
    let domStreaming = false;
    if (adapter.streamingSelector) {
      try {
        domStreaming = document.querySelector(adapter.streamingSelector) !== null;
      } catch {
        domStreaming = false;
      }
    }
    return adapter.isGenerating() || domStreaming;
  };

  const tracker = new TurnTracker({
    isStillGenerating,
    onOpen: ({ id, startedAt, openedBy, resumed }) => {
      visibility.start();
      sawThinking = false;
      dlog(resumed ? 'turn:resume' : 'turn:open', { id, openedBy, startedAt });
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
      dlog('turn:close', {
        id: core.id, status: core.status, confidence: core.confidence,
        totalWaitMs: core.totalWaitMs, ttftMs: core.ttftMs, signals: core.signals,
        mode: turn.mode, escapeCount: turn.escapeCount, hiddenMs,
      });
      send({ kind: 'turn:completed', turn });
    },
  });

  // ---- Resume: adopt an open turn that survived a page reload ----
  // Deep research keeps generating server-side; if the page reloads mid-turn,
  // pick the turn back up as soon as the UI confirms generation is active.
  async function tryResume(): Promise<void> {
    try {
      const open = await getOpenTurns();
      const candidates = Object.values(open).filter(
        (o) => o.platform === adapter.id && Date.now() - o.startedAt < MAX_VALID_WAIT_MS,
      );
      if (candidates.length === 0) return;
      const newest = candidates.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));
      const deadline = Date.now() + 20_000; // give the SPA time to render
      const poll = setInterval(() => {
        if (tracker.hasActiveTurn || Date.now() > deadline) {
          clearInterval(poll);
          return;
        }
        if (isStillGenerating()) {
          clearInterval(poll);
          tracker.resume({ id: newest.id, startedAt: newest.startedAt });
        }
      }, 500);
    } catch {
      // storage unavailable — skip resume
    }
  }
  void tryResume();

  // ---- Signal A: network (MAIN world postMessage) ----
  // Some platforms (verified on Perplexity) abort the SSE connection client-
  // side when the answer is complete, which surfaces as an error just before
  // the final byte-counted end. Hold errors briefly: if an end with data
  // follows, the "error" was a routine completion abort, not a failure.
  let errorHold: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const d = ev.data as { __whileai?: boolean; type?: string; bytes?: number } | null;
    if (!d || d.__whileai !== true) return;
    dlog(`signal:${d.type}`, d.bytes !== undefined ? { bytes: d.bytes } : undefined);
    switch (d.type) {
      case 'stream:submit':
        tracker.signal('network', 'start');
        break;
      case 'stream:first_token':
        tracker.signal('network', 'first_token');
        break;
      case 'stream:end':
        if (errorHold !== null && (d.bytes ?? 0) > 0) {
          clearTimeout(errorHold); // completion-abort pattern — not an error
          errorHold = null;
        }
        tracker.signal('network', 'end', { bytes: d.bytes });
        break;
      case 'stream:error':
        if (errorHold === null) {
          errorHold = setTimeout(() => {
            errorHold = null;
            tracker.signal('network', 'error');
          }, 250);
        }
        break;
    }
  });

  // ---- Signals B (stop button) & C (streaming DOM marker) ----
  // One throttled MutationObserver drives both presence checks.
  let wasGenerating = false;
  let checkScheduled = false;

  function checkSignals(): void {
    checkScheduled = false;

    const generating = adapter.isGenerating();
    if (generating && !wasGenerating) {
      dlog('signal:button-start');
      tracker.signal('button', 'start');
    }
    if (!generating && wasGenerating) {
      dlog('signal:button-end');
      tracker.signal('button', 'end');
    }
    wasGenerating = generating;

    if (adapter.streamingSelector) {
      let streaming = false;
      try {
        streaming = document.querySelector(adapter.streamingSelector) !== null;
      } catch {
        streaming = wasStreamingDom;
      }
      if (streaming && !wasStreamingDom) {
        dlog('signal:dom-start');
        tracker.signal('dom', 'start');
        tracker.signal('dom', 'first_token');
      }
      if (!streaming && wasStreamingDom) {
        dlog('signal:dom-end');
        tracker.signal('dom', 'end');
      }
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
        dlog('signal:abort-click');
        tracker.signal('button', 'abort');
      }
    },
    { capture: true },
  );

  // Page going away mid-turn: do NOT close the turn — persist a snapshot so
  // the reloaded page can resume it. If nobody resumes, the service worker's
  // sweep orphans it with this partial data (spec §10).
  window.addEventListener('pagehide', () => {
    const id = tracker.activeTurnId;
    if (!id) return;
    const vis = visibility.peek();
    dlog('turn:pagehide', { id });
    send({
      kind: 'turn:pagehide',
      id,
      snapshot: {
        totalWaitMs: Date.now() - (tracker.activeTurnStartedAt ?? Date.now()),
        visibleMs: vis.visibleMs,
        focusMs: vis.focusMs,
        escapeCount: vis.escapeCount,
      },
    });
  });

  // Heartbeat so the service worker can distinguish live long turns
  // (deep research) from dead ones (spec §3.7).
  setInterval(() => {
    const id = tracker.activeTurnId;
    if (id) send({ kind: 'turn:heartbeat', id, updatedAt: Date.now() });
  }, 30_000);

  // Adapter health (spec §3.6). SPAs render slowly and routes vary, so retry
  // before reporting a failure; report success immediately.
  const SELFTEST_DELAYS_MS = [10_000, 30_000, 90_000];
  let selfTestAttempt = 0;
  function runSelfTest(): void {
    const result = adapter.selfTest();
    selfTestAttempt++;
    if (result.ok || selfTestAttempt >= SELFTEST_DELAYS_MS.length) {
      dlog('selftest', { ok: result.ok, missing: result.missing, attempt: selfTestAttempt });
      send({ kind: 'adapter:selftest', platform: adapter.id, ok: result.ok, missing: result.missing });
    } else {
      setTimeout(runSelfTest, SELFTEST_DELAYS_MS[selfTestAttempt] - SELFTEST_DELAYS_MS[selfTestAttempt - 1]);
    }
  }
  setTimeout(runSelfTest, SELFTEST_DELAYS_MS[0]);
}

void main();
