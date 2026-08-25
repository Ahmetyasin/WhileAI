import { describe, expect, it } from 'vitest';
import { TurnTracker } from '../src/core/TurnTracker';
import type { TurnCore } from '../src/core/types';

/** Deterministic harness: manual clock + manual timers. */
function makeHarness() {
  let perf = 1000;
  let wall = 1_700_000_000_000;
  const timers: { fn: () => void; at: number }[] = [];
  const closed: TurnCore[] = [];
  let uuidCounter = 0;

  const tracker = new TurnTracker({
    clock: { now: () => perf, wall: () => wall },
    setTimer: (fn, ms) => {
      const handle = { fn, at: perf + ms };
      timers.push(handle);
      return handle;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as (typeof timers)[0]);
      if (i >= 0) timers.splice(i, 1);
    },
    uuid: () => `turn-${++uuidCounter}`,
    onClose: (t) => closed.push(t),
  });

  return {
    tracker,
    closed,
    advance(ms: number, opts: { wallOnly?: boolean; perfOnly?: boolean } = {}) {
      if (!opts.wallOnly) perf += ms;
      if (!opts.perfOnly) wall += ms;
      for (const t of [...timers]) {
        if (t.at <= perf) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
    },
  };
}

describe('TurnTracker', () => {
  it('closes with high confidence on two agreeing end signals', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(200);
    h.tracker.signal('network', 'first_token');
    h.advance(4800);
    h.tracker.signal('network', 'end', { bytes: 1234 });
    h.tracker.signal('button', 'end');

    expect(h.closed).toHaveLength(1);
    const t = h.closed[0];
    expect(t.status).toBe('ok');
    expect(t.confidence).toBe('high');
    expect(t.totalWaitMs).toBe(5000);
    expect(t.ttftMs).toBe(200);
    expect(t.streamMs).toBe(4800);
    expect(t.bytes).toBe(1234);
    expect(t.signals).toContain('network');
    expect(t.signals).toContain('button');
  });

  it('closes after confirm timeout on a single end signal', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(3000);
    h.tracker.signal('network', 'end');
    expect(h.closed).toHaveLength(0); // waiting for confirmation
    h.advance(1500);
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0].status).toBe('ok');
    expect(h.closed[0].confidence).toBe('high'); // network alone is trusted
    expect(h.closed[0].totalWaitMs).toBe(4500); // includes confirm window
  });

  it('single non-network end signal closes with low confidence', () => {
    const h = makeHarness();
    h.tracker.signal('dom', 'start');
    h.advance(3000);
    h.tracker.signal('dom', 'end');
    h.advance(1500);
    expect(h.closed[0].confidence).toBe('low');
  });

  it('a second signal source joins the same turn instead of opening a new one', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(50);
    h.tracker.signal('button', 'start'); // same turn, different source
    expect(h.tracker.activeTurnId).toBe('turn-1');
    h.advance(2000);
    h.tracker.signal('network', 'end');
    h.tracker.signal('button', 'end');
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0].signals).toEqual(expect.arrayContaining(['network', 'button']));
  });

  it('marks overlapping turns from the same source as ambiguous (spec §2.5)', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(2000);
    h.tracker.signal('network', 'start'); // second submit mid-flight
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0].status).toBe('ambiguous');
    // the new turn is also tainted
    h.advance(2000);
    h.tracker.signal('network', 'end');
    h.advance(1500);
    expect(h.closed[1].status).toBe('ambiguous');
  });

  it('marks user stop as aborted', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(2000);
    h.tracker.signal('button', 'abort');
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0].status).toBe('aborted');
  });

  it('flags sub-300ms turns as invalid (measurement noise)', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(100);
    h.tracker.signal('network', 'end');
    h.tracker.signal('dom', 'end');
    expect(h.closed[0].status).toBe('invalid');
  });

  it('flags >1h turns as invalid', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(3_700_000);
    h.tracker.signal('network', 'end');
    h.tracker.signal('dom', 'end');
    expect(h.closed[0].status).toBe('invalid');
  });

  it('flags clock drift (tab slept) as invalid (spec §3.7)', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(5000);
    h.advance(60_000, { wallOnly: true }); // wall advances, perf frozen
    h.tracker.signal('network', 'end');
    h.tracker.signal('dom', 'end');
    expect(h.closed[0].status).toBe('invalid');
  });

  it('network error lowers confidence', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(2000);
    h.tracker.signal('network', 'error');
    h.advance(1500);
    expect(h.closed[0].confidence).toBe('low');
  });

  it('forceClose records an orphaned turn', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(2000);
    h.tracker.forceClose('orphaned');
    expect(h.closed[0].status).toBe('orphaned');
    expect(h.tracker.hasActiveTurn).toBe(false);
  });

  it('ignores end/first_token signals with no open turn', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'end');
    h.tracker.signal('dom', 'first_token');
    expect(h.closed).toHaveLength(0);
  });

  it('two sequential fast turns stay separate', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(1000);
    h.tracker.signal('network', 'end');
    h.tracker.signal('dom', 'end');
    h.advance(100);
    h.tracker.signal('network', 'start');
    h.advance(1200);
    h.tracker.signal('network', 'end');
    h.tracker.signal('dom', 'end');
    expect(h.closed).toHaveLength(2);
    expect(h.closed[0].status).toBe('ok');
    expect(h.closed[1].status).toBe('ok');
    expect(h.closed[0].totalWaitMs).toBe(1000);
    expect(h.closed[1].totalWaitMs).toBe(1200);
  });
});
