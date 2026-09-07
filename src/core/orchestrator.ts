/**
 * Side-effect half of the broadcast engine (CLAUDE.md §3).
 *
 * The reducer decides; this executes. It is the only broadcast module allowed
 * to touch chrome.tabs / chrome.scripting / chrome.notifications, which keeps
 * the scheduling policy testable without a browser.
 *
 * Nothing is cached in memory across calls: the service worker can die at any
 * moment (§5.1), so state is read from storage, reduced, and written back.
 */
import { ext } from './browser';
import { appendDebugLog, getSettings } from './storage';
import { getBroadcastSettings, getQueue, getRuntime, updateQueue } from './broadcastStorage';
import {
  isTerminal,
  type Command,
  type ProviderId,
  type QueueEvent,
  type QueueState,
} from './broadcastTypes';
import { DEFAULT_POLICY, forgetSettledText, reduce, type QueuePolicy } from './queue';
import { EMBEDDED_CONFIG, getPlatformConfig } from './config';
import {
  ADAPTER_VERSION,
  MAX_VALID_WAIT_MS,
  MIN_VALID_WAIT_MS,
  SCHEMA_VERSION,
} from './constants';
import type { Turn } from './types';
import { command, type Observation } from './messages';
import {
  ALIVE_UNPARSED,
  ensureContentScript,
  focusTab,
  forgetProviderTab,
  getOrCreateProviderTab,
  sendCommand,
} from './tabs';
import { DISPLAY_NAMES } from '../adapters/broadcastTypes';

export const BROADCAST_TICK_ALARM = 'whileai:broadcast-tick';

async function currentPolicy(): Promise<QueuePolicy> {
  const settings = await getBroadcastSettings();
  const maxWaitMs: Record<string, number> = {};
  for (const [id, p] of Object.entries(settings.providers)) {
    // Long mode covers deep-research style answers (§5.11).
    maxWaitMs[id] = p.longMode ? Math.max(p.maxWaitMs, 30 * 60_000) : p.maxWaitMs;
  }
  return { ...DEFAULT_POLICY, maxWaitMs, lockstep: settings.lockstep };
}

/**
 * Apply one event: read state, reduce, persist, then run the commands. The
 * write happens before the side effects so a crash mid-dispatch leaves the
 * queue in the state the reducer intended (§5.3).
 */
export async function dispatch(event: QueueEvent): Promise<QueueState> {
  const policy = await currentPolicy();
  const settings = await getBroadcastSettings();
  let commands: Command[] = [];
  const next = await updateQueue((state) => {
    const now = Date.now();
    const res = reduce(state, event, now, policy);
    commands = res.commands;
    // Keep the promise made in PRIVACY.md: once a prompt is finished
    // everywhere, its text is dropped unless the user asked to keep history.
    return forgetSettledText(res.state, now, settings.keepHistory);
  });
  await runCommands(commands);
  return next;
}

async function runCommands(commands: Command[]): Promise<void> {
  for (const cmd of commands) {
    try {
      await runCommand(cmd);
    } catch {
      // A failing side effect must not abort the rest of the batch; the run
      // it belongs to will time out or be retried by the reducer.
    }
  }
}

/**
 * Convert the content script's reply to INSERT_AND_SUBMIT into a queue event.
 * A missing or unparseable reply means the tab never answered (navigating,
 * discarded, or no content script), which is itself a delivery failure.
 */
