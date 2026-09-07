import {
  CLOCK_DRIFT_TOLERANCE_MS,
  CONFIRM_TIMEOUT_MS,
  GENERATION_GAP_MAX_MS,
  MAX_VALID_WAIT_MS,
  MIN_VALID_WAIT_MS,
} from './constants';
import type { Confidence, SignalEvent, SignalType, TurnCore, TurnStatus } from './types';

export interface TrackerClock {
  /** monotonic, ms (performance.now) */
  now(): number;
  /** wall clock, ms (Date.now) */
  wall(): number;
}

export interface TurnTrackerOptions {
  clock?: TrackerClock;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  uuid?: () => string;
  /**
   * Platform truth for "is the page still generating right now?" (stop button
   * visible / streaming DOM marker present). Multi-request generations (deep
   * research) end their first network stream long before the answer is done;
   * this predicate keeps the turn open through those gaps.
   */
  isStillGenerating?: () => boolean;
  onOpen?: (info: { id: string; startedAt: number; openedBy: SignalType; resumed: boolean }) => void;
  onClose: (turn: TurnCore) => void;
}

interface ActiveTurn {
  id: string;
  startedAt: number;
  perfStart: number;
  wallStart: number;
  perfFirstToken: number | null;
  startSignals: Set<SignalType>;
  endSignals: Set<SignalType>;
  bytes: number | null;
  ambiguous: boolean;
  aborted: boolean;
  errored: boolean;
  resumed: boolean;
  confirmHandle: unknown;
  /** When the first (earliest) end signal arrived — the real end of the turn.
      The confirmation window must not inflate totalWaitMs. */
  perfEndMark: number | null;
  wallEndMark: number | null;
  /** Monotonic time when the streams ended but the page still claimed to be
      generating. Bounds how long a stuck UI marker can hold a turn open. */
  holdingSincePerf: number | null;
  /** End marks captured at the first hold, so a stuck marker cannot inflate
      the recorded duration beyond the last real stream activity. */
  holdEndMarkPerf: number | null;
  holdEndMarkWall: number | null;
  /** Was the page still generating when the first end signal arrived? */
  generatingAtEnd: boolean | null;
}

const defaultClock: TrackerClock = {
  now: () => performance.now(),
  wall: () => Date.now(),
};

/**
 * Platform-agnostic turn state machine (spec §3.2).
 * First start signal opens the turn; a turn closes on two agreeing end
 * signals, or one end signal plus a confirmation timeout.
 */
export class TurnTracker {
  private opts: Required<Pick<TurnTrackerOptions, 'onClose'>> & TurnTrackerOptions;
  private clock: TrackerClock;
  private active: ActiveTurn | null = null;
  /** next turn inherits ambiguity when an overlap was detected (spec §2.5) */
  private nextIsAmbiguous = false;

  constructor(opts: TurnTrackerOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? defaultClock;
  }

  get hasActiveTurn(): boolean {
    return this.active !== null;
  }

  get activeTurnId(): string | null {
    return this.active?.id ?? null;
  }

  get activeTurnStartedAt(): number | null {
    return this.active?.startedAt ?? null;
  }

  signal(type: SignalType, event: SignalEvent, data: { bytes?: number } = {}): void {
    switch (event) {
      case 'start':
        this.onStart(type);
        break;
      case 'first_token':
        this.onFirstToken();
        break;
      case 'end':
        this.onEnd(type, data);
        break;
      case 'error':
        this.onError(type);
        break;
      case 'abort':
        this.onAbort(type);
        break;
    }
  }

  /**
   * Re-evaluate a turn that is being held open only because the page claims to
   * still be generating. Without this, a stuck UI marker produces no further
   * signals and nothing would ever re-check the hold — the turn (and the live
   * counter) would run forever. Call periodically from the content script.
   */
  tick(): void {
    const t = this.active;
    if (!t || t.holdingSincePerf === null) return;
    if (!this.canHoldOpen(t)) {
      this.close(undefined);
    }
  }

  /** Force-close the active turn (e.g. explicit teardown). */
  forceClose(status: TurnStatus): void {
    if (!this.active) return;
    this.close(status);
  }

  /**
   * Adopt an open turn that survived a page reload (spec §10: deep research
   * must measure correctly even across tab close/reopen). Timing continues on
   * the original wall-clock start; confidence is capped at 'low'.
   */
  resume(open: { id: string; startedAt: number }): void {
    if (this.active) return;
    const elapsed = Math.max(0, this.clock.wall() - open.startedAt);
    this.active = {
      id: open.id,
      startedAt: open.startedAt,
      perfStart: this.clock.now() - elapsed,
      wallStart: open.startedAt,
      perfFirstToken: null,
      startSignals: new Set(),
      endSignals: new Set(),
      bytes: null,
      ambiguous: false,
      aborted: false,
      errored: false,
      resumed: true,
      confirmHandle: null,
      perfEndMark: null,
      wallEndMark: null,
      holdingSincePerf: null,
      holdEndMarkPerf: null,
      holdEndMarkWall: null,
      generatingAtEnd: null,
    };
    this.opts.onOpen?.({ id: open.id, startedAt: open.startedAt, openedBy: 'dom', resumed: true });
  }

