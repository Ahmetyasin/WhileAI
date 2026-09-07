import { describe, expect, it } from 'vitest';
import {
  addTurnToSummary,
  classifyMode,
  dayKey,
  durationBucket,
  deriveMetrics,
  emptySummary,
  formatDuration,
  median,
  percentile,
  turnIntervals,
  waitTotals,
} from '../src/core/metrics';
import type { Turn } from '../src/core/types';

function turn(partial: Partial<Turn>): Turn {
  return {
    id: 't',
    schemaVersion: 1,
    platform: 'chatgpt',
    model: null,
    mode: 'standard',
    startedAt: Date.now(),
    totalWaitMs: 10_000,
    ttftMs: 500,
    streamMs: 9500,
    visibleMs: 8000,
    hiddenMs: 2000,
    focusMs: 7000,
    escapeCount: 1,
    bytes: null,
    status: 'ok',
    confidence: 'high',
    signals: ['network'],
    adapterVersion: '1.0.0',
    ...partial,
  };
}

describe('deriveMetrics', () => {
  it('computes escape rate and true cost', () => {
    const m = deriveMetrics(turn({ totalWaitMs: 10_000, hiddenMs: 4000, escapeCount: 2 }), 180_000);
    expect(m.escapeRate).toBeCloseTo(0.4);
    expect(m.switchCostEstMs).toBe(360_000);
    expect(m.trueCostMs).toBe(370_000);
  });

  it('handles zero wait without dividing by zero', () => {
    const m = deriveMetrics(turn({ totalWaitMs: 0, hiddenMs: 0, escapeCount: 0 }), 180_000);
    expect(m.escapeRate).toBe(0);
    expect(m.trueCostMs).toBe(0);
  });
});

describe('classifyMode — only labels what the platform actually showed', () => {
  it('never invents a mode from duration alone', () => {
    // A slow ordinary answer is not "research"; guessing produced wrong labels.
    expect(classifyMode(5000, false)).toBe('unknown');
    expect(classifyMode(30_000, false)).toBe('unknown');
    expect(classifyMode(300_000, false)).toBe('unknown');
  });
  it('uses the platform indicator when there is one', () => {
    expect(classifyMode(8000, true)).toBe('thinking');
    expect(classifyMode(300_000, true)).toBe('research');
  });
});

describe('durationBucket', () => {
  it('buckets measured waits', () => {
    expect(durationBucket(1200)).toBe('<5s');
    expect(durationBucket(9000)).toBe('5–15s');
    expect(durationBucket(45_000)).toBe('30–60s');
    expect(durationBucket(400_000)).toBe('>5m');
  });
});

describe('median / percentile', () => {
  it('median of odd and even sets', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it('p90', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 90)).toBe(90);
    expect(percentile([5], 90)).toBe(5);
  });
});

describe('daily summary', () => {
  it('folds ok turns and segregates aborted/unmeasured', () => {
    const s = emptySummary();
    addTurnToSummary(s, turn({ totalWaitMs: 10_000, platform: 'chatgpt' }));
    addTurnToSummary(s, turn({ totalWaitMs: 5000, platform: 'claude' }));
    addTurnToSummary(s, turn({ status: 'aborted' }));
    addTurnToSummary(s, turn({ status: 'invalid' }));
    addTurnToSummary(s, turn({ status: 'orphaned' }));
    expect(s.turnCount).toBe(2);
    expect(s.totalWaitMs).toBe(15_000);
    expect(s.abortedCount).toBe(1);
    expect(s.unmeasuredCount).toBe(2);
    expect(s.byPlatform.chatgpt.count).toBe(1);
    expect(s.byPlatform.claude.waitMs).toBe(5000);
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(5300)).toBe('5.3s');
    expect(formatDuration(95_000)).toBe('1m 35s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
    // Units must be derived from one rounded total, never rounded separately:
    // 659_700ms once rendered as the impossible "10m 60s".
    expect(formatDuration(659_700)).toBe('11m 0s');
    expect(formatDuration(59_600)).toBe('1m 0s');
    expect(formatDuration(3_599_600)).toBe('1h 0m');
    expect(formatDuration(10_400)).toBe('10s');
  });
  it('dayKey is local YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 7, 25, 12).getTime())).toBe('2026-08-25');
  });
});