async function applyInsertReply(
  promptId: string,
  providerId: ProviderId,
  reply: Observation | typeof ALIVE_UNPARSED | null,
): Promise<void> {
  // A reply we cannot read is not a confirmed delivery. The tab is alive, but
  // nothing told us the prompt landed, so treat it the same as silence rather
  // than reporting a success we did not observe.
  if (reply === null || reply === ALIVE_UNPARSED || !('v' in reply)) {
    void logBroadcast('tab_silent', { providerId });
    await dispatch({
      kind: 'failed',
      promptId,
      providerId,
      code: 'TAB_GONE',
      detail: 'the tab did not respond',
    });
    return;
  }
  switch (reply.type) {
    case 'SUBMITTED':
      await dispatch({ kind: 'submitted', promptId, providerId });
      return;
    case 'NOT_LOGGED_IN':
      void logBroadcast('not_logged_in', { providerId });
      await dispatch({ kind: 'not_logged_in', providerId });
      return;
    case 'CHALLENGE_DETECTED':
      await dispatch({ kind: 'challenge', providerId });
      return;
    case 'ERROR':
      void logBroadcast('insert_error', { providerId, code: reply.code, detail: reply.detail });
      await dispatch({
        kind: 'failed',
        promptId,
        providerId,
        code: reply.code,
        detail: reply.detail,
      });
      return;
    default:
      return;
  }
}

function providerUrl(providerId: ProviderId): string {
  const cfg = getPlatformConfig(EMBEDDED_CONFIG, providerId);
  return cfg?.newChatUrl ?? `https://${providerId}.com/`;
}

/**
 * Record broadcast activity in the same debug log the tracking half uses, so
 * "Download debug log" on the dashboard actually explains a failed broadcast.
 * Prompt TEXT is never written (§5.26) — only the run's shape.
 */
async function logBroadcast(event: string, detail?: Record<string, unknown>): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.debugLogging) return;
    await appendDebugLog({ at: Date.now(), src: 'sw', event: `broadcast:${event}`, detail });
  } catch {
    // logging must never break a run
  }
}

