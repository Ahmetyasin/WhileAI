/**
 * Pure queue reducer (CLAUDE.md §3.2, §7). Touches no chrome.* API and reads
 * no clock: `now` is injected so every transition is deterministic in tests,
 * the same discipline TurnTracker uses for its clock.
 *
 *   reduce(state, event, now) => { state, commands }
 *
 * The orchestrator executes the commands. Keeping the decisions here means the
 * whole scheduling policy is unit-testable without a browser.
 */
import {
  isTerminal,
  type Command,
  type ProviderId,
  type PromptItem,
  type ProviderRun,
  type QueueEvent,
  type QueueState,
  type RunState,
} from './broadcastTypes';

export interface QueuePolicy {
  /** Per-provider ceiling before a run is declared timed out (§5.11). */
  maxWaitMs: Record<string, number>;
  defaultMaxWaitMs: number;
  /** Minimum spacing between consecutive sends to one provider (§5.18). */
  minGapMs: number;
  /** No prompt starts until every provider finished the previous one (§3.2). */
  lockstep: boolean;
  /** Automatic retries for 'error' only; login/challenge never retry (§7). */
  maxAttempts: number;
}

export const DEFAULT_POLICY: QueuePolicy = {
  maxWaitMs: {},
  defaultMaxWaitMs: 5 * 60_000,
  minGapMs: 3000,
  lockstep: false,
  maxAttempts: 2,
};

export interface ReduceResult {
  state: QueueState;
  commands: Command[];
}

export const emptyQueue = (): QueueState => ({ items: [] });

// ---- small immutable helpers ----

function mapRun(
  state: QueueState,
  promptId: string,
  providerId: ProviderId,
  fn: (run: ProviderRun) => ProviderRun,
): QueueState {
  return {
    items: state.items.map((item) => {
      if (item.id !== promptId) return item;
      const run = item.runs[providerId];
      if (!run) return item;
      return { ...item, runs: { ...item.runs, [providerId]: fn(run) } };
    }),
  };
}

/** Apply fn to every run of a provider that is not yet terminal. */
function mapProviderRuns(
  state: QueueState,
  providerId: ProviderId,
  fn: (run: ProviderRun, item: PromptItem) => ProviderRun,
): QueueState {
  return {
    items: state.items.map((item) => {
      const run = item.runs[providerId];
      if (!run || isTerminal(run.state)) return item;
      return { ...item, runs: { ...item.runs, [providerId]: fn(run, item) } };
    }),
  };
}

function setState(run: ProviderRun, state: RunState, now: number): ProviderRun {
  const next: ProviderRun = { ...run, state };
  if (state === 'submitted' && run.submittedAt === undefined) next.submittedAt = now;
  if (state === 'generating' && run.firstTokenAt === undefined) next.firstTokenAt = now;
  if (isTerminal(state)) next.completedAt = now;
  return next;
}

export function findRun(
  state: QueueState,
  promptId: string,
  providerId: ProviderId,
): ProviderRun | undefined {
  return state.items.find((i) => i.id === promptId)?.runs[providerId];
}

/** A provider is busy while any of its runs is non-terminal and started. */
function laneBusy(state: QueueState, providerId: ProviderId): boolean {
  return state.items.some((item) => {
    const run = item.runs[providerId];
    return run !== undefined && !isTerminal(run.state) && run.state !== 'queued';
  });
}

/** Last moment this provider finished anything — for the §5.18 spacing rule. */
function lastCompletedAt(state: QueueState, providerId: ProviderId): number {
  let last = 0;
  for (const item of state.items) {
    const run = item.runs[providerId];
    if (run?.completedAt !== undefined && run.completedAt > last) last = run.completedAt;
  }
  return last;
}

/** Lockstep: no run of a later prompt may start until earlier ones settled. */
function lockstepBlocked(state: QueueState, item: PromptItem): boolean {
  for (const earlier of state.items) {
    if (earlier.id === item.id) break;
    if (Object.values(earlier.runs).some((r) => !isTerminal(r.state))) return true;
  }
  return false;
}

/**
 * The scheduler. After every event, walk the queue in FIFO order and start
 * whatever is now allowed to start. Centralising this means no individual
 * event handler has to remember to kick the next run.
 */