describe('waitTotals: sum vs wall clock (§5.29)', () => {
  it('sum and union agree when waits do not overlap', () => {
    const r = waitTotals([
      { start: 0, end: 1000 },
      { start: 2000, end: 3000 },
    ]);
    expect(r.sumMs).toBe(2000);
    expect(r.unionMs).toBe(2000);
  });

  it('union collapses fully parallel waits to the wall-clock time', () => {
    // Four providers asked at once: four provider-waits, one real wait.
    const r = waitTotals([
      { start: 0, end: 10_000 },
      { start: 0, end: 10_000 },
      { start: 0, end: 10_000 },
      { start: 0, end: 10_000 },
    ]);
    expect(r.sumMs).toBe(40_000);
    expect(r.unionMs).toBe(10_000);
  });

  it('merges partially overlapping waits', () => {
    const r = waitTotals([
      { start: 0, end: 5000 },
      { start: 3000, end: 8000 },
    ]);
    expect(r.sumMs).toBe(10_000);
    expect(r.unionMs).toBe(8000);
  });

  it('handles an interval fully contained in another', () => {
    const r = waitTotals([
      { start: 0, end: 10_000 },
      { start: 2000, end: 4000 },
    ]);
    expect(r.unionMs).toBe(10_000);
  });

  it('ignores empty and negative intervals', () => {
    const r = waitTotals([
      { start: 100, end: 100 },
      { start: 500, end: 200 },
      { start: 0, end: 1000 },
    ]);
    expect(r.unionMs).toBe(1000);
  });

  it('returns zero for no intervals', () => {
    expect(waitTotals([])).toEqual({ sumMs: 0, unionMs: 0 });
  });

  it('turnIntervals keeps only measurable turns', () => {
    const base = {
      schemaVersion: 1, platform: 'chatgpt', model: null, mode: 'unknown' as const,
      ttftMs: null, streamMs: null, visibleMs: 0, hiddenMs: 0, focusMs: 0,
      escapeCount: 0, bytes: null, confidence: 'high' as const, signals: [],
      adapterVersion: 'x',
    };
    const intervals = turnIntervals([
      { ...base, id: 'a', startedAt: 0, totalWaitMs: 1000, status: 'ok' },
      { ...base, id: 'b', startedAt: 0, totalWaitMs: 1000, status: 'aborted' },
      { ...base, id: 'c', startedAt: 0, totalWaitMs: 0, status: 'ok' },
    ]);
    expect(intervals).toEqual([{ start: 0, end: 1000 }]);
  });
});

/**
 * How several tabs and several prompts land on the dashboard. These are the
 * numbers the user reads, so an error here is invisible until it is wrong in
 * a way they notice.
 */
describe('dashboard totals across tabs and providers', () => {
  it('adds up several prompts on the same provider', () => {
    const turns = [3000, 5000, 7000].map((ms, i) =>
      turn({ id: `t${i}`, platform: 'chatgpt', totalWaitMs: ms }),
    );
    const { sumMs } = waitTotals(turnIntervals(turns));
    expect(sumMs).toBe(15_000);
  });

  it('keeps providers separate so a per-AI average is per-AI', () => {
    const turns = [
      turn({ id: 'a', platform: 'chatgpt', totalWaitMs: 2000 }),
      turn({ id: 'b', platform: 'chatgpt', totalWaitMs: 4000 }),
      turn({ id: 'c', platform: 'claude', totalWaitMs: 60_000 }),
    ];
    const byPlatform = new Map<string, number[]>();
    for (const t of turns) {
      const list = byPlatform.get(t.platform) ?? [];
      list.push(t.totalWaitMs);
      byPlatform.set(t.platform, list);
    }
    expect(median(byPlatform.get('chatgpt')!)).toBe(3000);
    expect(median(byPlatform.get('claude')!)).toBe(60_000);
  });

  it('does not double-count a broadcast where every AI answered at once', () => {
    // The whole point of the wall-clock figure (§5.29): five AIs answering in
    // parallel for 10s is 50s of provider time but only 10s of the user's
    // life, and reporting only the sum overstates it fivefold.
    const start = 1_700_000_000_000;
    const turns = ['chatgpt', 'claude', 'gemini', 'perplexity', 'deepseek'].map((p, i) =>
      turn({ id: `p${i}`, platform: p, startedAt: start, totalWaitMs: 10_000 }),
    );
    const { sumMs, unionMs } = waitTotals(turnIntervals(turns));
    expect(sumMs).toBe(50_000);
    expect(unionMs).toBe(10_000);
  });

  it('counts sequential prompts in full, with no parallel discount', () => {
    const start = 1_700_000_000_000;
    const turns = [0, 20_000, 40_000].map((offset, i) =>
      turn({ id: `s${i}`, platform: 'chatgpt', startedAt: start + offset, totalWaitMs: 10_000 }),
    );
    const { sumMs, unionMs } = waitTotals(turnIntervals(turns));
    expect(sumMs).toBe(30_000);
    expect(unionMs).toBe(30_000);
  });

  it('excludes aborted and unmeasured turns from the averages', () => {
    let s = emptySummary();
    s = addTurnToSummary(s, turn({ id: 'ok', totalWaitMs: 4000, status: 'ok' }));
    s = addTurnToSummary(s, turn({ id: 'ab', totalWaitMs: 9999, status: 'aborted' }));
    s = addTurnToSummary(s, turn({ id: 'inv', totalWaitMs: 9999, status: 'invalid' }));
    expect(s.turnCount).toBe(1);
    expect(s.totalWaitMs).toBe(4000);
  });

  it('records a fast answer and a slow one in different buckets', () => {
    expect(durationBucket(300)).not.toBe(durationBucket(240_000));
  });
});
