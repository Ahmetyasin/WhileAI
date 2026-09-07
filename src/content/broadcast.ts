/**
 * Broadcast content script (CLAUDE.md §3): deliberately dumb. It observes the
 * page and executes commands; it never decides what to send or when. All
 * policy lives in core/queue.ts.
 *
 * Runs in the ISOLATED world alongside the tracking content script but in a
 * separate bundle with its own guard, so a fault here cannot regress
 * measurement.
 */
import { broadcastAdapterForHost } from '../adapters/registry';
import { getEffectiveConfig } from '../core/config';
import { ext } from '../core/browser';
import { waitFor } from '../adapters/domHelpers';
import {
  observation,
  parseCommand,
  type Command,
  type Observation,
} from '../core/messages';
import { DoneDetector } from './doneDetector';

declare global {
  interface Window {
    __whileaiBroadcast?: boolean;
  }
}

async function main(): Promise<void> {
  if (window.__whileaiBroadcast) return; // double-injection guard (§5.4)
  window.__whileaiBroadcast = true;

  const config = await getEffectiveConfig();
  const maybeAdapter = broadcastAdapterForHost(location.hostname, config);
  if (!maybeAdapter) return;
  // Bound to a non-null const so the closures below keep the narrowing.
  const adapter = maybeAdapter;
  const providerId = adapter.id;

  function report(obs: Observation): void {
    try {
      void ext.runtime.sendMessage(obs).catch(() => {});
    } catch {
      // extension reloaded — the page will be re-injected
    }
  }

  // ---- Page state, reported so the worker never has to guess ----

  // Declared before the message listener is registered: SET_SOURCE_MODE can
  // arrive the moment the listener exists, and a `let` initialised further
  // down would either be in its temporal dead zone or overwrite the value.
  let sourceMode = false;
  // Mirrors settings.captureFromAnyTab so a prompt typed in this tab is
  // offered to the worker even when no tab was explicitly nominated.
  let captureFromAnyTab = true;
  let lastCapturedHash: string | null = null;

  let lastReportedReady = false;
  let lastGenerating = false;
  /** Prompt currently being handled, so DONE can be attributed correctly. */
  let activePromptId: string | null = null;

  async function hashOf(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text.trim());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function currentState(): Promise<Extract<Observation, { type: 'STATE' }>> {
    const last = adapter.getLastUserMessageText();
    return {
      ...(observation('STATE', providerId, {
        composerReady: adapter.isComposerReady(),
        generating: adapter.isGenerating(),
        lastUserHash: last ? await hashOf(last) : null,
      }) as Extract<Observation, { type: 'STATE' }>),
    };
  }

  function checkPage(): void {
    if (adapter.isChallengePage()) {
      report(observation('CHALLENGE_DETECTED', providerId, {}));
      return;
    }
    if (adapter.isLoginPage()) {
      report(observation('NOT_LOGGED_IN', providerId, {}));
      return;
    }
    const ready = adapter.isComposerReady();
    if (ready && !lastReportedReady) report(observation('READY', providerId, {}));
    lastReportedReady = ready;

    const generating = adapter.isGenerating();
    if (generating && !lastGenerating && activePromptId) {
      report(observation('GENERATING', providerId, { promptId: activePromptId } as never));
    }
    lastGenerating = generating;
  }

  // ---- Done detection (§5.11) ----
  // Never trust a single frame: an answer counts as finished when generation
  // has stopped AND the visible answer text has not changed for a while.
  let doneWatcher: ReturnType<typeof setInterval> | null = null;
  let doneObserver: MutationObserver | null = null;

  function stopDoneWatcher(): void {
    if (doneWatcher !== null) clearInterval(doneWatcher);
    doneWatcher = null;
    if (doneObserver !== null) doneObserver.disconnect();
    doneObserver = null;
  }

  function watchForDone(promptId: string, assumeStarted = false): void {
    stopDoneWatcher();
    const detector = new DoneDetector({
      isGenerating: () => adapter.isGenerating(),
      textLength: () => adapter.answerLength(),
      assumeStarted,
    });

    const finish = (): void => {
      stopDoneWatcher();
      activePromptId = null;
      report({ ...observation('DONE', providerId, {}), promptId });
    };
    const step = (): void => {
      if (detector.tick(Date.now()).done) finish();
    };

    // A timer ALONE is not enough. Chrome throttles setInterval in a hidden
    // tab to roughly once a second — measured live 2026-09-06: a 250ms
    // interval fired 6 times in 15s instead of 60. Every broadcast tab is a
    // background tab, so completion was detected up to a minute late and the
    // recorded wait time was the timer's latency, not the model's (a 5s
    // answer reported as "1m 6s").
    //
    // A MutationObserver is not throttled, and it fires exactly when the
    // answer is being written — so it carries the streaming phase. The timer
    // stays as the heartbeat that notices the text has STOPPED changing,
    // which no mutation can signal.
    doneWatcher = setInterval(step, 250);
    doneObserver = new MutationObserver(step);
    try {
      doneObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    } catch {
      // No body yet: the interval still covers it.
    }
  }

  // ---- Command handling ----

  async function handle(cmd: Command): Promise<Observation | { ok: true }> {
    switch (cmd.type) {
      case 'PING':
        return { ok: true };

      case 'GET_STATE':
        // Re-read the page before answering. A background tab is throttled
        // hard enough that MutationObserver and the poll both stall, so the
        // cached hash goes stale and a prompt typed there is never relayed
        // (observed live 2026-09-06: the message was in the DOM while the
        // script still reported the previous one). Asking is cheap.
        await captureIfSource();
        return currentState();

      case 'NEW_CHAT':
        await adapter.newChat();
        return { ok: true };

      case 'CANCEL':
        stopDoneWatcher();
        activePromptId = null;
        return { ok: true };

      case 'WATCH':
        // A navigation replaced this script mid-run, so the watcher that was
        // following the answer is gone (§5.4). The answer node is already
        // populated, so neither witness can fire against a fresh baseline —
        // tell the detector the answer is underway, and it settles on text
        // stability. The background only sends WATCH for a run it knows was
        // submitted, so this cannot invent a completion.
        activePromptId = cmd.promptId;
        watchForDone(cmd.promptId, true);
        return { ok: true };

      case 'SET_SOURCE_MODE':
        sourceMode = cmd.isSource;
        return { ok: true };

      case 'INSERT_AND_SUBMIT': {
        if (adapter.isChallengePage()) {
          return observation('CHALLENGE_DETECTED', providerId, {});
        }
        if (adapter.isLoginPage()) {
          return observation('NOT_LOGGED_IN', providerId, {});
        }
        // Checked BEFORE readiness: a usage wall leaves the composer and send
        // button in place, so readiness passes and the send fails with a
        // meaningless INSERT_FAILED (observed on Perplexity 2026-09-06).
        if (adapter.isQuotaWall()) {
          return observation('ERROR', providerId, {
            code: 'QUOTA_EXHAUSTED',
            detail: 'the provider reports its usage limit is reached',
          });
        }
        // The SPA may still be rendering when the tab has just been opened.
        const ready = await waitFor(() => adapter.isComposerReady(), 8000);
        if (!ready) {
          // No composer after a grace period is the other login signal (§5.16).
          return adapter.isLoginPage()
            ? observation('NOT_LOGGED_IN', providerId, {})
            : observation('ERROR', providerId, { code: 'NO_COMPOSER' });
        }

        activePromptId = cmd.promptId;
        const inserted = await adapter.insertText(cmd.text);
        if (!inserted.ok) {
          activePromptId = null;
          return observation('ERROR', providerId, {
            code: 'INSERT_FAILED',
            detail: inserted.detail,
          });
        }
        report({ ...observation('INSERTED', providerId, {}), promptId: cmd.promptId });

        const submitted = await adapter.submit();
        if (!submitted) {
          activePromptId = null;
          return observation('ERROR', providerId, { code: 'SUBMIT_FAILED' });
        }
        watchForDone(cmd.promptId);
        return { ...observation('SUBMITTED', providerId, {}), promptId: cmd.promptId };
      }

      default: {
        const never: never = cmd;
        void never;
        return { ok: true };
      }
    }
  }

  ext.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const cmd = parseCommand(raw);
    if (!cmd || cmd.providerId !== providerId) return false;
    void handle(cmd)
      .then(sendResponse)
      .catch(() => sendResponse(observation('ERROR', providerId, { code: 'UNKNOWN' })));
    return true; // async response
  });

  // ---- Source capture (§5.13) ----
  // The prompt is read from the DOM once the site has committed it as a user
  // message, not from keystrokes: that way edits, regenerates and failed sends
  // never produce a phantom broadcast.
  async function captureIfSource(): Promise<void> {
    // Always report what was typed; the service worker decides whether this
    // tab is allowed to relay (§5.14). The content script cannot know whether
    // it is one of the extension's own tabs, and duplicating that rule here
    // would let the two drift apart.
    if (!sourceMode && !captureFromAnyTab) return;
    const text = adapter.getLastUserMessageText();
    if (!text) return;
    const hash = await hashOf(text);
    if (hash === lastCapturedHash) return;
    lastCapturedHash = hash;
    report(observation('PROMPT_CAPTURED', providerId, { text, hash }));
  }

  let scheduled = false;
  const onMutate = (): void => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      checkPage();
      void captureIfSource();
    }, 200);
  };

  // Baseline BEFORE watching: whatever user message is already on the page
  // at injection time is old news, not a new prompt. Without this, every
  // reload or install re-relayed the last message from every open AI tab —
  // seen live 2026-09-07, a phantom broadcast nobody typed. Only messages
  // that appear after this point are relayed.
  void (async () => {
    const existing = adapter.getLastUserMessageText();
    if (existing) lastCapturedHash = await hashOf(existing);
  })();

  const observer = new MutationObserver(onMutate);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-testid', 'aria-label', 'class', 'disabled', 'data-is-streaming'],
  });
  // MutationObserver can miss states; a slow poll is the safety net.
  setInterval(onMutate, 2000);
  checkPage();
}

void main();
