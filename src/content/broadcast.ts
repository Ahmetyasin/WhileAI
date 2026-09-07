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
import { CaptureGuard, conversationKeyOf } from './captureGuard';
import {
  judge,
  judgeOnTimeout,
  type DeliveryBaseline,
  type PageProbe,
} from './deliveryVerdict';
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
  // Remembers EVERY prompt relayed in this conversation, not just the last
  // one. Switching the model re-renders the transcript, and a single-value
  // memory let an older prompt look new again and go out twice (reported
  // 2026-09-07).
  const captureGuard = new CaptureGuard({
    conversationKey: conversationKeyOf(location.href),
  });
  /** How many user messages were on the page when this script started. */
  let baselineCount = 0;

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
        paused: adapter.isConversationPaused(),
        // Either the wording says so, or the page is structurally refusing.
        // The structural half is what keeps this working when a provider
        // rewords its notice between config updates.
        quotaWall: adapter.isQuotaWall() || adapter.isBlockedFromSending(),
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
      // Check the page BEFORE declaring success. A wall that appears after the
      // prompt was accepted is the case that had no reporting at all: Claude's
      // per-model usage limit is shown once the prompt is in, so the send
      // looked fine, the watcher saw generation stop, and DONE was reported
      // for a prompt that was never answered (reported with a screenshot
      // 2026-09-07 — the prompt sat there with no error of any kind).
      if (adapter.isQuotaWall()) {
        report({
          ...observation('ERROR', providerId, {
            code: 'QUOTA_EXHAUSTED',
            detail: 'the provider reports its usage limit is reached',
          }),
          promptId,
        });
        return;
      }
      if (adapter.isConversationPaused()) {
        report({
          ...observation('ERROR', providerId, {
            code: 'CONVERSATION_PAUSED',
            detail: 'the conversation is paused and needs your attention',
          }),
          promptId,
        });
        return;
      }
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
        // A conversation the site has paused (Claude's "Chat paused" card)
        // removes the composer, so it would otherwise be reported as a page
        // that needs reloading — advice that does not help, because only the
        // user can clear the card (live 2026-09-07).
        if (adapter.isConversationPaused()) {
          return observation('ERROR', providerId, {
            code: 'CONVERSATION_PAUSED',
            detail: 'the conversation is paused and needs your attention',
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
        // Capture the transcript BEFORE touching the composer, so both the
        // insert-failure check below and the post-submit verdict compare
        // against the same starting point.
        const beforeLast = adapter.getLastUserMessageText();
        const beforeCount = adapter.countUserMessages();

        const inserted = await adapter.insertText(cmd.text);
        if (!inserted.ok) {
          // "Failed" is a claim about the COMPOSER, not about the site. Its
          // verification waits for the send button to become usable, and
          // Gemini only renders that button while the composer has text — so
          // an editor that submits on its own left insertText with nothing to
          // verify against and it reported failure for a prompt that had gone
          // through and been answered (live 2026-09-07).
          //
          // Before believing it, look at the transcript.
          const landed = await waitFor(
            () =>
              judge(
                {
                  isLoginPage: adapter.isLoginPage(),
                  composerReady: adapter.isComposerReady(),
                  quotaWall: adapter.isQuotaWall(),
                  lastUserMessage: adapter.getLastUserMessageText(),
                  userMessageCount: adapter.countUserMessages(),
                },
                { lastUserMessage: beforeLast, userMessageCount: beforeCount, sentText: cmd.text },
              ) === 'accepted'
                ? true
                : null,
            2500,
          );
          if (landed === true) {
            captureGuard.markSeen(await hashOf(cmd.text), { echo: true });
            watchForDone(cmd.promptId);
            return { ...observation('SUBMITTED', providerId, {}), promptId: cmd.promptId };
          }
          activePromptId = null;
          return observation('ERROR', providerId, {
            code: 'INSERT_FAILED',
            detail: inserted.detail,
          });
        }
        report({ ...observation('INSERTED', providerId, {}), promptId: cmd.promptId });

        // Baseline the transcript BEFORE submitting. Without it, a page that
        // refuses the prompt but still shows OUR PREVIOUS one reads as
        // "accepted" — the newest user message matches the text we sent
        // because we sent that same text a moment ago on a retry, or because
        // the site rolled the conversation back behind a sign-in wall
        // (reported 2026-09-07: the prompt was counted as sent while the UI
        // was showing the login screen).
        const submitted = await adapter.submit();
        if (!submitted) {
          activePromptId = null;
          // Say WHY, when the page will tell us. A send button that never
          // becomes usable is usually a wall the site put up — Claude's
          // per-model usage limit leaves the composer holding the prompt with
          // the button disabled, which reported a bare SUBMIT_FAILED and read
          // as "something went wrong" for a problem with an obvious remedy
          // (reported with a screenshot 2026-09-07).
          if (adapter.isQuotaWall()) {
            return observation('ERROR', providerId, {
              code: 'QUOTA_EXHAUSTED',
              detail: 'the provider reports its usage limit is reached',
            });
          }
          if (adapter.isConversationPaused()) {
            return observation('ERROR', providerId, {
              code: 'CONVERSATION_PAUSED',
              detail: 'the conversation is paused and needs your attention',
            });
          }
          // Structural last resort: the prompt is sitting in the composer,
          // nothing is generating, and the site will not enable send. We
          // cannot name the reason — the wording may be one we have never
          // seen — but "the site is refusing this" is more useful, and more
          // honest, than a bare "the send button did not respond".
          if (adapter.isBlockedFromSending()) {
            return observation('ERROR', providerId, {
              code: 'NOT_ACCEPTED',
              detail: 'the site is not letting the prompt be sent',
            });
          }
          return observation('ERROR', providerId, { code: 'SUBMIT_FAILED' });
        }

        // The click was accepted, but that is not the same as the site having
        // ACCEPTED the prompt: it can refuse for reasons we cannot enumerate
        // (a usage cap explained in the page, a model picker in a bad state,
        // a network hiccup). So confirm the prompt actually appears as a user
        // message before reporting success. This is the general check the
        // user asked for — not another special case per provider.
        // Two outcomes are fine: our prompt shows up as the newest user
        // message, or the transcript is not rendered at all. A background tab
        // is throttled hard enough that a site can accept the prompt and draw
        // nothing (verified live on DeepSeek 2026-09-07: the conversation was
        // in the sidebar, the transcript empty). Only a page that clearly
        // shows OTHER messages but not ours means the prompt was refused.
        // The judgement itself lives in deliveryVerdict.ts, pure and tested:
        // it has to survive an SPA re-rendering after submit, a background
        // tab that draws nothing, and a wall that appears only after the
        // click. The rule it encodes is that evidence the prompt LANDED beats
        // evidence that something looks wrong — a mid-render page with no
        // composer was being reported as "signed out" while the prompt was
        // already in the transcript (Claude, 2026-09-07).
        const readProbe = (): PageProbe => ({
          isLoginPage: adapter.isLoginPage(),
          composerReady: adapter.isComposerReady(),
          quotaWall: adapter.isQuotaWall(),
          lastUserMessage: adapter.getLastUserMessageText(),
          userMessageCount: adapter.countUserMessages(),
        });
        const baseline: DeliveryBaseline = {
          lastUserMessage: beforeLast,
          userMessageCount: beforeCount,
          sentText: cmd.text,
        };
        const verdict =
          (await waitFor(() => judge(readProbe(), baseline), 6000)) ??
          judgeOnTimeout(readProbe());

        if (verdict === 'gated') {
          activePromptId = null;
          return observation('NOT_LOGGED_IN', providerId, {});
        }
        if (verdict === 'quota') {
          activePromptId = null;
          return observation('ERROR', providerId, {
            code: 'QUOTA_EXHAUSTED',
            detail: 'the provider reports its usage limit is reached',
          });
        }
        if (verdict === 'other') {
          activePromptId = null;
          return observation('ERROR', providerId, {
            code: 'NOT_ACCEPTED',
            detail: 'the site did not accept the prompt',
          });
        }

        // Record what WE delivered here, so this tab does not report the
        // extension's own prompt back as something the user just typed. The
        // worker also suppresses echoes by hash, but doing it here as well
        // means a delivery is never relayed onward even if the worker
        // restarted between delivering and hearing about it.
        captureGuard.markSeen(await hashOf(cmd.text), { echo: true });

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
    // A message the page did not have before means the user has typed since
    // the script loaded, so whatever was baselined at injection is no longer
    // a reason to stay quiet — including a repeat of that very prompt.
    const count = adapter.countUserMessages();
    if (count > baselineCount) {
      baselineCount = count;
      captureGuard.noteNewMessage();
    }
    const hash = await hashOf(text);
    // Re-check the conversation on every capture: these are SPAs, so the URL
    // changes without a navigation event we can rely on. Same conversation
    // keeps its memory; a genuinely different one starts clean, because the
    // same question asked in a new chat IS a new prompt.
    captureGuard.setConversation(conversationKeyOf(location.href));
    if (!captureGuard.shouldRelay(hash)) return;
    // Confirm the worker actually took it. `report` fires and forgets, so a
    // dropped message or a service worker restart mid-send lost the prompt
    // permanently: the page still showed it, but the guard had already
    // recorded it and would never offer it again (live 2026-09-07, one of
    // five prompts vanished with nothing logged anywhere). Releasing it lets
    // the next poll — the worker's own capture alarm — try again.
    try {
      const ack = (await ext.runtime.sendMessage(
        observation('PROMPT_CAPTURED', providerId, { text, hash }),
      )) as { ok?: boolean; queued?: boolean; blocked?: unknown } | undefined;
      // Only `queued` settles the hash. A bare {ok:true} is what every
      // DELIBERATE refusal returns as well as a dropped one, and the original
      // bug was treating those the same — so the default is to release it and
      // let the next poll decide. A refusal simply refuses again, at no cost;
      // a lost prompt gets a second chance, which is the whole point.
      if (ack?.queued === true) captureGuard.confirm(hash);
      else captureGuard.unconfirm(hash);
    } catch {
      captureGuard.unconfirm(hash);
    }
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
    baselineCount = adapter.countUserMessages();
    if (existing) captureGuard.markSeen(await hashOf(existing));
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
