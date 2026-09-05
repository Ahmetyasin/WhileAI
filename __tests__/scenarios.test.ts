/**
 * End-to-end scenario checks driving the real TurnTracker with a virtual
 * clock, replaying the exact timings the local harness produces.
 */
import { describe, expect, it } from 'vitest';
import { TurnTracker } from '../src/core/TurnTracker';
import type { TurnCore } from '../src/core/types';

/** Virtual clock + timer queue so scenarios run instantly and deterministically. */
function makeHarness(opts: { generating: () => boolean }) {
  let t = 0;
  const timers: { at: number; fn: () => void; h: number }[] = [];
  let h = 0;
  const closed: TurnCore[] = [];
  const opened: string[] = [];

  const tracker = new TurnTracker({
    clock: { now: () => t, wall: () => 1_700_000_000_000 + t },
    setTimer: (fn, ms) => { const id = ++h; timers.push({ at: t + ms, fn, h: id }); return id; },
    clearTimer: (handle) => { const i = timers.findIndex(x => x.h === handle); if (i >= 0) timers.splice(i, 1); },
    uuid: () => `turn-${opened.length + 1}`,
    isStillGenerating: opts.generating,
    onOpen: ({ id }) => { opened.push(id); },
    onClose: (c) => { closed.push(c); },
  });

  /** Advance virtual time, firing timers and ticking like the content script. */
  function advance(ms: number) {
    const target = t + ms;
    for (;;) {
      const due = timers.filter(x => x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      t = due.at;
      due.fn();
      tracker.tick(); // content script polls every 2s
    }
    t = target;
    tracker.tick();
  }
  return { tracker, advance, closed, opened, now: () => t };
}

describe('harness scenarios (real TurnTracker)', () => {
  it('ordinary answer: 800ms TTFT, 5s total -> one ok turn', () => {
    let gen = false;
    const H = makeHarness({ generating: () => gen });
    gen = true;
    H.tracker.signal('network', 'start');
    H.tracker.signal('button', 'start');
    H.advance(800);
    H.tracker.signal('network', 'first_token');
    H.advance(4200);
    gen = false;
    H.tracker.signal('network', 'end', { bytes: 1234 });
    H.tracker.signal('button', 'end');
    H.advance(3000);

    expect(H.closed).toHaveLength(1);
    const turn = H.closed[0]!;
    expect(turn.status).toBe('ok');
    expect(turn.totalWaitMs).toBe(5000);
    expect(turn.ttftMs).toBe(800);
    expect(turn.confidence).toBe('high');
  });

  it('deep research: 3 phases with 3s idle gaps -> ONE turn, not three', () => {
    let gen = true; // stop button stays visible the whole run
    const H = makeHarness({ generating: () => gen });
    H.tracker.signal('network', 'start');
    H.tracker.signal('button', 'start');
    H.advance(500);
    H.tracker.signal('network', 'first_token');

    for (let phase = 0; phase < 3; phase++) {
      H.advance(4000);
      H.tracker.signal('network', 'end', { bytes: 500 });
      if (phase < 2) {
        H.advance(3000);                      // idle gap, page still "generating"
        H.tracker.signal('network', 'start'); // next phase request
      }
    }
    gen = false;
    H.tracker.signal('button', 'end');
    H.advance(3000);

    expect(H.opened).toHaveLength(1);
    expect(H.closed).toHaveLength(1);
    expect(H.closed[0]!.status).toBe('ok');
    expect(H.closed[0]!.totalWaitMs).toBeGreaterThan(18_000);
  });

  it('stuck marker: never-clearing UI marker retires the turn (no runaway counter)', () => {
    const H = makeHarness({ generating: () => true }); // marker never clears
    H.tracker.signal('network', 'start');
    H.advance(500);
    H.tracker.signal('network', 'first_token');
    H.advance(4000);
    H.tracker.signal('network', 'end', { bytes: 900 });

    H.advance(30_000);
    expect(H.closed).toHaveLength(0); // still legitimately held

    H.advance(45_000); // past GENERATION_GAP_MAX_MS (60s)
    expect(H.closed).toHaveLength(1);
    // Duration recorded at last real activity, not the stuck marker.
    expect(H.closed[0]!.totalWaitMs).toBeLessThan(10_000);
    expect(H.tracker.hasActiveTurn).toBe(false);
  });

  it('user aborts with the stop button -> aborted, excluded from summaries', () => {
    let gen = true;
    const H = makeHarness({ generating: () => gen });
    H.tracker.signal('network', 'start');
    H.advance(2000);
    gen = false;
    H.tracker.signal('button', 'abort');
    H.advance(2000);

    expect(H.closed).toHaveLength(1);
    expect(H.closed[0]!.status).toBe('aborted');
  });

  it('two fast consecutive messages stay two separate ok turns', () => {
    let gen = false;
    const H = makeHarness({ generating: () => gen });
    gen = true;
    H.tracker.signal('network', 'start');
    H.advance(3000);
    gen = false;
    H.tracker.signal('network', 'end', { bytes: 100 });
    H.advance(200);              // inside the 1.5s confirm window
    gen = true;
    H.tracker.signal('network', 'start');   // user fires the next prompt
    H.advance(3000);
    gen = false;
    H.tracker.signal('network', 'end', { bytes: 100 });
    H.advance(3000);

    expect(H.closed).toHaveLength(2);
    expect(H.closed.map(c => c.status)).toEqual(['ok', 'ok']);
  });
});
