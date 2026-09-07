/**
 * Service-worker side of the broadcast protocol (CLAUDE.md §3.1).
 *
 * Translates messages from content scripts and the side panel into queue
 * events. It never decides scheduling — that is core/queue.ts — and it never
 * trusts a message without validating it first.
 */
import { ext } from '../core/browser';
import { getQueue, getRuntime, updateRuntime } from '../core/broadcastStorage';
import type { PromptItem, ProviderId, QueueEvent } from '../core/broadcastTypes';
import { dispatch, focusCompareWindow, focusProviderTab } from '../core/orchestrator';
import { parseObservation } from '../core/messages';
import { NotifyThrottle } from '../core/notifyThrottle';

/** Messages the side panel sends (extension pages, not web content). */
export type PanelMessage =
  | { kind: 'broadcast:enqueue'; item: PromptItem }
  | { kind: 'broadcast:event'; event: QueueEvent }
  | { kind: 'broadcast:focus'; providerId: ProviderId }
  | { kind: 'broadcast:show_window' }
  | { kind: 'broadcast:set_source'; tabId: number | null };

export type BroadcastInbound = PanelMessage | { type: string };

/**
 * One toast per distinct problem per quiet period. See notifyThrottle.ts: the
 * capture retry means this path is reached repeatedly while a block lasts.
 */
const blockThrottle = new NotifyThrottle();