function schedule(state: QueueState, policy: QueuePolicy, now: number): ReduceResult {
  const commands: Command[] = [];
  let next = state;
  let earliestRetryGap = Number.POSITIVE_INFINITY;

  for (const item of next.items) {
    if (policy.lockstep && lockstepBlocked(next, item)) continue;

    for (const providerId of Object.keys(item.runs) as ProviderId[]) {
      const run = next.items.find((i) => i.id === item.id)?.runs[providerId];
      if (!run || run.state !== 'queued') continue;
      if (laneBusy(next, providerId)) continue;

      // Human pacing (§5.18): never fire two sends at one provider back to back.
      const since = now - lastCompletedAt(next, providerId);
      if (lastCompletedAt(next, providerId) > 0 && since < policy.minGapMs) {
        earliestRetryGap = Math.min(earliestRetryGap, policy.minGapMs - since);
        continue;
      }

      next = mapRun(next, item.id, providerId, (r) => ({
        ...r,
        state: 'opening_tab',
        startedAt: now,
      }));
      commands.push({ kind: 'open_tab', promptId: item.id, providerId });
    }
  }

  if (earliestRetryGap !== Number.POSITIVE_INFINITY) {
    commands.push({ kind: 'schedule', afterMs: earliestRetryGap });
  }
  return { state: next, commands };
}

/** Time out runs that have been waiting past their provider's ceiling. */
function applyTimeouts(state: QueueState, policy: QueuePolicy, now: number): ReduceResult {
  const commands: Command[] = [];
  let next = state;

  for (const item of state.items) {
    for (const providerId of Object.keys(item.runs) as ProviderId[]) {
      const run = item.runs[providerId];
      if (!run || isTerminal(run.state) || run.state === 'queued') continue;
      const started = run.startedAt ?? run.enqueuedAt;
      const cap = policy.maxWaitMs[providerId] ?? policy.defaultMaxWaitMs;
      if (now - started > cap) {
        next = mapRun(next, item.id, providerId, (r) => setState(r, 'timeout', now));
        commands.push({ kind: 'notify', level: 'timeout', providerId, promptId: item.id });
        commands.push({ kind: 'record_run', promptId: item.id, providerId });
      }
    }
  }
  return { state: next, commands };
}

