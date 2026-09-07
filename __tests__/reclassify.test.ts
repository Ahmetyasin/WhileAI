import { describe, expect, it } from 'vitest';
import { looksLikeBackgroundNoise, reclassifyTurns } from '../src/core/reclassify';
import type { Turn } from '../src/core/types';

function turn(over: Partial<Turn>): Turn {
  return {
    id: 't', schemaVersion: 1, platform: 'gemini', model: null, mode: 'standard',
    startedAt: Date.now(), totalWaitMs: 300, ttftMs: null, streamMs: null,
    visibleMs: 0, hiddenMs: 0, focusMs: 0, escapeCount: 0, bytes: null,
    status: 'invalid', confidence: 'high', signals: ['network'],
    adapterVersion: '1.0.0', ...over,
  };
}

describe('looksLikeBackgroundNoise', () => {
  it('recognises a short network-only turn recorded under the old rule', () => {
    // Gemini's periodic RPC: ~270ms, network signal only. 484 of these were
    // stored as 'invalid' and reported as failed measurements (2026-09-07).
    expect(looksLikeBackgroundNoise(turn({ totalWaitMs: 270 }))).toBe(true);
  });

  it('leaves a turn that carried a button signal alone', () => {
    // A real interaction, however brief — its 'invalid' status is meaningful.
    expect(looksLikeBackgroundNoise(turn({ signals: ['network', 'button'], totalWaitMs: 300 }))).toBe(false);
  });

  it('recognises a zero-duration turn whatever signals it carried', () => {
    // Gemini's send handler and a background request in the same tick: 242
    // records of 0-2ms carrying network+button, stored as failed
    // measurements (2026-09-07).
    expect(
      looksLikeBackgroundNoise(turn({ totalWaitMs: 0, signals: ['network', 'button'] })),
    ).toBe(true);
  });

  it('leaves a turn that carried a dom signal alone', () => {
    expect(looksLikeBackgroundNoise(turn({ signals: ['dom'] }))).toBe(false);
  });

  it('leaves a long turn alone even if network-only', () => {
    // Long enough to have been an answer: not noise, so if it was invalid
    // something genuinely went wrong and the user should still see it.
    expect(looksLikeBackgroundNoise(turn({ totalWaitMs: 30_000 }))).toBe(false);
  });

  it('never touches a turn that is not invalid', () => {
    for (const status of ['ok', 'aborted', 'orphaned', 'ambiguous', 'noise'] as const) {
      expect(looksLikeBackgroundNoise(turn({ status }))).toBe(false);
    }
  });

  it('leaves a turn with no signals at all alone', () => {
    expect(looksLikeBackgroundNoise(turn({ signals: [] }))).toBe(false);
  });
});

describe('reclassifyTurns', () => {
  it('returns only the turns that changed', () => {
    const turns = [
      turn({ id: 'noise1', totalWaitMs: 270 }),
      turn({ id: 'real', status: 'ok', totalWaitMs: 5000 }),
      turn({ id: 'genuine-failure', signals: ['network', 'button'] }),
    ];
    const changed = reclassifyTurns(turns);
    expect(changed).toHaveLength(1);
    expect(changed[0]!.id).toBe('noise1');
    expect(changed[0]!.status).toBe('noise');
  });

  it('returns nothing when there is nothing to fix', () => {
    // So a second run is a no-op and startup does not rewrite the store.
    expect(reclassifyTurns([turn({ status: 'ok' })])).toHaveLength(0);
    expect(reclassifyTurns(reclassifyTurns([turn({ totalWaitMs: 270 })]))).toHaveLength(0);
  });

  it('preserves every other field', () => {
    const original = turn({ id: 'x', totalWaitMs: 270, hiddenMs: 42, platform: 'gemini' });
    const [changed] = reclassifyTurns([original]);
    expect(changed).toEqual({ ...original, status: 'noise' });
  });
});
