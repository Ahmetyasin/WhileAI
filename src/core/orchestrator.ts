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
import { getBroadcastSettings, getQueue, updateQueue } from './broadcastStorage';
import {
  isTerminal,
  type Command,
  type ProviderId,
  type QueueEvent,
  type QueueState,
} from './broadcastTypes';
import { DEFAULT_POLICY, forgetSettledText, reduce, type QueuePolicy } from './queue';
import { EMBEDDED_CONFIG, getPlatformConfig } from './config';
import { command } from './messages';
import {
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

function providerUrl(providerId: ProviderId): string {
  const cfg = getPlatformConfig(EMBEDDED_CONFIG, providerId);
  return cfg?.newChatUrl ?? `https://${providerId}.com/`;
}

async function runCommand(cmd: Command): Promise<void> {
  switch (cmd.kind) {
    case 'open_tab': {
      const tabId = await getOrCreateProviderTab(cmd.providerId, providerUrl(cmd.providerId));
      if (tabId === null) {
        await dispatch({ kind: 'tab_failed', promptId: cmd.promptId, providerId: cmd.providerId });
        return;
      }
      const alive = await ensureContentScript(tabId, cmd.providerId);
      if (!alive) {
        await forgetProviderTab(cmd.providerId);
        await dispatch({ kind: 'tab_failed', promptId: cmd.promptId, providerId: cmd.providerId });
        return;
      }
      await dispatch({
        kind: 'tab_opened',
        promptId: cmd.promptId,
        providerId: cmd.providerId,
        tabId,
      });
      // The content script reports READY on its own once the composer exists;
      // ask now in case it was already ready before we started listening.
      await sendCommand(tabId, command('GET_STATE', cmd.providerId, {}));
      return;
    }

    case 'insert_and_submit': {
      await ensureContentScript(cmd.tabId, cmd.providerId);
      await sendCommand(
        cmd.tabId,
        command('INSERT_AND_SUBMIT', cmd.providerId, {
          promptId: cmd.promptId,
          text: cmd.text,
        }),
      );
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
      // Wait-time accounting is written by recordBroadcastRun in background.
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

const NOTIFY_TEXT: Record<string, (name: string) => string> = {
  needs_login: (n) => `${n}: you are signed out. Sign in and the prompt will continue.`,
  blocked_challenge: (n) => `${n} is showing a verification check. Solve it, then press Resume.`,
  error: (n) => `${n}: the prompt could not be sent. Copy it from the side panel to send by hand.`,
  timeout: (n) => `${n} took too long and was given up on.`,
};

async function notify(cmd: Extract<Command, { kind: 'notify' }>): Promise<void> {
  const settings = await getBroadcastSettings();
  if (!settings.notifications) return;
  const name = DISPLAY_NAMES[cmd.providerId] ?? cmd.providerId;
  try {
    const granted = await ext.permissions.contains({ permissions: ['notifications'] });
    if (!granted) return;
    await ext.notifications.create(`whileai:${cmd.providerId}:${cmd.level}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'whileAI',
      message: NOTIFY_TEXT[cmd.level]?.(name) ?? `${name}: ${cmd.level}`,
    });
  } catch {
    // notifications are optional; never let them break a run
  }
}

/**
 * chrome.alarms, never setTimeout: a timer longer than the service worker's
 * idle window simply never fires (§5.1). The 30s floor is Chrome's minimum.
 */
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
