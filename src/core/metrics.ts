import { RESEARCH_MIN_WAIT_MS } from './constants';
import type { DailySummary, Turn, TurnMode } from './types';

export interface DerivedMetrics {
  escapeRate: number; // hiddenMs / totalWaitMs
  switchCostEstMs: number;
  trueCostMs: number;
}

export function deriveMetrics(turn: Turn, resumePenaltyMs: number): DerivedMetrics {
  const escapeRate = turn.totalWaitMs > 0 ? turn.hiddenMs / turn.totalWaitMs : 0;
  const switchCostEstMs = turn.escapeCount * resumePenaltyMs;
  return {
    escapeRate,
    switchCostEstMs,
    trueCostMs: turn.totalWaitMs + switchCostEstMs,
  };
}

/**
 * Mode label (spec §2.4). Guessing "research" from wait length alone produced
 * wrong labels in the field (a slow normal answer looked like research, and an
 * interrupted research run looked like neither), so a mode is only recorded
 * when the platform itself shows a reasoning/research indicator. Everything
 * else stays 'unknown' rather than carrying an invented label; the dashboard
 * reports measured durations instead.
 */
export function classifyMode(totalWaitMs: number, thinkingSignal: boolean): TurnMode {
  if (thinkingSignal) {
    return totalWaitMs > RESEARCH_MIN_WAIT_MS ? 'research' : 'thinking';
  }
  return 'unknown';
}

/** Duration bucket for a wait — measured fact, no inference. */
export function durationBucket(totalWaitMs: number): string {
  if (totalWaitMs < 5000) return '<5s';
  if (totalWaitMs < 15_000) return '5–15s';
  if (totalWaitMs < 30_000) return '15–30s';
  if (totalWaitMs < 60_000) return '30–60s';
  if (totalWaitMs < 120_000) return '1–2m';
  if (totalWaitMs < 300_000) return '2–5m';
  return '>5m';
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Local-time YYYY-MM-DD key for daily aggregation. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function emptySummary(): DailySummary {
  return {
    totalWaitMs: 0,
    turnCount: 0,
    visibleMs: 0,
    hiddenMs: 0,
    escapeCount: 0,
    abortedCount: 0,
    unmeasuredCount: 0,
    byPlatform: {},
  };
}

/** Fold one turn into a daily summary (mutates and returns the summary). */
export function addTurnToSummary(summary: DailySummary, turn: Turn): DailySummary {
  if (turn.status === 'ok') {
    summary.totalWaitMs += turn.totalWaitMs;
    summary.turnCount += 1;
    summary.visibleMs += turn.visibleMs;
    summary.hiddenMs += turn.hiddenMs;
    summary.escapeCount += turn.escapeCount;
    const p = (summary.byPlatform[turn.platform] ??= { waitMs: 0, count: 0 });
    p.waitMs += turn.totalWaitMs;
    p.count += 1;
  } else if (turn.status === 'aborted') {
    summary.abortedCount += 1;
  } else {
    summary.unmeasuredCount += 1;
  }
  return summary;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const exact = ms / 1000;
  if (exact < 10) return `${exact.toFixed(1)}s`;
  // Round to whole seconds BEFORE splitting into units. Rounding each unit
  // separately produced impossible readings such as "10m 60s" (659.7s floors
  // to 10m, then 59.7s rounds to 60s).
  const totalSec = Math.round(exact);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m ${totalSec % 60}s`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

/**
 * Two honest ways to add up waiting, which broadcast makes diverge (§5.29).
 *
 * Asking four providers at once costs four provider-waits but only one wall
 * clock wait, so reporting the sum alone would tell the user they waited four
 * times longer than they did. `sum` adds every wait; `union` merges
 * overlapping intervals and measures the time actually spent waiting.
 */
export function waitTotals(
  intervals: { start: number; end: number }[],
): { sumMs: number; unionMs: number } {
  let sumMs = 0;
  for (const i of intervals) sumMs += Math.max(0, i.end - i.start);

  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);

  let unionMs = 0;
  let curStart = 0;
  let curEnd = 0;
  let open = false;
  for (const i of sorted) {
    if (!open) {
      curStart = i.start;
      curEnd = i.end;
      open = true;
      continue;
    }
    if (i.start <= curEnd) {
      curEnd = Math.max(curEnd, i.end);
    } else {
      unionMs += curEnd - curStart;
      curStart = i.start;
      curEnd = i.end;
    }
  }
  if (open) unionMs += curEnd - curStart;

  return { sumMs, unionMs };
}

/** Wait intervals of measurable turns, for waitTotals. */
export function turnIntervals(turns: Turn[]): { start: number; end: number }[] {
  return turns
    .filter((t) => t.status === 'ok' && t.totalWaitMs > 0)
    .map((t) => ({ start: t.startedAt, end: t.startedAt + t.totalWaitMs }));
}