  private stillGenerating(): boolean {
    return this.opts.isStillGenerating?.() ?? false;
  }

  /**
   * True while it is still legitimate to keep a turn open because the page
   * reports active generation. Bounded by GENERATION_GAP_MAX_MS so a stuck UI
   * marker (interrupted research, orphaned spinner) cannot hold a turn open
   * forever — the symptom users see as "the counter never stops".
   */
  private canHoldOpen(t: ActiveTurn): boolean {
    if (!this.stillGenerating()) return false;
    const now = this.clock.now();
    if (t.holdingSincePerf === null) {
      t.holdingSincePerf = now;
      // Remember where the real activity ended, in case the hold times out.
      t.holdEndMarkPerf = t.perfEndMark;
      t.holdEndMarkWall = t.wallEndMark;
      return true;
    }
    return now - t.holdingSincePerf <= GENERATION_GAP_MAX_MS;
  }

  /** New stream activity means the generation is genuinely still running. */
  private clearHold(t: ActiveTurn): void {
    t.holdingSincePerf = null;
    t.holdEndMarkPerf = null;
    t.holdEndMarkWall = null;
  }

  private onStart(type: SignalType): void {
    if (this.active) {
      if (!this.active.startSignals.has(type)) {
        // Another signal source confirming the same turn.
        this.active.startSignals.add(type);
        return;
      }
      if (
        this.active.endSignals.size > 0 &&
        !(this.active.generatingAtEnd === true && this.canHoldOpen(this.active))
      ) {
        // The previous turn had already produced an end signal and was only
        // awaiting confirmation, so this start is the user's NEXT prompt —
        // finalize the old turn and open a new one (spec §10).
        //
        // But only when the page says generation has actually STOPPED.
        // Perplexity answers in two phases, search then answer, and the
        // second request opens a few hundred ms after the first stream
        // closes — inside the confirmation window. Treating that as a new
        // prompt split one answer into two turns with the attention stats
        // divided between them (seen live 2026-09-07: two rows, same minute,
        // 26s and 25s). While the stop button is still up it is the same
        // generation, so the hold below owns it.
        this.close(undefined);
      } else if (this.canHoldOpen(this.active)) {
        // Same generation issuing another request (deep research phases,
        // tool-use round-trips). Not a new turn — and real activity, so the
        // stuck-marker timer resets.
        this.clearHold(this.active);
        return;
      } else {
        // A genuinely overlapping second submit with the first still running.
        // Spec §2.5: concurrent open turns are all 'ambiguous'.
        this.active.ambiguous = true;
        this.close('ambiguous');
        this.nextIsAmbiguous = true;
      }
    }
    this.openTurn(type);
  }

  private openTurn(type: SignalType): void {
    const id = this.opts.uuid ? this.opts.uuid() : crypto.randomUUID();
    this.active = {
      id,
      startedAt: this.clock.wall(),
      perfStart: this.clock.now(),
      wallStart: this.clock.wall(),
      perfFirstToken: null,
      startSignals: new Set([type]),
      endSignals: new Set(),
      bytes: null,
      ambiguous: this.nextIsAmbiguous,
      aborted: false,
      errored: false,
      resumed: false,
      confirmHandle: null,
      perfEndMark: null,
      wallEndMark: null,
      holdingSincePerf: null,
      holdEndMarkPerf: null,
      holdEndMarkWall: null,
      generatingAtEnd: null,
    };
    this.nextIsAmbiguous = false;
    this.opts.onOpen?.({ id, startedAt: this.active.startedAt, openedBy: type, resumed: false });
  }

  private onFirstToken(): void {
    if (!this.active) return;
    if (this.active.perfFirstToken === null) {
      this.active.perfFirstToken = this.clock.now();
    }
  }

  private onEnd(type: SignalType, data: { bytes?: number }): void {
    const t = this.active;
    if (!t) return;
    if (t.endSignals.size === 0) {
      t.perfEndMark = this.clock.now();
      t.wallEndMark = this.clock.wall();
      // Was the page still generating when this stream closed? A provider
      // that answers in phases (Perplexity: search, then answer) never drops
      // its stop button between them, so a start arriving now belongs to the
      // SAME answer. A user typing again does so after generation stopped.
      // Captured here because by the time the next start arrives the button
      // is back up either way, making the two indistinguishable.
      t.generatingAtEnd = this.stillGenerating();
    }
    t.endSignals.add(type);
    // Multi-request generations stream in several bodies — sum them.
    if (typeof data.bytes === 'number') t.bytes = (t.bytes ?? 0) + data.bytes;
    if (t.endSignals.size >= 2) {
      if (this.canHoldOpen(t)) {
        // Signals agree the streams ended, but the page still shows active
        // generation (research phase gap). Reset and keep waiting.
        t.endSignals.clear();
        t.perfEndMark = null;
        t.wallEndMark = null;
        return;
      }
      this.close(undefined); // consensus
    } else {
      this.scheduleConfirm();
    }
  }