export function reduce(
  state: QueueState,
  event: QueueEvent,
  now: number,
  policy: QueuePolicy = DEFAULT_POLICY,
): ReduceResult {
  const pre: Command[] = [];
  let next = state;

  switch (event.kind) {
    case 'enqueue': {
      // Dedupe (§5.13): the same prompt hash within a short window is a
      // regenerate/edit/reload echo, not a new request.
      const dupe = state.items.some(
        (i) => i.hash === event.item.hash && now - i.createdAt < 10_000,
      );
      if (dupe) return { state, commands: [] };
      next = { items: [...state.items, event.item] };
      break;
    }

    case 'tab_opened':
      next = mapRun(next, event.promptId, event.providerId, (r) => ({
        ...r,
        state: 'waiting_ready',
        tabId: event.tabId,
      }));
      break;

    case 'tab_failed':
      next = mapRun(next, event.promptId, event.providerId, (r) =>
        setState({ ...r, error: 'tab could not be opened', errorCode: 'TAB_GONE' }, 'error', now),
      );
      pre.push({ kind: 'notify', level: 'error', providerId: event.providerId, promptId: event.promptId });
      break;

    case 'ready': {
      // A usable composer means the block that parked these runs is over
      // (§5.16: the run returns to the queue by itself once the user has
      // signed in). Without this they would sit in needs_login forever and
      // the prompt would be silently lost.
      next = {
        items: next.items.map((item) => {
          const run = item.runs[event.providerId];
          if (!run || (run.state !== 'needs_login' && run.state !== 'blocked_challenge')) {
            return item;
          }
          return {
            ...item,
            runs: {
              ...item.runs,
              [event.providerId]: {
                ...run,
                state: 'queued' as RunState,
                tabId: undefined,
                completedAt: undefined,
              },
            },
          };
        }),
      };

      // The tab announced a usable composer. Send the run that is waiting on it.
      const item = next.items.find((i) => {
        const r = i.runs[event.providerId];
        return (
          (r?.state === 'waiting_ready' || r?.state === 'starting_new_chat') &&
          (r.tabId === undefined || r.tabId === event.tabId)
        );
      });
      if (item && item.runs[event.providerId]?.state === 'waiting_ready' && item.mode === 'new_chat') {
        // newChat() navigates the tab, which tears down the content script, so
        // the prompt cannot be sent in the same batch — it would land on a page
        // that is already unloading. Navigate now; the reloaded page reports
        // READY again and the run resumes from 'starting_new_chat'.
        next = mapRun(next, item.id, event.providerId, (r) => ({
          ...r,
          state: 'starting_new_chat',
          tabId: event.tabId,
        }));
        pre.push({
          kind: 'new_chat',
          promptId: item.id,
          providerId: event.providerId,
          tabId: event.tabId,
        });
        break;
      }
      if (item) {
        // §5.3: mark 'inserting' BEFORE dispatching, so a service worker death
        // between here and the page's confirmation is recoverable rather than
        // silently re-sending.
        next = mapRun(next, item.id, event.providerId, (r) => ({
          ...r,
          state: 'inserting',
          tabId: event.tabId,
          attempts: r.attempts + 1,
        }));
        pre.push({
          kind: 'insert_and_submit',
          promptId: item.id,
          providerId: event.providerId,
          tabId: event.tabId,
          text: item.text,
        });
      }
      break;
    }

    case 'inserted':
      next = mapRun(next, event.promptId, event.providerId, (r) =>
        r.state === 'inserting' ? { ...r, state: 'inserting' } : r,
      );
      break;

    case 'submitted':
      next = mapRun(next, event.promptId, event.providerId, (r) => setState(r, 'submitted', now));
      break;

    case 'generating':
      next = mapRun(next, event.promptId, event.providerId, (r) =>
        r.state === 'submitted' || r.state === 'inserting' ? setState(r, 'generating', now) : r,
      );
      break;

    case 'done':
      next = mapRun(next, event.promptId, event.providerId, (r) =>
        isTerminal(r.state) ? r : setState(r, 'done', now),
      );
      pre.push({ kind: 'record_run', promptId: event.promptId, providerId: event.providerId });
      break;

    case 'not_logged_in':
      // Applies to whichever run is currently occupying the lane; the user has
      // to act, so no retry (§5.16/§7).
      next = mapProviderRuns(next, event.providerId, (r) => setState(r, 'needs_login', now));
      pre.push({ kind: 'notify', level: 'needs_login', providerId: event.providerId });
      break;

    case 'challenge':
      // §5.17: never attempt to solve or wait one out. Stop and tell the user.
      next = mapProviderRuns(next, event.providerId, (r) => setState(r, 'blocked_challenge', now));
      pre.push({ kind: 'notify', level: 'blocked_challenge', providerId: event.providerId });
      break;

    case 'failed': {
      const run = findRun(next, event.promptId, event.providerId);
      const canRetry = run !== undefined && run.attempts < policy.maxAttempts;
      if (canRetry) {
        // One automatic retry, then it belongs to the user (§7).
        next = mapRun(next, event.promptId, event.providerId, (r) => ({
          ...r,
          state: 'queued',
          error: event.detail,
          errorCode: event.code,
          tabId: undefined,
        }));
      } else {
        next = mapRun(next, event.promptId, event.providerId, (r) =>
          setState({ ...r, error: event.detail, errorCode: event.code }, 'error', now),
        );
        pre.push({ kind: 'notify', level: 'error', providerId: event.providerId, promptId: event.promptId });
        pre.push({ kind: 'record_run', promptId: event.promptId, providerId: event.providerId });
      }
      break;
    }

    case 'cancel': {
      const item = next.items.find((i) => i.id === event.promptId);
      if (item) {
        const targets = event.providerId
          ? [event.providerId]
          : (Object.keys(item.runs) as ProviderId[]);
        for (const providerId of targets) {
          const run = item.runs[providerId];
          if (!run || isTerminal(run.state)) continue;
          pre.push({ kind: 'cancel_run', promptId: item.id, providerId, tabId: run.tabId });
          next = mapRun(next, item.id, providerId, (r) => setState(r, 'cancelled', now));
        }
      }
      break;
    }

    case 'cancel_all':
      for (const item of next.items) {
        for (const providerId of Object.keys(item.runs) as ProviderId[]) {
          const run = item.runs[providerId];
          if (!run || isTerminal(run.state)) continue;
          pre.push({ kind: 'cancel_run', promptId: item.id, providerId, tabId: run.tabId });
          next = mapRun(next, item.id, providerId, (r) => setState(r, 'cancelled', now));
        }
      }
      break;

    case 'retry':
      next = mapRun(next, event.promptId, event.providerId, (r) => ({
        ...r,
        state: 'queued',
        attempts: 0, // a manual retry is a fresh start
        tabId: undefined,
        error: undefined,
        errorCode: undefined,
        completedAt: undefined,
      }));
      break;

    case 'reorder': {
      const idx = next.items.findIndex((i) => i.id === event.promptId);
      const swap = event.direction === 'up' ? idx - 1 : idx + 1;
      if (idx >= 0 && swap >= 0 && swap < next.items.length) {
        const items = [...next.items];
        const a = items[idx]!;
        const b = items[swap]!;
        items[idx] = b;
        items[swap] = a;
        next = { items };
      }
      break;
    }

    case 'edit':
      // Only a prompt that has not started anywhere may be edited (§7).
      next = {
        items: next.items.map((item) => {
          if (item.id !== event.promptId) return item;
          const started = Object.values(item.runs).some((r) => r.state !== 'queued');
          if (started) return item;
          return { ...item, text: event.text, hash: event.hash };
        }),
      };
      break;

    case 'clear_finished':
      next = {
        items: next.items.filter((item) =>
          Object.values(item.runs).some((r) => !isTerminal(r.state)),
        ),
      };
      break;

    case 'reconciled': {
      // §5.3: the page already shows this prompt, so the pre-restart send did
      // land. Treat it as submitted instead of sending a duplicate.
      const run = findRun(next, event.promptId, event.providerId);
      if (run) {
        if (event.alreadySent) {
          next = mapRun(next, event.promptId, event.providerId, (r) =>
            setState(r, 'submitted', r.submittedAt ?? now),
          );
        } else {
          next = mapRun(next, event.promptId, event.providerId, (r) => ({
            ...r,
            state: 'queued',
            tabId: undefined,
          }));
        }
      }
      break;
    }

    case 'tick':
      break;

    default: {
      const never: never = event;
      void never;
    }
  }

  const timed = applyTimeouts(next, policy, now);
  const scheduled = schedule(timed.state, policy, now);
  return {
    state: scheduled.state,
    commands: [...pre, ...timed.commands, ...scheduled.commands],
  };
}