/** Tell the user which provider is holding the broadcast back (§5.19). */
async function notifySignedOut(blocked: BlockedProvider[]): Promise<void> {
  const { DISPLAY_NAMES } = await import('../adapters/broadcastTypes');
  const ids = blocked.map((b) => b.id);
  const names = ids.map((i) => DISPLAY_NAMES[i] ?? i).join(' and ');
  // "Signed out" is a guess. All we actually observed is a page with no
  // usable composer, and live on 2026-09-07 that was Claude half-rendered
  // with the user perfectly signed in. Say what was seen, not what we infer.
  //
  // A PAUSED conversation gets its own wording: the composer is gone there
  // too, but reloading is exactly the wrong advice — the card survives it and
  // only the user can answer it.
  // Each cause has a DIFFERENT remedy, and giving the wrong one is worse than
  // giving none: "reload that tab" does nothing for a usage limit or a paused
  // conversation. Only say it when every blocked provider shares that cause.
  const allAre = (pick: (b: BlockedProvider) => boolean): boolean =>
    blocked.length > 0 && blocked.every(pick);
  const tail =
    'Prompts are held back so your chat histories stay in step.';
  const message = allAre((b) => b.quota)
    ? `Nothing was sent: ${names} has hit a usage limit. Switch model in that tab, ` +
      `or wait for the reset. ${tail}`
    : allAre((b) => b.paused)
      ? `Nothing was sent: ${names} paused the conversation and is waiting for you. ` +
        `Open that tab and choose how to continue. ${tail}`
      : `Nothing was sent: ${names} is not ready. If you are signed out, sign in; ` +
        `otherwise reload that tab. ${tail}`;

  // Record it BEFORE notifying. This path used to leave no trace at all when
  // a notification was missed — the prompt vanished, the queue stayed empty,
  // and nothing in the UI said why (observed 2026-09-07). The badge is
  // idempotent, so it is refreshed on every attempt.
  try {
    const { recordProblem } = await import('../core/orchestrator');
    for (const id of ids) await recordProblem(id, 'needs_login', message);
  } catch {
    // the notification below is still worth attempting
  }

  // The capture path retries anything it could not confirm, so this is
  // re-reached on every poll while the block persists. The badge should
  // refresh each time; a popup toast every 30 seconds would be noise.
  if (!blockThrottle.shouldSend(message)) return;

  try {
    await ext.notifications.create(`whileai:notready:${ids.join(',')}:${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'whileAI — nothing sent',
      message,
    });
  } catch {
    // notifications can fail; the badge above is the durable record
  }
}

/**
 * Which enabled providers are signed OUT right now.
 *
 * A prompt that lands in some conversations but not others leaves the user's
 * histories out of step, and they only find out later. So a single signed-out
 * provider holds the whole broadcast back rather than half-sending it.
 *
 * A provider with no open tab is NOT counted: the extension will open one and
 * the normal needs_login flow handles it from there. Only a tab that is open
 * and demonstrably shows a login wall blocks the send.
 */
interface BlockedProvider {
  id: ProviderId;
  /** The site paused the conversation; reloading will not clear it. */
  paused: boolean;
  /** A usage limit is blocking it; switching model or waiting is the remedy. */
  quota: boolean;
}

async function signedOutProviders(): Promise<BlockedProvider[]> {
  const { getBroadcastSettings } = await import('../core/broadcastStorage');
  const settings = await getBroadcastSettings();
  const out: BlockedProvider[] = [];
  for (const [id, cfg] of Object.entries(settings.providers)) {
    if (!cfg.enabled) continue;
    const origin = PROVIDER_ORIGINS[id as ProviderId];
    if (!origin) continue;
    try {
      const tabs = await ext.tabs.query({ url: origin });
      if (tabs.length === 0) continue; // no tab yet — not evidence of anything
      const res = (await ext.tabs.sendMessage(tabs[0]!.id as number, {
        v: 1,
        type: 'GET_STATE',
        providerId: id,
        ts: Date.now(),
      })) as
        | { type?: string; composerReady?: boolean; paused?: boolean; quotaWall?: boolean }
        | undefined;
      // Only a definite "no composer" counts. A missing reply means the
      // content script has not loaded yet, which is not a login problem.
      //
      // A usage wall counts too, even with a composer present: Claude's
      // per-model limit leaves the composer in place and only disables the
      // send button, so the provider looked ready, delivery failed, and the
      // user was told nothing at all (2026-09-07).
      if (res?.type === 'STATE' && (res.composerReady === false || res.quotaWall === true)) {
        out.push({
          id: id as ProviderId,
          paused: res.paused === true,
          quota: res.quotaWall === true,
        });
      }
    } catch {
      // no content script yet — say nothing rather than block wrongly
    }
  }
  return out;
}

const PROVIDER_ORIGINS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com/*',
  claude: 'https://claude.ai/*',
  perplexity: 'https://www.perplexity.ai/*',
  gemini: 'https://gemini.google.com/*',
  deepseek: 'https://chat.deepseek.com/*',
};

export function isBroadcastMessage(msg: unknown): msg is BroadcastInbound {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.kind === 'string' && m.kind.startsWith('broadcast:')) return true;
  // Observations from content scripts carry a protocol envelope.
  return m.v === 1 && typeof m.type === 'string';
}

/**
 * Map an observation to the run it belongs to. Content scripts know their
 * provider but not always the prompt id, so the open run on that provider is
 * used when the message does not name one.
 */
async function currentRunFor(providerId: ProviderId): Promise<string | null> {
  const queue = await getQueue();
  for (const item of queue.items) {
    const run = item.runs[providerId];
    if (run && !['done', 'error', 'timeout', 'cancelled', 'needs_login', 'blocked_challenge'].includes(run.state)) {
      return item.id;
    }
  }
  return null;
}

export async function handleBroadcastMessage(
  msg: BroadcastInbound,
  sender: { tab?: { id?: number } },
): Promise<unknown> {
  const m = msg as Record<string, unknown>;

  // ---- Side panel commands ----
  switch (m.kind) {
    case 'broadcast:enqueue': {
      const blocked = await signedOutProviders();
      if (blocked.length > 0) {
        await notifySignedOut(blocked);
        return { ok: false, blocked };
      }
      await dispatch({ kind: 'enqueue', item: m.item as PromptItem });
      return { ok: true };
    }
    case 'broadcast:event':
      await dispatch(m.event as QueueEvent);
      return { ok: true };
    case 'broadcast:focus':
      await focusProviderTab(m.providerId as ProviderId);
      return { ok: true };
    case 'broadcast:show_window':
      return { ok: await focusCompareWindow() };
    case 'broadcast:set_source':
      await setSourceTab((m.tabId as number | null) ?? null);
      return { ok: true };
  }

  // ---- Observations from content scripts ----
  const obs = parseObservation(msg);
  if (!obs) return { ok: false };
  const providerId = obs.providerId;
  const tabId = sender.tab?.id;

  switch (obs.type) {
    case 'READY':
      if (tabId !== undefined) await dispatch({ kind: 'ready', providerId, tabId });
      return { ok: true };

    case 'NOT_LOGGED_IN':
      await dispatch({ kind: 'not_logged_in', providerId });
      return { ok: true };

    case 'CHALLENGE_DETECTED':
      await dispatch({ kind: 'challenge', providerId });
      return { ok: true };

    case 'SUBMITTED': {
      const promptId = obs.promptId ?? (await currentRunFor(providerId));
      if (promptId) await dispatch({ kind: 'submitted', promptId, providerId });
      return { ok: true };
    }

    case 'GENERATING': {
      const promptId = obs.promptId ?? (await currentRunFor(providerId));
      if (promptId) await dispatch({ kind: 'generating', promptId, providerId });
      return { ok: true };
    }

    case 'DONE': {
      const promptId = obs.promptId ?? (await currentRunFor(providerId));
      if (promptId) await dispatch({ kind: 'done', promptId, providerId });
      return { ok: true };
    }

    case 'ERROR': {
      const promptId = obs.promptId ?? (await currentRunFor(providerId));
      if (promptId) {
        await dispatch({
          kind: 'failed',
          promptId,
          providerId,
          code: obs.code,
          detail: obs.detail,
        });
      }
      return { ok: true };
    }

    case 'PROMPT_CAPTURED': {
      // Source capture (§5.13/§5.15): fan the prompt out to every enabled
      // provider except the one it was typed into.
      const rt = await getRuntime();
      if (tabId === undefined) return { ok: true };
      const { getBroadcastSettings } = await import('../core/broadcastStorage');
      const pre = await getBroadcastSettings();
      // Relay from ANY enabled provider's tab, not just one nominated source:
      // the promise is "ask wherever you already are". A tab the extension
      // opened itself is excluded, otherwise a delivered prompt would bounce
      // straight back out to everyone else.
      // Suppress the ECHO, not the tab. A tab becomes "ours" as soon as we
      // adopt it or deliver into it — but the user keeps typing in that same
      // tab, and blocking by tab identity silently killed the relay for
      // every provider they had used before (observed live 2026-09-06).
      // What must not bounce back out is a prompt WE delivered, so compare
      // the hash we last delivered to this tab.
      const deliveredHash = (rt.delivered ?? {})[String(tabId)];
      const isEcho = deliveredHash !== undefined && deliveredHash === obs.hash;
      const allowed = pre.captureFromAnyTab
        ? !isEcho && pre.providers[providerId]?.enabled === true
        : rt.sourceTabId === tabId;
      if (!allowed || !pre.broadcastEnabled) return { ok: true };
      // Same rule as the panel: one signed-out provider holds everything back
      // rather than leaving the user's histories out of step.
      const blockedIds = await signedOutProviders();
      if (blockedIds.length > 0) {
        await notifySignedOut(blockedIds);
        return { ok: true };
      }
      const { makeRun } = await import('../core/queue');
      const settings = await getBroadcastSettings();
      const now = Date.now();
      const runs: PromptItem['runs'] = {};
      for (const [id, cfg] of Object.entries(settings.providers)) {
        if (!cfg.enabled || id === providerId) continue;
        runs[id] = makeRun(id as ProviderId, now);
      }
      if (Object.keys(runs).length === 0) return { ok: true };
      // Adopt the tab the user typed in: register it as this provider's tab
      // and pull it into the whileAI group. Otherwise the next prompt opens a
      // SECOND tab for a provider the user is already sitting in, and their
      // own conversation is left outside the group.
      try {
        const { adoptSourceTab } = await import('../core/tabs');
        await adoptSourceTab(providerId, tabId);
      } catch {
        // adoption is a convenience; delivery must not depend on it
      }
      await dispatch({
        kind: 'enqueue',
        item: {
          id: `p-${now}-${Math.random().toString(36).slice(2, 8)}`,
          text: obs.text,
          hash: obs.hash,
          createdAt: now,
          sourceProviderId: providerId,
          mode: settings.mode,
          runs,
        },
      });
      // `queued: true` tells the content script the prompt is settled. Every
      // other exit from this case returns without it, and the script then
      // releases the hash so a later poll can try again — a capture the
      // worker never acted on must not be lost silently (2026-09-07).
      return { ok: true, queued: true };
    }

    case 'INSERTED':
    case 'STATE':
      return { ok: true };

    default:
      return { ok: true };
  }
}

/**
 * Arm exactly one tab as the capture source (§5.14). The previously armed tab
 * is switched off first, so two tabs on the same site can never both capture
 * and double-send.
 */
export async function setSourceTab(tabId: number | null): Promise<void> {
  const before = await getRuntime();
  if (before.sourceTabId !== undefined && before.sourceTabId !== tabId) {
    await tellTabSourceMode(before.sourceTabId, false);
  }
  await updateRuntime((r) => ({ ...r, sourceTabId: tabId ?? undefined }));
  if (tabId !== null) await tellTabSourceMode(tabId, true);
}

async function tellTabSourceMode(tabId: number, isSource: boolean): Promise<void> {
  try {
    const tab = await ext.tabs.get(tabId);
    const host = tab.url ? new URL(tab.url).hostname : '';
    // The message carries the provider id the content script filters on.
    const providerId = hostToProviderId(host);
    if (!providerId) return;
    const { command } = await import('../core/messages');
    await ext.tabs.sendMessage(tabId, command('SET_SOURCE_MODE', providerId, { isSource }));
  } catch {
    // tab closed, or no content script there — nothing to arm
  }
}

/** Minimal host → provider mapping for messages addressed to a tab. */
function hostToProviderId(host: string): ProviderId | null {
  if (host.endsWith('chatgpt.com')) return 'chatgpt';
  if (host.endsWith('claude.ai')) return 'claude';
  if (host.endsWith('perplexity.ai')) return 'perplexity';
  if (host.endsWith('gemini.google.com')) return 'gemini';
  if (host.endsWith('chat.deepseek.com')) return 'deepseek';
  return null;
}
