import { describe, expect, it } from 'vitest';
import {
  addTurnToSummary,
  classifyMode,
  dayKey,
  deriveMetrics,
  emptySummary,
  formatDuration,
  median,
  percentile,
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

describe('classifyMode (spec §2.4)', () => {
  it('labels by thresholds', () => {
    expect(classifyMode(5000, false)).toBe('standard');
    expect(classifyMode(30_000, false)).toBe('thinking');
    expect(classifyMode(300_000, false)).toBe('research');
    expect(classifyMode(0, false)).toBe('unknown');
  });
  it('platform thinking signal wins for short waits', () => {
    expect(classifyMode(8000, true)).toBe('thinking');
    expect(classifyMode(300_000, true)).toBe('research');
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
  });
  it('dayKey is local YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 7, 25, 12).getTime())).toBe('2026-08-25');
  });
});
