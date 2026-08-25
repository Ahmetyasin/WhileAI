import {
  CLOCK_DRIFT_TOLERANCE_MS,
  CONFIRM_TIMEOUT_MS,
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
  onOpen?: (info: { id: string; startedAt: number; openedBy: SignalType }) => void;
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
  confirmHandle: unknown;
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

  /** Force-close the active turn (e.g. pagehide). */
  forceClose(status: TurnStatus): void {
    if (!this.active) return;
    this.close(status);
  }

  private onStart(type: SignalType): void {
    if (this.active) {
      if (!this.active.startSignals.has(type)) {
        // Another signal source confirming the same turn.
        this.active.startSignals.add(type);
        return;
      }
      // Same source started again: a genuinely overlapping second submit.
      // Spec §2.5: concurrent open turns are all 'ambiguous'.
      this.active.ambiguous = true;
      this.close('ambiguous');
      this.nextIsAmbiguous = true;
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
      confirmHandle: null,
    };
    this.nextIsAmbiguous = false;
    this.opts.onOpen?.({ id, startedAt: this.active.startedAt, openedBy: type });
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
    t.endSignals.add(type);
    if (typeof data.bytes === 'number') t.bytes = data.bytes;
    if (t.endSignals.size >= 2) {
      this.close(undefined); // consensus
    } else {
      this.scheduleConfirm();
    }
  }

  private onError(type: SignalType): void {
    const t = this.active;
    if (!t) return;
    t.errored = true;
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
      if (this.active === t) this.close(undefined);
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

    const perfEnd = this.clock.now();
    const wallEnd = this.clock.wall();
    const totalWaitMs = Math.round(perfEnd - t.perfStart);
    const wallDelta = wallEnd - t.wallStart;

    let status: TurnStatus;
    if (forcedStatus !== undefined) {
      status = forcedStatus;
    } else if (t.ambiguous) {
      status = 'ambiguous';
    } else if (t.aborted) {
      status = 'aborted';
    } else if (totalWaitMs < MIN_VALID_WAIT_MS || totalWaitMs > MAX_VALID_WAIT_MS) {
      status = 'invalid';
    } else if (Math.abs(wallDelta - totalWaitMs) > CLOCK_DRIFT_TOLERANCE_MS) {
      // performance.now() paused (tab slept) — measurement untrustworthy (spec §3.7)
      status = 'invalid';
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
    if (t.errored) confidence = 'low';

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
