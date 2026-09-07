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
  const state = { generating: false };

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
    isStillGenerating: () => state.generating,
    onClose: (t) => closed.push(t),
  });

  return {
    tracker,
    closed,
    state,
    wall: () => wall,
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
    // duration is measured to the end SIGNAL, not to the confirm timeout
    expect(h.closed[0].totalWaitMs).toBe(3000);
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

  /**
   * 100ms used to be treated as measurement noise. Verified live 2026-09-06:
   * Gemini answers a one-word prompt in 100-200ms with a complete and correct
   * signal sequence (submit -> first_token -> end), and filing those as
   * 'invalid' hid them from the dashboard entirely — the provider looked
   * untracked. Only a near-zero duration is noise now.
   */
  it('keeps a genuinely fast answer', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(100);
    h.tracker.signal('network', 'end');
    h.tracker.signal('dom', 'end');
    expect(h.closed[0].status).toBe('ok');
  });

  it('still rejects a zero-length turn as noise', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(10);
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

  /**
   * performance.now() pauses while a background tab is throttled, so it
   * disagrees with the wall clock. Discarding those turns as 'invalid' meant
   * a user who prompts and switches away — the normal case, and the whole
   * reason to measure waiting — saw nothing on the dashboard, which hides
   * anything that is not 'ok'. The wall clock still measures the wait
   * honestly; only the sub-second precision is lost, so the turn is kept at
   * low confidence with the wall-clock duration.
   */
  it('keeps a turn measured across a slept tab, using the wall clock', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(5000);
    h.advance(60_000, { wallOnly: true }); // wall advances, perf frozen
    h.tracker.signal('network', 'end');
    h.tracker.signal('dom', 'end');
    expect(h.closed[0].status).toBe('ok');
    expect(h.closed[0].confidence).toBe('low');
    // The recorded wait is the real elapsed time, not the frozen perf delta.
    expect(h.closed[0].totalWaitMs).toBeGreaterThanOrEqual(60_000);
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

  /**
   * Perplexity answers in two phases — search, then answer — and the second
   * request opens well within the 1500ms confirmation window of the first.
   * The "this is the user's next prompt" branch fired before the
   * still-generating hold was ever consulted, splitting ONE answer into two
   * turns. Seen live 2026-09-07 on the dashboard: two perplexity rows, same
   * minute, 26s and 25s, with the attention stats split across the pair.
   */
  it('keeps one turn when the next request arrives inside the confirm window', () => {
    const h = makeHarness();
    h.state.generating = true; // stop button visible across both phases
    h.tracker.signal('network', 'start');
    h.advance(200);
    h.tracker.signal('network', 'first_token');
    h.advance(3000);
    h.tracker.signal('network', 'end', { bytes: 300 }); // search phase closed
    h.advance(400); // well inside CONFIRM_TIMEOUT_MS
    h.tracker.signal('network', 'start'); // answer phase begins
    expect(h.closed).toHaveLength(0);
    h.advance(5000);
    h.tracker.signal('network', 'end', { bytes: 900 });
    h.state.generating = false;
    h.advance(1500);
    expect(h.closed).toHaveLength(1);
  });

  it('multi-request generation (deep research) stays one turn', () => {
    const h = makeHarness();
    h.state.generating = true; // stop button visible throughout
    // phase 1
    h.tracker.signal('network', 'start');
    h.tracker.signal('button', 'start');
    h.advance(200);
    h.tracker.signal('network', 'first_token');
    h.advance(10_000);
    h.tracker.signal('network', 'end', { bytes: 500 }); // request 1 stream closed
    h.advance(1500); // confirm fires — still generating → stays open
    expect(h.closed).toHaveLength(0);
    expect(h.tracker.hasActiveTurn).toBe(true);
    // idle gap, then phase 2 request from the same generation
    h.advance(30_000);
    h.tracker.signal('network', 'start'); // must NOT open a new turn
    expect(h.tracker.activeTurnId).toBe('turn-1');
    h.advance(60_000);
    h.tracker.signal('network', 'end', { bytes: 700 });
    h.advance(1500); // still generating → stays open again
    expect(h.closed).toHaveLength(0);
    // generation truly finishes
    h.advance(20_000);
    h.state.generating = false;
    h.tracker.signal('network', 'end', { bytes: 300 });
    h.tracker.signal('button', 'end');
    expect(h.closed).toHaveLength(1);
    const t = h.closed[0];
    expect(t.status).toBe('ok');
    expect(t.totalWaitMs).toBe(200 + 10_000 + 1500 + 30_000 + 60_000 + 1500 + 20_000);
    expect(t.ttftMs).toBe(200);
    expect(t.bytes).toBe(1500); // summed across requests
  });

  it('consensus end is ignored while the page still shows generation', () => {
    const h = makeHarness();
    h.state.generating = true;
    h.tracker.signal('network', 'start');
    h.advance(5000);
    h.tracker.signal('network', 'end');
    h.tracker.signal('dom', 'end'); // both ended, but stop button still there
    expect(h.closed).toHaveLength(0);
    h.advance(10_000);
    h.state.generating = false;
    h.tracker.signal('button', 'end');
    h.advance(1500);
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0].totalWaitMs).toBe(15_000); // ends at the button-end signal
  });

  it('tick() closes a held-open turn when no further signals ever arrive', () => {
    // The field bug exactly: after the stream ended, the page kept its
    // "generating" markers and produced NO more signals, so nothing re-checked
    // the hold. The content script's periodic tick must close it.
    const h = makeHarness();
    h.state.generating = true;
    h.tracker.signal('network', 'start');
    h.advance(4000);
    h.tracker.signal('network', 'end', { bytes: 200 });
    h.advance(1500); // confirm fires → hold starts
    expect(h.closed).toHaveLength(0);

    // Simulate the content script's polling loop; no other signals happen.
    // GENERATION_GAP_MAX_MS is 60s, so 40 × 2s comfortably passes it.
    for (let i = 0; i < 40; i++) {
      h.advance(2000);
      h.tracker.tick();
    }
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0].totalWaitMs).toBe(4000); // ends at real stream end
    expect(h.tracker.hasActiveTurn).toBe(false);
  });

  it('tick() leaves a genuinely running turn alone', () => {
    const h = makeHarness();
    h.state.generating = true;
    h.tracker.signal('network', 'start');
    h.advance(5000);
    for (let i = 0; i < 10; i++) {
      h.advance(2000);
      h.tracker.tick(); // no end signal yet → nothing to re-evaluate
    }
    expect(h.closed).toHaveLength(0);
    expect(h.tracker.hasActiveTurn).toBe(true);
  });

  it('a stuck "still generating" marker cannot hold a turn open forever', () => {
    // Reproduces the field bug: the user stopped a research run, the page left
    // its streaming marker in the DOM, and the turn (and the popup's live
    // counter) never stopped.
    const h = makeHarness();
    h.state.generating = true;
    h.tracker.signal('network', 'start');
    h.advance(300);
    h.tracker.signal('network', 'first_token');
    h.advance(9700);
    h.tracker.signal('network', 'end', { bytes: 400 }); // streams done at 10s
    h.advance(1500); // confirm fires, hold begins — marker still stuck
    expect(h.closed).toHaveLength(0);
    h.advance(30_000);
    h.tracker.tick(); // marker still stuck, still inside the budget
    expect(h.closed).toHaveLength(0);
    h.advance(35_000);
    h.tracker.tick(); // past GENERATION_GAP_MAX_MS → retire the turn
    expect(h.closed).toHaveLength(1);
    const t = h.closed[0];
    expect(t.status).toBe('ok');
    // Duration reflects the last real stream activity, not the stuck marker.
    expect(t.totalWaitMs).toBe(10_000);
    expect(h.tracker.hasActiveTurn).toBe(false);
  });

  it('new requests during a long generation keep resetting the stuck-marker timer', () => {
    const h = makeHarness();
    h.state.generating = true;
    h.tracker.signal('network', 'start');
    h.advance(5000);
    h.tracker.signal('network', 'end', { bytes: 100 });
    h.advance(1500);
    h.advance(50_000); // inside the gap budget
    h.tracker.signal('network', 'start'); // phase 2 — genuine activity
    expect(h.closed).toHaveLength(0);
    h.advance(50_000); // budget restarted, so still open
    h.tracker.signal('network', 'end', { bytes: 100 });
    h.state.generating = false;
    h.tracker.signal('button', 'end');
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0].status).toBe('ok');
    expect(h.closed[0].bytes).toBe(200);
  });

  it('abort closes the turn even while the page still claims to generate', () => {
    const h = makeHarness();
    h.state.generating = true; // stop pressed, but the UI marker lingers
    h.tracker.signal('network', 'start');
    h.advance(8000);
    h.tracker.signal('button', 'abort');
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0].status).toBe('aborted');
    expect(h.tracker.hasActiveTurn).toBe(false);
  });

  it('resume() continues a reloaded turn on the original wall clock', () => {
    const h = makeHarness();
    const startedAt = h.wall() - 120_000; // opened 2 minutes ago, pre-reload
    h.tracker.resume({ id: 'old-turn', startedAt });
    expect(h.tracker.activeTurnId).toBe('old-turn');
    h.advance(60_000);
    h.tracker.signal('network', 'end');
    h.tracker.signal('button', 'end');
    expect(h.closed).toHaveLength(1);
    const t = h.closed[0];
    expect(t.id).toBe('old-turn');
    expect(t.status).toBe('ok');
    expect(t.totalWaitMs).toBe(180_000); // 2 min pre-reload + 1 min post
    expect(t.confidence).toBe('low'); // resumed turns are never high-confidence
    expect(t.startedAt).toBe(startedAt);
  });

  it('fast follow-up submit finalizes the ending turn instead of marking ambiguous', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(3000);
    h.tracker.signal('network', 'end'); // wrapping up, confirm pending
    h.advance(500);
    h.tracker.signal('network', 'start'); // user already sent the next message
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0].status).toBe('ok'); // NOT ambiguous
    expect(h.closed[0].totalWaitMs).toBe(3000); // ends at its own end signal
    h.advance(2000);
    h.tracker.signal('network', 'end');
    h.advance(1500);
    expect(h.closed[1].status).toBe('ok');
    expect(h.closed[1].totalWaitMs).toBe(2000);
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

