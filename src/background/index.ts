import {
  CONFIG_REFRESH_ALARM,
  MAX_VALID_WAIT_MS,
  ORPHAN_CHECK_ALARM,
  RETENTION_PRUNE_ALARM,
  SCHEMA_VERSION,
} from '../core/constants';
import { refreshRemoteConfig } from '../core/config';
import {
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
import { ext } from '../core/browser';

/**
 * MV3 service worker (spec §3.7). Time is measured in the content script; the
 * worker only persists, sweeps orphans, and refreshes remote config.
 */

ext.runtime.onInstalled.addListener(() => {
  void ext.alarms.create(ORPHAN_CHECK_ALARM, { periodInMinutes: 1 });
  void ext.alarms.create(CONFIG_REFRESH_ALARM, { periodInMinutes: 60 * 24 });
  void ext.alarms.create(RETENTION_PRUNE_ALARM, { periodInMinutes: 60 * 24 });
  void refreshRemoteConfig();
});

ext.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  void handleMessage(msg).then(() => sendResponse({ ok: true }));
  return true; // async response
});

async function handleMessage(msg: RuntimeMessage): Promise<void> {
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
    case 'turn:completed':
      await removeOpenTurn(msg.turn.id);
      await saveTurn(msg.turn);
      await recordTurnInSummary(msg.turn);
      await touchPlatformActivity(msg.turn.platform, 'lastTurnAt');
      break;
    case 'turn:pagehide':
      await orphanOpenTurn(msg.id);
      break;
    case 'platform:active':
      await touchPlatformActivity(msg.platform, 'lastActiveAt');
      break;
    case 'adapter:selftest':
      await setSelfTest(msg.platform, msg.ok, msg.missing);
      break;
  }
}

async function orphanOpenTurn(id: string): Promise<void> {
  const open = await getOpenTurns();
  const entry = open[id];
  if (!entry) return;
  await removeOpenTurn(id);
  const turn: Turn = {
    id: entry.id,
    schemaVersion: SCHEMA_VERSION,
    platform: entry.platform,
    model: null,
    mode: 'unknown',
    startedAt: entry.startedAt,
    totalWaitMs: Math.max(0, entry.updatedAt - entry.startedAt),
    ttftMs: null,
    streamMs: null,
    visibleMs: 0,
    hiddenMs: 0,
    focusMs: 0,
    escapeCount: 0,
    bytes: null,
    status: 'orphaned',
    confidence: 'low',
    signals: [],
    adapterVersion: 'sw',
  };
  await saveTurn(turn);
  await recordTurnInSummary(turn);
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
        // Heartbeats keep long deep-research turns alive; a truly dead turn
        // stops updating and gets orphaned after the hard cap.
        const stale = now - entry.updatedAt > 5 * 60_000;
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
  }
}
