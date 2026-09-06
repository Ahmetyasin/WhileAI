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

/** Messages the side panel sends (extension pages, not web content). */
export type PanelMessage =
  | { kind: 'broadcast:enqueue'; item: PromptItem }
  | { kind: 'broadcast:event'; event: QueueEvent }
  | { kind: 'broadcast:focus'; providerId: ProviderId }
  | { kind: 'broadcast:show_window' }
  | { kind: 'broadcast:set_source'; tabId: number | null };

export type BroadcastInbound = PanelMessage | { type: string };

/** Tell the user which provider is holding the broadcast back (§5.19). */
async function notifySignedOut(ids: ProviderId[]): Promise<void> {
  const { DISPLAY_NAMES } = await import('../adapters/broadcastTypes');
  const names = ids.map((i) => DISPLAY_NAMES[i] ?? i).join(' and ');
  try {
    const granted = await ext.permissions.contains({ permissions: ['notifications'] });
    if (!granted) return;
    await ext.notifications.create(`whileai:signedout:${ids.join(',')}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'whileAI — nothing sent',
      message: `Sign in to ${names} first. Prompts are held back so your chat histories stay in step.`,
    });
  } catch {
    // notifications are optional; the panel still shows the reason
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
async function signedOutProviders(): Promise<ProviderId[]> {
  const { getBroadcastSettings } = await import('../core/broadcastStorage');
  const settings = await getBroadcastSettings();
  const out: ProviderId[] = [];
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
      })) as { type?: string; composerReady?: boolean } | undefined;
      // Only a definite "no composer" counts. A missing reply means the
      // content script has not loaded yet, which is not a login problem.
      if (res?.type === 'STATE' && res.composerReady === false) {
        out.push(id as ProviderId);
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
      const isOurs = Object.values(rt.tabs).includes(tabId);
      const allowed = pre.captureFromAnyTab
        ? !isOurs && pre.providers[providerId]?.enabled === true
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
      return { ok: true };
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