async function runCommand(cmd: Command): Promise<void> {
  void logBroadcast('command', {
    kind: cmd.kind,
    providerId: 'providerId' in cmd ? cmd.providerId : undefined,
  });
  switch (cmd.kind) {
    case 'open_tab': {
      // Never resurrect a tab the user closed. Closing it turns the provider
      // off (see forgetTab), and a retry that reopened it produced the loop
      // seen in the logs: tab_silent -> open_tab -> tab_silent again, ending
      // in an error for a provider the user had deliberately shut.
      const settings = await getBroadcastSettings();
      const stillEnabled = settings.providers[cmd.providerId]?.enabled === true;
      const tabId = await getOrCreateProviderTab(
        cmd.providerId,
        providerUrl(cmd.providerId),
        stillEnabled,
      );
      if (tabId === null) {
        await dispatch({ kind: 'tab_failed', promptId: cmd.promptId, providerId: cmd.providerId });
        return;
      }
      const alive = await ensureContentScript(tabId, cmd.providerId);
      if (!alive) {
        // The tab EXISTS — it just has no working content script, usually
        // because the extension was reloaded moments ago and the page has not
        // been re-injected yet. Saying "its tab could not be opened" here was
        // simply untrue and sent the user looking for a tab already in front
        // of them (2026-09-07).
        void logBroadcast('script_missing', { providerId: cmd.providerId });
        await forgetProviderTab(cmd.providerId);
        await dispatch({
          kind: 'failed',
          promptId: cmd.promptId,
          providerId: cmd.providerId,
          code: 'NO_SCRIPT',
          detail: 'the page is not responding yet',
        });
        return;
      }
      await dispatch({
        kind: 'tab_opened',
        promptId: cmd.promptId,
        providerId: cmd.providerId,
        tabId,
      });
      // The content script reports READY on its own once the composer exists,
      // but a script injected into an ALREADY-loaded page (tab reuse, or
      // re-injection after a discard) has no transition to report — it was
      // ready before we asked. So the reply must be turned into the event.
      // Without this the run sat in waiting_ready until it timed out, with
      // every provider tab open and idle (seen in the loaded extension
      // 2026-09-06).
      const state = await sendCommand(tabId, command('GET_STATE', cmd.providerId, {}));
      if (state !== null && state.type === 'STATE' && state.composerReady) {
        await dispatch({ kind: 'ready', providerId: cmd.providerId, tabId });
        return;
      }
      // Only true silence means the tab cannot be delivered to. A reply we
      // cannot parse still proves a script is there and listening.
      if (state === null) {
        // The tab took the message and never answered. Leaving the run in
        // waiting_ready meant nothing moved until the 5-minute ceiling, with
        // the user told nothing — seen live 2026-09-07 on DeepSeek, whose SPA
        // reported readyState 'complete' while rendering no composer at all.
        // A tab that cannot answer cannot be delivered to; say so now.
        void logBroadcast('tab_silent', { providerId: cmd.providerId, at: 'get_state' });
        await dispatch({
          kind: 'failed',
          promptId: cmd.promptId,
          providerId: cmd.providerId,
          code: 'TAB_GONE',
          detail: 'the tab did not respond',
        });
      }
      return;
    }

    case 'insert_and_submit': {
      await ensureContentScript(cmd.tabId, cmd.providerId);
      // Remember WHAT we delivered here, so when this tab reports the prompt
      // as its newest user message we recognise our own echo and do not relay
      // it back out. Keyed by tab, compared by hash (§5.13).
      try {
        const { updateRuntime } = await import('./broadcastStorage');
        const { hashText } = await import('./broadcastStorage');
        const hash = await hashText(cmd.text);
        await updateRuntime((r) => ({
          ...r,
          delivered: { ...(r.delivered ?? {}), [String(cmd.tabId)]: hash },
        }));
      } catch {
        // echo suppression is best-effort; a duplicate is caught by dedupe
      }
      const reply = await sendCommand(
        cmd.tabId,
        command('INSERT_AND_SUBMIT', cmd.providerId, {
          promptId: cmd.promptId,
          text: cmd.text,
        }),
      );
      // The content script answers with the outcome rather than reporting it
      // separately, so the reply MUST be turned into an event. Dropping it
      // left a failed insert sitting in 'inserting' until the run timed out,
      // with the panel claiming it was still typing.
      // Some sites refuse to submit while their tab is hidden, and they fail
      // in two different ways. Gemini leaves the text sitting in the composer
      // (SUBMIT_FAILED). Perplexity accepts the click and CLEARS the composer
      // but posts nothing — the message count never moves — which surfaces as
      // NOT_ACCEPTED. Both were verified live 2026-09-07, and both work the
      // instant the tab is activated. Retry once with the tab visible rather
      // than reporting a failure the user cannot act on.
      const hiddenTabRefusal =
        reply !== null &&
        reply.type === 'ERROR' &&
        (reply.code === 'SUBMIT_FAILED' || reply.code === 'NOT_ACCEPTED');
      if (hiddenTabRefusal) {
        try {
          await ext.tabs.update(cmd.tabId, { active: true });
          const retry = await sendCommand(
            cmd.tabId,
            command('INSERT_AND_SUBMIT', cmd.providerId, {
              promptId: cmd.promptId,
              text: cmd.text,
            }),
          );
          await applyInsertReply(cmd.promptId, cmd.providerId, retry);
          setTimeout(() => {
            void rearmStrandedWatchers().catch(() => {});
          }, 2500);
          return;
        } catch {
          // fall through and report the original failure
        }
      }
      await applyInsertReply(cmd.promptId, cmd.providerId, reply);
      // Submitting can navigate the SPA, which replaces the content script and
      // strands the watcher. The alarm reaper catches this eventually, but it
      // has a 30s floor; re-arm now so the wait time is measured, not guessed.
      setTimeout(() => {
        void rearmStrandedWatchers().catch(() => {});
      }, 2500);
      return;
    }

    case 'new_chat':
      await sendCommand(cmd.tabId, command('NEW_CHAT', cmd.providerId, {}));
      return;

    case 'cancel_run':
      if (cmd.tabId !== undefined) {
        await sendCommand(cmd.tabId, command('CANCEL', cmd.providerId, {}));
      }
      return;

    case 'reconcile': {
      // §5.3: after a restart, ask the page whether this prompt already landed
      // instead of assuming and sending it twice.
      const res = await sendCommand(
        cmd.tabId,
        command('GET_STATE', cmd.providerId, { hash: cmd.hash }),
      );
      const alreadySent =
        res !== null && res.type === 'STATE' && res.lastUserHash === cmd.hash;
      await dispatch({
        kind: 'reconciled',
        promptId: cmd.promptId,
        providerId: cmd.providerId,
        alreadySent,
      });
      return;
    }

    case 'notify':
      await notify(cmd);
      return;

    case 'record_run':
      await recordBroadcastRun(cmd.promptId, cmd.providerId);
      return;

    case 'schedule':
      await scheduleTick(cmd.afterMs);
      return;

    default: {
      const never: never = cmd;
      void never;
    }
  }
}

