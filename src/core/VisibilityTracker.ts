import type { VisibilityResult } from './types';

export interface VisibilityTrackerOptions {
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState' | 'hasFocus'>;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
}

/**
 * Accumulates visible / focused time and escape (visible→hidden) transitions
 * during a measurement window (spec §2.2). One instance per page; start() /
 * stop() bracket a single turn.
 */
export class VisibilityTracker {
  private doc: NonNullable<VisibilityTrackerOptions['doc']>;
  private win: NonNullable<VisibilityTrackerOptions['win']>;
  private now: () => number;

  private running = false;
  private lastTs = 0;
  private isVisible = true;
  private isFocused = true;
  private visibleMs = 0;
  private focusMs = 0;
  private escapeCount = 0;

  private onVisibility = () => this.transition();
  private onFocus = () => this.transition(true);
  private onBlur = () => this.transition(false);

  constructor(opts: VisibilityTrackerOptions = {}) {
    this.doc = opts.doc ?? document;
    this.win = opts.win ?? window;
    this.now = opts.now ?? (() => performance.now());
  }

  start(): void {
    if (this.running) this.detach();
    this.running = true;
    this.lastTs = this.now();
    this.isVisible = this.doc.visibilityState === 'visible';
    this.isFocused = this.doc.hasFocus();
    this.visibleMs = 0;
    this.focusMs = 0;
    this.escapeCount = 0;
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.win.addEventListener('focus', this.onFocus);
    this.win.addEventListener('blur', this.onBlur);
  }

  /** Current totals without ending the measurement window (pagehide snapshot). */
  peek(): VisibilityResult {
    if (!this.running) return { visibleMs: 0, focusMs: 0, escapeCount: 0 };
    this.accumulate();
    return {
      visibleMs: Math.round(this.visibleMs),
      focusMs: Math.round(this.focusMs),
      escapeCount: this.escapeCount,
    };
  }

  stop(): VisibilityResult {
    if (!this.running) return { visibleMs: 0, focusMs: 0, escapeCount: 0 };
    this.accumulate();
    this.detach();
    this.running = false;
    return {
      visibleMs: Math.round(this.visibleMs),
      focusMs: Math.round(this.focusMs),
      escapeCount: this.escapeCount,
    };
  }

  private detach(): void {
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.win.removeEventListener('focus', this.onFocus);
    this.win.removeEventListener('blur', this.onBlur);
  }

  private transition(focusOverride?: boolean): void {
    if (!this.running) return;
    this.accumulate();
    const wasVisible = this.isVisible;
    this.isVisible = this.doc.visibilityState === 'visible';
    this.isFocused = focusOverride ?? this.doc.hasFocus();
    if (wasVisible && !this.isVisible) this.escapeCount += 1;
  }

  private accumulate(): void {
    const ts = this.now();
    const delta = ts - this.lastTs;
    this.lastTs = ts;
    if (delta <= 0) return;
    if (this.isVisible) this.visibleMs += delta;
    if (this.isVisible && this.isFocused) this.focusMs += delta;
  }
}
