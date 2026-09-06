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

  /**
   * Replays the real Perplexity trace measured live 2026-09-06 (250ms ticks,
   * body.innerText): the stop button was never caught, and the text SHRANK
   * from 615 to 462 before the answer grew. A baseline taken at t=0 never
   * saw growth, so the run stayed 'submitted' and no wait time was recorded.
   */
  it('finishes on the real Perplexity trace: text shrinks, then grows', () => {
    // Second live trace, visible tab: 934 -> 730 (shrink) -> 770 -> 771.
    // The final value is BELOW the opening 934, so a t=0 baseline never sees
    // growth at all — only the low-water mark does.
    const frames = [
      { generating: false, len: 934 },
      { generating: false, len: 730 },   // composer cleared / list unmounted
      { generating: false, len: 789 },
      { generating: false, len: 770 },
      ...Array.from({ length: 12 }, () => ({ generating: false, len: 771 })),
    ];
    expect(run(frames).doneAt).not.toBeNull();
  });

  it('does not mistake a pure shrink for an answer', () => {
    // Text only falls (a page tearing down). Nothing was generated.
    const frames = [
      { generating: false, len: 900 },
      { generating: false, len: 600 },
      ...Array.from({ length: 15 }, () => ({ generating: false, len: 300 })),
    ];
    expect(run(frames).doneAt).toBeNull();
  });

  /**
   * ChatGPT leaves .result-streaming on a FINISHED answer (observed live
   * 2026-09-06: streaming=true, no stop button, answer complete). The run
   * reported 'generating' forever, so DONE never fired and the lane never
   * freed — the same shape as the old Gemini always-generating bug.
   */
  it('stops believing a generating flag that never clears', () => {
    // 250ms ticks: text settles immediately but the flag stays stuck true.
    const frames = [
      { generating: true, len: 100 },
      { generating: true, len: 900 },
      ...Array.from({ length: 120 }, () => ({ generating: true, len: 900 })),
    ];
    const { doneAt } = run(frames);
    expect(doneAt).not.toBeNull();
    // Only after the generous stall window, never during a normal pause.
    expect(doneAt!).toBeGreaterThanOrEqual(20_000);
  });

  it('does not cut off a slow answer that is still producing text', () => {
    // Genuinely streaming: text grows every few ticks for well over the
    // stall window. Must NOT be declared done.
    const frames = Array.from({ length: 150 }, (_, i) => ({
      generating: true, len: 100 + i * 7,
    }));
    expect(run(frames).doneAt).toBeNull();
  });

  it('still never finishes when the page truly produced nothing', () => {
    // Completely static well past every grace window. Nothing was generated,
    // so DONE must not fire — the run should time out instead.
    const frames = Array.from({ length: 200 }, () => ({ generating: false, len: 100 }));
    expect(run(frames).doneAt).toBeNull();
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

/**
 * Re-arming after a navigation (§5.4): the answer node is already full, so
 * neither witness can fire against a fresh baseline. Observed live
 * 2026-09-06 — Perplexity navigates to /search/<id> on submit, which tears
 * down the content script; the re-injected one saw a finished answer, no
 * growth and no generating, and the run sat in 'submitted' forever.
 */
describe('DoneDetector re-armed mid-run', () => {
  it('settles on a finished answer when told the run already started', () => {
    let i = 0;
    const frames = Array.from({ length: 12 }, () => ({ generating: false, len: 900 }));
    const d = new DoneDetector({
      isGenerating: () => frames[i]!.generating,
      textLength: () => frames[i]!.len,
      assumeStarted: true,
    });
    let doneAt: number | null = null;
    for (; i < frames.length; i++) {
      if (d.tick(i * 250).done) { doneAt = i * 250; break; }
    }
    expect(doneAt).not.toBeNull();
  });

  it('without the flag the same page never settles (the bug)', () => {
    let i = 0;
    const frames = Array.from({ length: 12 }, () => ({ generating: false, len: 900 }));
    const d = new DoneDetector({
      isGenerating: () => frames[i]!.generating,
      textLength: () => frames[i]!.len,
    });
    let doneAt: number | null = null;
    for (; i < frames.length; i++) {
      if (d.tick(i * 250).done) { doneAt = i * 250; break; }
    }
    expect(doneAt).toBeNull();
  });
});