/**
 * What to tell the user, by failure code.
 *
 * The generic "open the tab to see why" was wrong for half of these: when the
 * tab could not be opened at all there is nothing to open, and the advice
 * read as a bug. Each code gets the sentence that is actually true and the
 * action that is actually available.
 */
const ERROR_TEXT: Record<string, (name: string) => string> = {
  TAB_GONE: (n) => `${n}: its tab could not be opened, so nothing was sent. Open ${n} yourself and try again.`,
  // Distinct from TAB_GONE: the tab is right there, it just is not listening
  // yet. Telling the user to open a tab they can already see was worse than
  // saying nothing.
  NO_SCRIPT: (n) => `${n}: the page was not ready, so nothing was sent. Reload the ${n} tab and try again.`,
  NOT_ACCEPTED: (n) => `${n} did not accept the prompt. Open its tab to see what it is showing.`,
  INSERT_FAILED: (n) => `${n}: the prompt could not be typed in. The site may have changed.`,
  SUBMIT_FAILED: (n) => `${n}: the send button did not respond.`,
  NO_COMPOSER: (n) => `${n}: no message box was found on the page.`,
  QUOTA_EXHAUSTED: (n) => `${n} has hit its usage limit. Wait for the reset or upgrade that account.`,
  ADAPTER_BROKEN: (n) => `whileAI cannot read ${n} at the moment — that site changed.`,
};

const NOTIFY_TEXT: Record<string, (name: string) => string> = {
  needs_login: (n) => `${n}: you are signed out. Sign in and the prompt will continue.`,
  blocked_challenge: (n) => `${n} is showing a verification check. Solve it, then press Resume.`,
  error: (n) => `${n}: the prompt did not go through.`,
  quota: (n) => `${n} has hit its usage limit. Wait for the reset or upgrade that account.`,
  timeout: (n) => `${n} took too long and was given up on.`,
};

/**
 * Problems the user has not seen yet, surfaced as a toolbar badge and listed
 * in the popup.
 *
 * A prompt that failed on one AI while the user was reading another tab used
 * to leave no trace they would ever notice: notifications are an optional
 * permission and a setting they may have turned off. The badge is neither.
 */
export interface Problem {
  providerId: string;
  level: string;
  message: string;
  at: number;
}

const PROBLEMS_KEY = 'broadcastProblems';

export async function recordProblem(providerId: string, level: string, message: string): Promise<void> {
  try {
    const res = await ext.storage.local.get(PROBLEMS_KEY);
    const list: Problem[] = Array.isArray(res[PROBLEMS_KEY]) ? res[PROBLEMS_KEY] : [];
    // One entry per provider: the newest problem is the one worth showing.
    const next = [
      ...list.filter((p) => p.providerId !== providerId),
      { providerId, level, message, at: Date.now() },
    ];
    await ext.storage.local.set({ [PROBLEMS_KEY]: next });
    await ext.action?.setBadgeText?.({ text: String(next.length) });
    await ext.action?.setBadgeBackgroundColor?.({ color: '#b45309' });
    await ext.action?.setTitle?.({
      title: `whileAI — ${next.length} provider${next.length === 1 ? '' : 's'} need attention`,
    });
  } catch {
    // the badge is a courtesy; never let it break a run
  }
}

