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

  function watchForDone(promptId: string): void {
    if (doneWatcher !== null) clearInterval(doneWatcher);
    let lastLen = -1;
    let stableSince = 0;
    let sawGenerating = false;

    doneWatcher = setInterval(() => {
      const generating = adapter.isGenerating();
      if (generating) {
        sawGenerating = true;
        stableSince = 0;
        return;
      }
      // Only conclude "done" after generation was actually observed, so a
      // slow-starting answer is not mistaken for a finished one.
      if (!sawGenerating) return;

      const len = document.body.innerText.length;
      if (len !== lastLen) {
        lastLen = len;
        stableSince = Date.now();
        return;
      }
      if (stableSince !== 0 && Date.now() - stableSince >= 1500) {
        if (doneWatcher !== null) clearInterval(doneWatcher);
        doneWatcher = null;
        activePromptId = null;
        report({ ...observation('DONE', providerId, {}), promptId });
      }
    }, 500);
  }

  // ---- Command handling ----

  async function handle(cmd: Command): Promise<Observation | { ok: true }> {
    switch (cmd.type) {
      case 'PING':
        return { ok: true };

      case 'GET_STATE':
        return currentState();

      case 'NEW_CHAT':
        await adapter.newChat();
        return { ok: true };

      case 'CANCEL':
        if (doneWatcher !== null) {
          clearInterval(doneWatcher);
          doneWatcher = null;
        }
        activePromptId = null;
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
    if (!sourceMode) return;
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
