import {
  CONFIG_REFRESH_ALARM,
  MAX_VALID_WAIT_MS,
  ORPHAN_CHECK_ALARM,
  RETENTION_PRUNE_ALARM,
  SCHEMA_VERSION,
} from '../core/constants';
import { refreshRemoteConfig } from '../core/config';
import {
  appendDebugLog,
  getOpenTurns,
  getSettings,
  pruneOlderThan,
  recordTurnInSummary,
  removeOpenTurn,
  saveTurn,
  setOpenTurn,
  setSelfTest,
  touchPlatformActivity,
} from '../core/storage';
import type { RuntimeMessage, Turn } from '../core/types';
import type { ProviderId } from '../core/broadcastTypes';
import { ext } from '../core/browser';
import { FEATURES } from '../core/features';
import {
  BROADCAST_TICK_ALARM,
  dispatch as broadcastDispatch,
  focusProviderTab,
  hydrate as broadcastHydrate,
} from '../core/orchestrator';
import { handleBroadcastMessage, isBroadcastMessage } from './broadcast';
import { reportHealth } from '../core/adapterHealth';
import {
  PROVIDER_HOSTS,
  TabRegistry,
  providerForUrl,
  shouldDisableProvider,
} from './tabRegistry';

/**
 * MV3 service worker (spec §3.7). Time is measured in the content script; the
 * worker only persists, sweeps orphans, and refreshes remote config.
 */

ext.runtime.onStartup?.addListener?.(() => {
  // Alarms do not fire while the browser is closed, so a machine that is only
  // on during the day could run for weeks on a stale config.
  void refreshRemoteConfig();
});

ext.runtime.onInstalled.addListener(() => {
  void ext.alarms.create(ORPHAN_CHECK_ALARM, { periodInMinutes: 1 });
  // Every 6 hours, not daily: the selector config is the only way to fix a
  // site change without a store review, so it should not be up to 24 hours
  // stale. A failing adapter also forces an immediate refresh (adapterHealth).
  void ext.alarms.create(CONFIG_REFRESH_ALARM, { periodInMinutes: 60 * 6 });
  void ext.alarms.create(RETENTION_PRUNE_ALARM, { periodInMinutes: 60 * 24 });
  void refreshRemoteConfig();
  if (FEATURES.broadcastEnabled) {
    // The toolbar icon opens the popup, which is now the whole UI. The side
    // panel is gone: three of its four settings were either a privacy default
    // that should not be flipped casually, or options for behaviour that is
    // now unconditional, so it was a near-empty page behind an extra click.
  }
});

/**
 * The service worker can be woken for any reason and remembers nothing
 * (§5.1). Rebuilding broadcast state from storage on every start is what makes
 * a mid-flight prompt survive; it also reconciles runs that may have already
 * been sent, so waking up never duplicates a prompt (§5.3).
 */
if (FEATURES.broadcastEnabled) {
  void broadcastHydrate().catch(() => {});
}

