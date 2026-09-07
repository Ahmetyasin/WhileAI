/**
 * Re-label stored turns that a newer rule would classify differently.
 *
 * A measurement rule that changes only affects turns recorded afterwards, so
 * records made under the old rule keep their old label forever. That is
 * usually harmless — except when the old label is one the dashboard reports
 * as a PROBLEM.
 *
 * Concretely (2026-09-07): Gemini's periodic background RPCs were recorded as
 * 'invalid', the same status as a genuine measurement failure. Once they were
 * given their own 'noise' status, 484 old records still read as failures and
 * the dashboard announced them beside the answer count, so a working
 * extension looked broken. This re-labels them to match what the current rule
 * would have decided.
 */
import { BACKGROUND_TRAFFIC_MAX_MS, ZERO_DURATION_MAX_MS } from './constants';
import type { Turn } from './types';

/**
 * Would the current rules call this stored turn background noise?
 *
 * Mirrors the TurnTracker's own test deliberately narrowly: only a turn that
 * was brief AND was only ever seen as network traffic. Anything with a button
 * or DOM signal was a real interaction and keeps its status, whatever that is.
 */
export function looksLikeBackgroundNoise(turn: Turn): boolean {
  if (turn.status !== 'invalid') return false;
  // No duration at all — whatever signals it carried, nothing was measured.
  if (turn.totalWaitMs <= ZERO_DURATION_MAX_MS) return true;
  if (turn.totalWaitMs >= BACKGROUND_TRAFFIC_MAX_MS) return false;
  const signals = turn.signals ?? [];
  if (signals.length === 0) return false;
  return signals.every((s) => s === 'network');
}

/**
 * Returns the turns that need re-labelling, with their new status. An empty
 * array means there is nothing to write, so the caller can skip the write
 * entirely rather than rewriting the whole store on every startup.
 */
export function reclassifyTurns(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of turns) {
    if (looksLikeBackgroundNoise(t)) out.push({ ...t, status: 'noise' });
  }
  return out;
}