/** Called by the popup once the user has seen the list. */
export async function clearProblems(): Promise<void> {
  try {
    await ext.storage.local.remove(PROBLEMS_KEY);
    await ext.action?.setBadgeText?.({ text: '' });
    await ext.action?.setTitle?.({ title: 'whileAI' });
  } catch {
    // ignored
  }
}

export async function getProblems(): Promise<Problem[]> {
  try {
    const res = await ext.storage.local.get(PROBLEMS_KEY);
    return Array.isArray(res[PROBLEMS_KEY]) ? (res[PROBLEMS_KEY] as Problem[]) : [];
  } catch {
    return [];
  }
}

async function notify(cmd: Extract<Command, { kind: 'notify' }>): Promise<void> {
  const name = DISPLAY_NAMES[cmd.providerId] ?? cmd.providerId;

  // The badge first: it needs no permission and no setting, so a provider
  // that failed is always visible even when the user is on another tab and
  // has never granted notifications. Silent failure is the thing to avoid.
  const text =
    (cmd.code !== undefined ? ERROR_TEXT[cmd.code]?.(name) : undefined) ??
    NOTIFY_TEXT[cmd.level]?.(name) ??
    cmd.level;
  await recordProblem(cmd.providerId, cmd.level, text);

  // Notifications are a required permission (see manifest), so there is no
  // grant to check: if the user has left them on, the message goes out —
  // whichever tab they happen to be looking at.
  const settings = await getBroadcastSettings();
  if (settings.notifications === false) return;
  try {
    // A UNIQUE id per notification. With a fixed `provider:level` id Chrome
    // replaces the existing notification in place, so a second failure on the
    // same provider produced no new alert at all — the user only ever saw the
    // first one, and only if they happened to be looking.
    await ext.notifications.create(`whileai:${cmd.providerId}:${cmd.level}:${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'whileAI',
      message: text,
    });
  } catch {
    // notifications are optional; never let them break a run
  }
}

/**
 * chrome.alarms, never setTimeout: a timer longer than the service worker's
 * idle window simply never fires (§5.1). The 30s floor is Chrome's minimum.
 */
/**
 * Re-arm the completion watcher for any run that is mid-flight but whose page
 * is not watching it (§5.4).
 *
 * A submit can navigate the SPA (Perplexity -> /search/<id>, DeepSeek ->
 * /a/chat/s/<id>), which tears down the content script. The navigation
 * listeners cover most of that, but they race the moment the run is recorded
 * as submitted, and webNavigation events are scoped to granted host
 * permissions so an optional-host provider may deliver none at all. Observed
 * live 2026-09-06: DeepSeek delivered and answered while its run sat in
 * 'submitted' with nobody watching.
 *
 * Asking a tab that IS already watching is harmless — it simply re-baselines.
 */
export async function rearmStrandedWatchers(): Promise<void> {
  const [queue, rt] = await Promise.all([getQueue(), getRuntime()]);
  for (const item of queue.items) {
    for (const [providerId, run] of Object.entries(item.runs)) {
      if (run.state !== 'submitted' && run.state !== 'generating') continue;
      const tabId = run.tabId ?? rt.tabs[providerId];
      if (typeof tabId !== 'number') continue;
      await sendCommand(
        tabId,
        command('WATCH', providerId as ProviderId, { promptId: item.id }),
      );
    }
  }
}

export async function scheduleTick(afterMs: number): Promise<void> {
  try {
    await ext.alarms.create(BROADCAST_TICK_ALARM, {
      delayInMinutes: Math.max(afterMs, 30_000) / 60_000,
    });
  } catch {
    // alarms unavailable — the next user action will drive the queue
  }
}

/**
 * Rebuild after a service worker restart (§5.1/§5.2/§5.3).
 *
 * Runs that were mid-send when the worker died are the dangerous ones: the
 * prompt may or may not have reached the page. Each is reconciled against the
 * live DOM instead of being blindly resent.
 */
export async function hydrate(): Promise<void> {
  const state = await getQueue();
  const pending: Command[] = [];

  for (const item of state.items) {
    for (const [providerId, run] of Object.entries(item.runs)) {
      if (isTerminal(run.state)) continue;
      if (run.state === 'inserting' || run.state === 'submitted') {
        if (run.tabId === undefined) continue;
        pending.push({
          kind: 'reconcile',
          promptId: item.id,
          providerId: providerId as ProviderId,
          tabId: run.tabId,
          hash: item.hash,
        });
      }
    }
  }

  await runCommands(pending);
  // A plain tick re-applies timeouts and restarts anything now startable.
  await dispatch({ kind: 'tick' });
}

/**
 * Write a finished broadcast run into the same turn store the tracking half
 * uses, so one dashboard covers both halves (§6 keeps a single record type).
 * Only genuinely measured waits are recorded; a run that never reached the
 * provider has no wait to report.
 */
async function recordBroadcastRun(promptId: string, providerId: ProviderId): Promise<void> {
  const state = await getQueue();
  const item = state.items.find((i) => i.id === promptId);
  const run = item?.runs[providerId];
  if (!item || !run) return;
  if (run.submittedAt === undefined || run.completedAt === undefined) return;

  const totalWaitMs = run.completedAt - run.submittedAt;
  if (totalWaitMs < MIN_VALID_WAIT_MS || totalWaitMs > MAX_VALID_WAIT_MS) return;

  const { saveTurn, recordTurnInSummary } = await import('./storage');
  const turn: Turn = {
    id: `b-${item.id}-${providerId}`,
    schemaVersion: SCHEMA_VERSION,
    platform: providerId,
    model: null,
    mode: 'unknown',
    startedAt: run.submittedAt,
    totalWaitMs,
    ttftMs: run.firstTokenAt !== undefined ? run.firstTokenAt - run.submittedAt : null,
    streamMs: null,
    // The broadcast tabs are background tabs by design, so the whole wait is
    // "not watched". Counting that as attention data would be misleading, so
    // visibility is recorded as unknown-but-hidden rather than invented.
    visibleMs: 0,
    hiddenMs: totalWaitMs,
    focusMs: 0,
    escapeCount: 0,
    bytes: null,
    // 'orphaned' is the existing label for "it started but the end could not
    // be measured", which is exactly a timed-out or failed broadcast run. The
    // dashboard already keeps those out of the headline summaries.
    status: run.state === 'done' ? 'ok' : 'orphaned',
    confidence: 'low',
    signals: ['dom'],
    adapterVersion: `broadcast-${ADAPTER_VERSION}`,
    origin: 'broadcast',
  };
  await saveTurn(turn);
  await recordTurnInSummary(turn);
}

/**
 * Bring the Compare window to the front.
 *
 * Answers arrive in a separate window (§5.20) that is opened unfocused so it
 * never steals focus mid-typing. That is deliberate, but it also means a new
 * user sees nothing happen and assumes the prompt was never sent — the single
 * most confusing thing about the product in testing. The panel offers this as
 * an explicit "Show answers" action.
 */
export async function focusCompareWindow(): Promise<boolean> {
  const rt = await getRuntime();
  if (rt.compareWindowId === undefined) return false;
  try {
    // focused and drawAttention are mutually exclusive in Chrome — passing
    // both makes the call a no-op, so the button appeared to do nothing.
    await ext.windows.update(rt.compareWindowId, { focused: true });
    return true;
  } catch {
    return false; // the user closed it; the next prompt opens a fresh one
  }
}

export async function focusProviderTab(providerId: ProviderId): Promise<void> {
  const state = await getQueue();
  for (const item of state.items) {
    const run = item.runs[providerId];
    if (run?.tabId !== undefined) {
      await focusTab(run.tabId);
      return;
    }
  }
}