/** Convenience for the UI: has everything in this prompt reached a terminal state? */
export function isPromptSettled(item: PromptItem): boolean {
  return Object.values(item.runs).every((r) => isTerminal(r.state));
}

/**
 * Drop the prompt text of finished items (§5.26, and the promise made in
 * PRIVACY.md). The record itself is kept so the queue can still show what ran
 * and for how long; only the content goes. With keepHistory on, nothing is
 * stripped.
 *
 * `graceMs` leaves recently finished prompts intact so "Copy" still works
 * right after a run ends.
 */
export function forgetSettledText(
  state: QueueState,
  now: number,
  keepHistory: boolean,
  graceMs = 5 * 60_000,
): QueueState {
  if (keepHistory) return state;
  let changed = false;
  const items = state.items.map((item) => {
    if (item.text === '') return item;
    if (!isPromptSettled(item)) return item;
    const last = Math.max(
      0,
      ...Object.values(item.runs).map((r) => r.completedAt ?? 0),
    );
    if (last === 0 || now - last < graceMs) return item;
    changed = true;
    return { ...item, text: '' };
  });
  return changed ? { items } : state;
}

export function makeRun(providerId: ProviderId, now: number): ProviderRun {
  return { providerId, state: 'queued', attempts: 0, enqueuedAt: now };
}