  private onError(type: SignalType): void {
    const t = this.active;
    if (!t) return;
    t.errored = true;
    if (t.endSignals.size === 0) {
      t.perfEndMark = this.clock.now();
      t.wallEndMark = this.clock.wall();
    }
    t.endSignals.add(type);
    this.scheduleConfirm();
  }

  private onAbort(_type: SignalType): void {
    if (!this.active) return;
    this.active.aborted = true;
    // Network end usually follows immediately; close now with the abort status.
    this.close('aborted');
  }

  private scheduleConfirm(): void {
    const t = this.active;
    if (!t || t.confirmHandle !== null) return;
    const set = this.opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    t.confirmHandle = set(() => {
      if (this.active !== t) return;
      t.confirmHandle = null;
      if (this.canHoldOpen(t)) {
        // Premature end (first request of a multi-request generation). Keep
        // the turn open, but drop only the signal set — the hold timestamps
        // stay, so tick() can retire the turn if the markers never clear.
        t.endSignals.clear();
        t.errored = false;
        return;
      }
      this.close(undefined);
    }, CONFIRM_TIMEOUT_MS);
  }

  private close(forcedStatus: TurnStatus | undefined): void {
    const t = this.active;
    if (!t) return;
    this.active = null;
    if (t.confirmHandle !== null && this.opts.clearTimer) {
      this.opts.clearTimer(t.confirmHandle);
    } else if (t.confirmHandle !== null) {
      clearTimeout(t.confirmHandle as ReturnType<typeof setTimeout>);
    }

    // A confirmation window may separate the real end from this call; use the
    // moment the first end signal arrived when we have one (accuracy over
    // convenience). Forced closes (abort/orphan) use the current time.
    const markPerf = t.perfEndMark ?? t.holdEndMarkPerf;
    const markWall = t.wallEndMark ?? t.holdEndMarkWall;
    const useMark = forcedStatus === undefined && markPerf !== null && markWall !== null;
    const perfEnd = useMark ? (markPerf as number) : this.clock.now();
    const wallEnd = useMark ? (markWall as number) : this.clock.wall();
    let totalWaitMs = Math.round(perfEnd - t.perfStart);
    const wallDelta = wallEnd - t.wallStart;

    let status: TurnStatus;
    let driftDowngraded = false;
    if (forcedStatus !== undefined) {
      status = forcedStatus;
    } else if (t.ambiguous) {
      status = 'ambiguous';
    } else if (t.aborted) {
      status = 'aborted';
    } else if (totalWaitMs < MIN_VALID_WAIT_MS || totalWaitMs > MAX_VALID_WAIT_MS) {
      status = 'invalid';
    } else if (Math.abs(wallDelta - totalWaitMs) > CLOCK_DRIFT_TOLERANCE_MS) {
      // performance.now() pauses while a background tab is throttled, so it
      // disagrees with the wall clock. That used to mean 'invalid', which the
      // dashboard hides — so a user who prompts and switches away (the normal
      // case, and the whole point of measuring waiting) saw nothing recorded.
      // The wall clock is still a sound measure of how long they waited; it
      // is only the precise sub-second timing that is untrustworthy. Keep the
      // turn, mark the confidence low, and use the wall delta.
      totalWaitMs = wallDelta;
      status = 'ok';
      driftDowngraded = true;
    } else {
      status = 'ok';
    }

    let confidence: Confidence;
    if (t.endSignals.size >= 2) {
      confidence = 'high';
    } else if (t.endSignals.has('network') && !t.errored) {
      confidence = 'high';
    } else {
      confidence = 'low';
    }
    if (t.errored || t.resumed || driftDowngraded) confidence = 'low';

    const ttftMs =
      t.perfFirstToken !== null ? Math.round(t.perfFirstToken - t.perfStart) : null;

    const core: TurnCore = {
      id: t.id,
      startedAt: t.startedAt,
      totalWaitMs,
      ttftMs,
      streamMs: ttftMs !== null ? totalWaitMs - ttftMs : null,
      bytes: t.bytes,
      status,
      confidence,
      signals: [...new Set([...t.startSignals, ...t.endSignals])],
    };
    this.opts.onClose(core);
  }
}