ext.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
  // Only this extension's own pages and content scripts may drive the worker.
  if (sender.id !== ext.runtime.id) return false;

  if (FEATURES.broadcastEnabled && isBroadcastMessage(msg)) {
    void handleBroadcastMessage(msg, sender)
      .then((res: unknown) => sendResponse(res ?? { ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  void handleMessage(msg, sender.tab?.id).then(() => sendResponse({ ok: true }));
  return true; // async response
});

async function handleMessage(msg: RuntimeMessage, tabId?: number): Promise<void> {
  switch (msg.kind) {
    case 'turn:open':
      await setOpenTurn(msg.open);
      break;
    case 'turn:heartbeat': {
      const open = await getOpenTurns();
      const entry = open[msg.id];
      if (entry) await setOpenTurn({ ...entry, updatedAt: msg.updatedAt });
      break;
    }
    case 'turn:completed': {
      await removeOpenTurn(msg.turn.id);
      // Stamp the tab here rather than in the content script: the worker is
      // the only side that reliably knows which tab a message came from, and
      // three tabs on the same site are three separate sessions (§8).
      const turn = tabId === undefined ? msg.turn : { ...msg.turn, tabId };
      await saveTurn(turn);
      await recordTurnInSummary(turn);
      await touchPlatformActivity(msg.turn.platform, 'lastTurnAt');
      break;
    }
    case 'turn:pagehide': {
      // Keep the open turn alive so a reloaded page can resume it (deep
      // research survives refresh). The sweep orphans it if nobody does.
      const open = await getOpenTurns();
      const entry = open[msg.id];
      if (entry) {
        await setOpenTurn({ ...entry, updatedAt: Date.now(), snapshot: msg.snapshot });
      }
      break;
    }
    case 'platform:active':
      await touchPlatformActivity(msg.platform, 'lastActiveAt');
      break;
    case 'adapter:selftest':
      await setSelfTest(msg.platform, msg.ok, msg.missing);
      // A failing selector set is the signal that the site changed. Pull fresh
      // selectors immediately instead of waiting for the daily refresh, so a
      // fix reaches users without shipping a new extension (§3.5).
      await reportHealth(msg.platform, msg.ok, msg.missing);
      break;
    case 'debug:log':
      await appendDebugLog(msg.entry);
      break;
  }
}

async function orphanOpenTurn(id: string): Promise<void> {
  const open = await getOpenTurns();
  const entry = open[id];
  if (!entry) return;
  await removeOpenTurn(id);
  const snap = entry.snapshot;
  const totalWaitMs = snap?.totalWaitMs ?? Math.max(0, entry.updatedAt - entry.startedAt);
  const turn: Turn = {
    id: entry.id,
    schemaVersion: SCHEMA_VERSION,
    platform: entry.platform,
    model: null,
    mode: 'unknown',
    startedAt: entry.startedAt,
    totalWaitMs,
    ttftMs: null,
    streamMs: null,
    visibleMs: snap?.visibleMs ?? 0,
    hiddenMs: Math.max(0, totalWaitMs - (snap?.visibleMs ?? 0)),
    focusMs: snap?.focusMs ?? 0,
    escapeCount: snap?.escapeCount ?? 0,
    bytes: null,
    status: 'orphaned',
    confidence: 'low',
    signals: [],
    adapterVersion: 'sw',
  };
  await saveTurn(turn);
  await recordTurnInSummary(turn);
  const settings = await getSettings();
  if (settings.debugLogging) {
    await appendDebugLog({ at: Date.now(), src: 'sw', platform: entry.platform, event: 'orphan', detail: { id, totalWaitMs } });
  }
}

ext.alarms.onAlarm.addListener((alarm) => {
  void onAlarm(alarm.name);
});

async function onAlarm(name: string): Promise<void> {
  switch (name) {
    case ORPHAN_CHECK_ALARM: {
      const open = await getOpenTurns();
      const now = Date.now();
      for (const entry of Object.values(open)) {
        // Live turns heartbeat every 10s. A record that stops beating belongs
        // to a closed or crashed tab: retire it quickly instead of leaving it
        // to inflate the popup's live counter.
        const stale = now - entry.updatedAt > 90_000;
        const overCap = now - entry.startedAt > MAX_VALID_WAIT_MS;
        if (stale || overCap) await orphanOpenTurn(entry.id);
      }
      break;
    }
    case CONFIG_REFRESH_ALARM:
      await refreshRemoteConfig();
      break;
    case RETENTION_PRUNE_ALARM: {
      const settings = await getSettings();
      await pruneOlderThan(settings.retentionDays);
      break;
    }
    case BROADCAST_TICK_ALARM:
      // Re-evaluates timeouts and starts anything whose lane has freed.
      if (FEATURES.broadcastEnabled) {
        await broadcastDispatch({ kind: 'tick' });
        // Safety net for a run whose page navigated away from its watcher
        // (§5.4). The navigation listeners handle the common case; this
        // catches what they race or never see.
        const { rearmStrandedWatchers } = await import('../core/orchestrator');
        await rearmStrandedWatchers().catch(() => {});
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Broadcast wiring (CLAUDE.md §3). Kept in its own block, behind a feature
// flag, so a fault here cannot regress the shipped measurement path.
// ---------------------------------------------------------------------------

// PROVIDER_HOSTS, providerForUrl and the tab registry live in tabRegistry.ts
// so the rules that decide "does closing this tab switch an AI off" can be
// tested directly.

if (FEATURES.broadcastEnabled) {
  // A closed tab must not leave a run waiting forever for a reply.
  // Remember each provider tab's URL while it is open: onRemoved gives only
  // an id, and by then the tab is gone, so a tab the extension never
  // registered (the user's own) could not be attributed to a provider.
  ext.tabs.onUpdated.addListener((tabId, _info, tab) => {
    knownProviderTabs.note(tabId, tab.url);
  });

  ext.tabs.onRemoved.addListener((tabId) => {
    void broadcastDispatch({ kind: 'tick' }).catch(() => {});
    void forgetTab(tabId);
  });

  // §5.4: these sites are SPAs, and submitting can navigate. Perplexity goes
  // from / to /search/<id> the moment a prompt is sent, which tears down the
  // content script — so the run that was just submitted has nothing left
  // watching it and never reports DONE. Observed live 2026-09-06: the answer
  // was on screen while the panel still read "sent".
  //
  // Re-inject after the navigation settles and hand the run back its watcher.
  const reattach = (tabId: number): void => {
    void (async () => {
      const { getRuntime } = await import('../core/broadcastStorage');
      const rt = await getRuntime();
      const hit = Object.entries(rt.tabs).find(([, id]) => id === tabId);
      // Re-inject into the USER's own provider tabs too, not just ours. These
      // sites navigate on submit (Gemini /app -> /app/<id>), which tears down
      // the content script; without this the tab the user actually types in
      // ends up with no script, sees no user message, and nothing is ever
      // relayed. Verified live 2026-09-06: lastUserHash stayed null.
      let providerId: ProviderId | undefined = hit?.[0] as ProviderId | undefined;
      if (providerId === undefined) {
        try {
          const tab = await ext.tabs.get(tabId);
          providerId = providerForUrl(tab.url) ?? undefined;
        } catch {
          return;
        }
      }
      if (providerId === undefined) return; // not a provider tab at all
      const { ensureContentScript, ensureTrackingScript } = await import('../core/tabs');
      // Measurement first, and independently of broadcast: a tab that was
      // already open when the extension loaded had no tracking script, so it
      // was not being measured at all, and a broadcast failure would have
      // taken measurement down with it.
      await ensureTrackingScript(tabId);
      if (!(await ensureContentScript(tabId, providerId))) return;
      // A fresh script has no activePromptId, so a run that was already
      // submitted would have nobody watching for its answer. Re-arm it.
      const { getQueue } = await import('../core/broadcastStorage');
      const q = await getQueue();
      const item = q.items.find((i) => {
        const r = i.runs[providerId];
        return r !== undefined && (r.state === 'submitted' || r.state === 'generating');
      });
      if (item) {
        const { command } = await import('../core/messages');
        const { sendCommand } = await import('../core/tabs');
        await sendCommand(tabId, command('WATCH', providerId, { promptId: item.id }));
      }
      await broadcastDispatch({ kind: 'tick' }).catch(() => {});
    })().catch(() => {});
  };

  ext.webNavigation?.onHistoryStateUpdated?.addListener?.((d: { tabId: number; frameId: number }) => {
    if (d.frameId !== 0) return;
    reattach(d.tabId);
  });
  ext.webNavigation?.onCompleted?.addListener?.((d: { tabId: number; frameId: number }) => {
    if (d.frameId !== 0) return;
    reattach(d.tabId);
  });

  // webNavigation events are scoped to granted host permissions, so for a
  // provider whose host is OPTIONAL (Gemini, DeepSeek) they may never arrive
  // — DeepSeek navigates to /a/chat/s/<id> on submit and its run was left
  // with no watcher. tabs.onUpdated is not host-scoped, so it covers the gap.
  ext.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete' && info.url === undefined) return;
    reattach(tabId);
  });

  // Clicking a failure notification should land the user on the tab that
  // failed — otherwise the alert says "Gemini is signed out" and leaves them
  // to go find Gemini themselves (CLAUDE.md §9). The provider id is the
  // second segment of the notification id.
  ext.notifications?.onClicked?.addListener?.((id: string) => {
    if (!id.startsWith('whileai:')) return;
    const providerId = id.split(':')[1];
    if (!providerId) return;
    void import('../core/orchestrator')
      .then((m) => m.focusProviderTab(providerId as ProviderId))
      .catch(() => {});
    void ext.notifications?.clear?.(id);
  });

  // Poll provider tabs for a newly typed prompt. Chrome throttles a hidden
  // tab's timers and MutationObserver, so a tab the user typed in and then
  // switched away from can sit for a minute before it notices its own new
  // message — and the relay is exactly the case where they DO switch away.
  // The worker is not throttled, so it asks. GET_STATE re-reads the page.
  ext.alarms.create('whileai:capture-poll', { periodInMinutes: 0.5 });
  ext.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'whileai:capture-poll') return;
    // This alarm is the one thing guaranteed to keep firing. The reducer's
    // own tick is only rescheduled while it has work, so once every lane has
    // gone quiet a run whose page navigated away from its watcher (Perplexity,
    // DeepSeek) could sit in 'submitted' forever — seen live 2026-09-07,
    // 109s and counting with no broadcast-tick alarm in existence. Re-arm
    // from here as well; re-arming a tab that is already watching is harmless.
    void import('../core/orchestrator')
      .then((m) => m.rearmStrandedWatchers())
      .catch(() => {});
    void (async () => {
      for (const host of Object.keys(PROVIDER_HOSTS)) {
        try {
          const tabs = await ext.tabs.query({ url: `https://${host}/*` });
          for (const t of tabs) {
            if (t.id === undefined) continue;
            await ext.tabs
              .sendMessage(t.id, {
                v: 1,
                type: 'GET_STATE',
                providerId: PROVIDER_HOSTS[host],
                ts: Date.now(),
              })
              .catch(() => undefined);
          }
        } catch {
          // a host without permission is simply skipped
        }
      }
    })().catch(() => {});
  });

  // Adopt tabs that were ALREADY open when the extension was installed or
  // reloaded. A content script only injects on navigation, so without this
  // the user has to reload every AI tab by hand before anything works — and
  // nothing says so, it just silently does nothing.
  void (async () => {
    for (const host of Object.keys(PROVIDER_HOSTS)) {
      try {
        const tabs = await ext.tabs.query({ url: `https://${host}/*` });
        for (const t of tabs) if (t.id !== undefined) reattach(t.id);
      } catch {
        // a host we lack permission for is simply skipped
      }
    }
  })();
}