/**
 * Gemini fires many small requests around one answer — telemetry and batch
 * calls of 140-odd bytes each. Seen live 2026-09-07: ONE prompt produced
 * thirty-plus turns, nearly all 0-2ms and filed invalid/ambiguous, because
 * every request opened a turn and the next one closed it. The stop button is
 * absent for most of that window, so canHoldOpen could not merge them.
 *
 * A burst of starts inside the confirm window is one answer, not thirty.
 */
it('does not split one answer into a turn per background request', () => {
  const h = makeHarness();
  h.tracker.signal('network', 'start'); // the real submit
  // A flurry of unrelated requests arriving within milliseconds.
  for (let i = 0; i < 8; i++) {
    h.advance(2);
    h.tracker.signal('network', 'start');
  }
  h.advance(300);
  h.tracker.signal('network', 'first_token');
  h.advance(2000);
  h.tracker.signal('network', 'end', { bytes: 4000 });
  h.advance(1500);
  expect(h.closed).toHaveLength(1);
});

describe('TurnTracker — background traffic', () => {
  it('does not record a short network-only burst as a real answer', () => {
    // Gemini fires a periodic RPC that matches its endpoint pattern: observed
    // live 2026-09-07 at exactly 600s spacing (11:07:42, 11:17:42), 88 of
    // them filed as 'ok' at ~270ms each, dragging the platform average down.
    // A real prompt always leaves a second trace — a send button, a DOM
    // change, or a token stream long enough to be an answer.
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(270);
    h.tracker.signal('network', 'end', { bytes: 140 });
    h.advance(1600);
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0]!.status).toBe('invalid');
  });

  it('keeps a short answer that the user demonstrably asked for', () => {
    // Same duration, but the send button fired: this is a real, fast answer
    // and must survive (Gemini answers one-word prompts in ~200ms).
    const h = makeHarness();
    h.tracker.signal('button', 'start');
    h.advance(270);
    h.tracker.signal('network', 'end', { bytes: 140 });
    h.advance(1600);
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0]!.status).toBe('ok');
  });

  it('keeps a network-only turn once it runs long enough to be an answer', () => {
    const h = makeHarness();
    h.tracker.signal('network', 'start');
    h.advance(3000);
    h.tracker.signal('network', 'end', { bytes: 4000 });
    h.advance(1600);
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0]!.status).toBe('ok');
  });
});
