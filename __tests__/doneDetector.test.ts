import { describe, expect, it } from 'vitest';
import { DoneDetector } from '../src/content/doneDetector';

/** Drive the detector over a scripted timeline, 250ms per tick. */
function run(
  frames: { generating: boolean; len: number }[],
  step = 250,
): { doneAt: number | null; ticks: number } {
  let i = 0;
  const d = new DoneDetector({
    isGenerating: () => frames[Math.min(i, frames.length - 1)]!.generating,
    textLength: () => frames[Math.min(i, frames.length - 1)]!.len,
  });
  for (; i < frames.length; i++) {
    const r = d.tick(i * step);
    if (r.done) return { doneAt: i * step, ticks: i };
  }
  return { doneAt: null, ticks: frames.length };
}

describe('DoneDetector', () => {
  it('reports done once generation stops and the text holds still', () => {
    const frames = [
      { generating: true, len: 100 },
      { generating: true, len: 400 },
      { generating: false, len: 900 },
      ...Array.from({ length: 10 }, () => ({ generating: false, len: 900 })),
    ];
    expect(run(frames).doneAt).not.toBeNull();
  });

  /**
   * The live Perplexity failure (2026-09-06): the stop button was present in
   * exactly ONE sample and missed by the poll. The old detector required
   * having seen it, so DONE never fired, the lane never freed, and a queued
   * second prompt was never delivered.
   */
  it('still finishes when the stop button is never observed', () => {
    const frames = [
      { generating: false, len: 100 },   // stop button flashed by between polls
      { generating: false, len: 700 },   // but the answer clearly arrived
      { generating: false, len: 1200 },
      ...Array.from({ length: 12 }, () => ({ generating: false, len: 1200 })),
    ];
    const { doneAt } = run(frames);
    expect(doneAt).not.toBeNull();
  });

  it('does not call an unstarted answer finished', () => {
    // Nothing generating, no growth: the provider has not answered yet.
    const frames = Array.from({ length: 20 }, () => ({ generating: false, len: 100 }));
    expect(run(frames).doneAt).toBeNull();
  });

  it('waits through a pause in the middle of a stream', () => {
    const frames = [
      { generating: true, len: 200 },
      { generating: false, len: 600 },   // brief gap between chunks
      { generating: true, len: 900 },    // resumed: must not have finished
      { generating: false, len: 1500 },
      ...Array.from({ length: 10 }, () => ({ generating: false, len: 1500 })),
    ];
    const { doneAt } = run(frames);
    // Finishes only after the LAST burst settles, not during the gap.
    expect(doneAt).not.toBeNull();
    expect(doneAt!).toBeGreaterThan(3 * 250);
  });

  it('records first token from whichever witness fires first', () => {
    // Baseline is sampled at construction, so the text must actually grow.
    let len = 100;
    const d = new DoneDetector({ isGenerating: () => false, textLength: () => len });
    len = 500;
    const r = d.tick(1000);
    expect(r.sawGrowth).toBe(true);
    expect(r.firstTokenAt).toBe(1000);
  });
});