/**
 * One-off repair of records made under an older classification rule.
 *
 * Runs once per session and writes nothing when there is nothing to fix, so
 * it costs a single read on a healthy profile. See core/reclassify.ts for why
 * this exists: a rule change left 484 filtered background requests labelled
 * as failed measurements, which the dashboard reported as a problem.
 */
void (async () => {
  try {
    const { getAllTurns, saveTurn } = await import('../core/storage');
    const { reclassifyTurns } = await import('../core/reclassify');
    const changed = reclassifyTurns(await getAllTurns());
    for (const t of changed) await saveTurn(t);
  } catch {
    // Repair is a courtesy; a failure here must never stop the extension.
  }
})();

/**
 * Restore MEASUREMENT in tabs that were already open, independently of
 * broadcast.
 *
 * Deliberately outside the broadcast feature flag: tracking is the half that
 * must always work, and hanging it off `reattach` meant it shared broadcast's
 * fate. It also only ever re-injected the broadcast script, so after an
 * extension update every open AI tab quietly stopped being measured until the
 * user reloaded it (observed 2026-09-07: runs completing while
 * platformActivity had not been touched for hours).
 */
void (async () => {
  for (const host of Object.keys(PROVIDER_HOSTS)) {
    try {
      const tabs = await ext.tabs.query({ url: `https://${host}/*` });
      const { ensureTrackingScript } = await import('../core/tabs');
      for (const t of tabs) if (t.id !== undefined) await ensureTrackingScript(t.id);
    } catch {
      // a host we lack permission for is simply skipped
    }
  }
})();

