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
    // The side panel IS the product: it holds the prompt box, the provider
    // list and the queue. It used to be false, which left the toolbar icon
    // opening the 0.4.0 tracking popup and made broadcast unreachable — the
    // extension looked like a dashboard with no way to send anything.
    try {
      void ext.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
    } catch {
      // sidePanel unavailable (older Chrome) — broadcast UI is simply absent
    }
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

if (FEATURES.broadcastEnabled) {
  // A closed tab must not leave a run waiting forever for a reply.
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
      if (!hit) return; // not one of ours
      const providerId = hit[0] as ProviderId;
      const { ensureContentScript } = await import('../core/tabs');
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
}

async function forgetTab(tabId: number): Promise<void> {
  const { getRuntime, updateRuntime } = await import('../core/broadcastStorage');
  const rt = await getRuntime();
  const hit = Object.entries(rt.tabs).find(([, id]) => id === tabId);
  if (!hit) return;
  await updateRuntime((r) => {
    const tabs = { ...r.tabs };
    delete tabs[hit[0]];
    return { ...r, tabs };
  });
}

export { focusProviderTab };
