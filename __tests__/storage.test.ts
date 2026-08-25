import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  deleteAllTurns,
  exportCSV,
  exportJSON,
  getAllTurns,
  getSettings,
  getTurnsSince,
  importJSON,
  pruneOlderThan,
  recordTurnInSummary,
  getDailySummaries,
  resetDbCache,
  saveTurn,
  setSettings,
} from '../src/core/storage';
import { dayKey } from '../src/core/metrics';
import type { Turn } from '../src/core/types';
import { clearChromeStorage } from './setup';

function turn(partial: Partial<Turn>): Turn {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    platform: 'chatgpt',
    model: 'gpt-5',
    mode: 'standard',
    startedAt: Date.now(),
    totalWaitMs: 10_000,
    ttftMs: 500,
    streamMs: 9500,
    visibleMs: 8000,
    hiddenMs: 2000,
    focusMs: 7000,
    escapeCount: 1,
    bytes: 2048,
    status: 'ok',
    confidence: 'high',
    signals: ['network', 'button'],
    adapterVersion: '1.0.0',
    ...partial,
  };
}

beforeEach(() => {
  // fresh IndexedDB per test
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  clearChromeStorage();
});

describe('IndexedDB turn store', () => {
  it('saves and reads turns back', async () => {
    const t = turn({});
    await saveTurn(t);
    const all = await getAllTurns();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(t);
  });

  it('queries by startedAt range', async () => {
    const old = turn({ startedAt: Date.now() - 10 * 86_400_000 });
    const recent = turn({ startedAt: Date.now() - 1000 });
    await saveTurn(old);
    await saveTurn(recent);
    const since = await getTurnsSince(Date.now() - 86_400_000);
    expect(since).toHaveLength(1);
    expect(since[0].id).toBe(recent.id);
  });

  it('prunes records older than retention', async () => {
    await saveTurn(turn({ startedAt: Date.now() - 200 * 86_400_000 }));
    await saveTurn(turn({ startedAt: Date.now() }));
    const deleted = await pruneOlderThan(180);
    expect(deleted).toBe(1);
    expect(await getAllTurns()).toHaveLength(1);
  });

  it('deletes all turns', async () => {
    await saveTurn(turn({}));
    await deleteAllTurns();
    expect(await getAllTurns()).toHaveLength(0);
  });
});

describe('export / import', () => {
  it('round-trips JSON', async () => {
    const t1 = turn({});
    const t2 = turn({ platform: 'claude', status: 'aborted' });
    await saveTurn(t1);
    await saveTurn(t2);
    const json = await exportJSON();

    globalThis.indexedDB = new IDBFactory();
    resetDbCache();
    const res = await importJSON(json);
    expect(res.imported).toBe(2);
    expect(res.skipped).toBe(0);
    const all = await getAllTurns();
    expect(all.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
  });

  it('rejects non-Dwell files', async () => {
    await expect(importJSON('{"foo": 1}')).rejects.toThrow('Not a Dwell export');
  });

  it('skips malformed records instead of failing the import', async () => {
    const json = JSON.stringify({
      product: 'dwell',
      schemaVersion: 1,
      exportedAt: Date.now(),
      turns: [turn({}), { garbage: true }],
    });
    const res = await importJSON(json);
    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it('produces CSV with header and escaping', async () => {
    await saveTurn(turn({ model: 'gpt-5, "turbo"' }));
    const csv = await exportCSV();
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,platform,model');
    expect(lines[1]).toContain('"gpt-5, ""turbo"""');
    expect(lines[1]).toContain('network|button');
  });
});

describe('settings & summaries (chrome.storage.local)', () => {
  it('returns defaults and persists patches', async () => {
    const s = await getSettings();
    expect(s.resumePenaltyMs).toBe(180_000);
    expect(s.retentionDays).toBe(180);
    await setSettings({ resumePenaltyMs: 60_000 });
    expect((await getSettings()).resumePenaltyMs).toBe(60_000);
    expect((await getSettings()).retentionDays).toBe(180);
  });

  it('accumulates daily summaries per turn', async () => {
    const t = turn({});
    await recordTurnInSummary(t);
    await recordTurnInSummary(turn({ status: 'invalid' }));
    const summaries = await getDailySummaries();
    const today = summaries[dayKey(Date.now())];
    expect(today.turnCount).toBe(1);
    expect(today.totalWaitMs).toBe(10_000);
    expect(today.unmeasuredCount).toBe(1);
  });
});