/**
 * Closing a provider's tab turns that provider OFF.
 *
 * Reopening it on the next prompt was the wrong reading of the user's intent:
 * they closed the tab because they were done with that AI, and having it
 * spring back — with a fresh conversation — is a surprise. Switching the
 * provider off instead is visible in the popup, reversible with one click,
 * and means the next prompt goes only where the user still has tabs open.
 */
async function forgetTab(tabId: number): Promise<void> {
  const { getRuntime, updateRuntime, updateBroadcastSettings } = await import(
    '../core/broadcastStorage'
  );
  const rt = await getRuntime();
  const hit = Object.entries(rt.tabs).find(([, id]) => id === tabId);
  // Either a tab we registered, or one of the user's own that we tracked by
  // URL while it was open. Closing either one means "I am done with this AI".
  const providerId = hit?.[0] ?? knownProviderTabs.get(tabId);
  knownProviderTabs.forget(tabId);
  if (providerId === undefined) return;
  await updateRuntime((r) => {
    const tabs = { ...r.tabs };
    delete tabs[providerId];
    const delivered = { ...(r.delivered ?? {}) };
    delete delivered[String(tabId)];
    return { ...r, tabs, delivered };
  });
  // Only disable when no OTHER tab for this provider is still open: the user
  // may simply have closed one of several.
  try {
    const origin = PROVIDER_ORIGIN_PATTERNS[providerId];
    if (origin !== undefined) {
      // The live query is the authority; the registry can lag behind a tab
      // opened moments ago. onRemoved may fire before or after the tab
      // leaves the results, so the closing tab is excluded either way.
      const remaining = await ext.tabs.query({ url: origin });
      const ids = remaining.map((t) => t.id).filter((id): id is number => id !== undefined);
      if (!shouldDisableProvider(tabId, ids)) return;
    }
    await updateBroadcastSettings((cur) => ({
      ...cur,
      providers: {
        ...cur.providers,
        [providerId]: {
          ...(cur.providers[providerId] ?? { maxWaitMs: 300_000, longMode: false }),
          enabled: false,
        },
      },
    }));
    // Closing the tab has to cancel what was in flight on it, not just switch
    // the provider off. Otherwise the run stays open, goes silent, and
    // surfaces later as an error about a tab the user deliberately closed
    // (reported 2026-09-07: closed DeepSeek, got an error for DeepSeek).
    const { getQueue } = await import('../core/broadcastStorage');
    const q = await getQueue();
    const OPEN = ['queued', 'opening_tab', 'waiting_ready', 'inserting', 'submitted', 'generating'];
    for (const item of q.items) {
      const run = item.runs[providerId as ProviderId];
      if (run !== undefined && OPEN.includes(run.state)) {
        await broadcastDispatch({
          kind: 'cancel',
          promptId: item.id,
          providerId: providerId as ProviderId,
        }).catch(() => {});
      }
    }
  } catch {
    // the tab map is already cleaned up; disabling is best-effort
  }
}

/** tabId -> provider, maintained while the tab is open (see onUpdated). */
const knownProviderTabs = new TabRegistry();

const PROVIDER_ORIGIN_PATTERNS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com/*',
  claude: 'https://claude.ai/*',
  perplexity: 'https://www.perplexity.ai/*',
  gemini: 'https://gemini.google.com/*',
  deepseek: 'https://chat.deepseek.com/*',
};

export { focusProviderTab };
