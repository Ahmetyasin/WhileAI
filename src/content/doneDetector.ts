/**
 * Deciding when an answer is finished (CLAUDE.md §5.11).
 *
 * Extracted from the content script so the policy can be tested without a
 * browser — it was inline, untested, and wrong for fast providers.
 *
 * Two independent witnesses that generation happened:
 *
 *  1. `isGenerating()` — the provider's stop button / streaming marker.
 *  2. The answer text growing past a baseline.
 *
 * Witness 1 alone is not enough. It is a *transient* signal: Perplexity
 * answers fast enough that the stop button can appear and vanish between two
 * polls (observed live 2026-09-06 — present in exactly one 900ms sample). A
 * detector that waits for a signal it already missed never reports DONE, so
 * the provider's lane never frees and the next queued prompt is never
 * delivered. That is the same shape as the Gemini "always generating" bug,
 * only inverted.
 *
 * Growth is the slower-moving witness that covers the gap. Requiring *either*
 * risks calling done early only if the page grew without generating, which the
 * stability window then guards.
 */

export interface DoneDetectorOptions {
  /** Provider says it is streaming right now. */
  isGenerating: () => boolean;
  /** Length of the visible answer text. */
  textLength: () => number;
  /** How long the text must hold still before we call it finished. */
  stableMs?: number;
  /** Growth over the baseline that counts as "an answer appeared". */
  growthThreshold?: number;
  /**
   * How long a still-"generating" provider may report no new text before we
   * stop believing the flag. Generous: a real model can pause mid-answer
   * (tool use, thinking), so this must sit well above a normal gap.
   */
  stalledGeneratingMs?: number;
}

export interface DoneTick {
  done: boolean;
  /** First moment either witness fired — the first-token metric (§5.12). */
  firstTokenAt?: number;
  sawGenerating: boolean;
  sawGrowth: boolean;
}

export class DoneDetector {
  private readonly opts: Required<DoneDetectorOptions>;
  private readonly baseline: number;
  /** Lowest text length seen, so a shrink-then-grow answer still registers. */
  private low: number;
  private lastLen = -1;
  private stableSince = 0;
  /** When the text last changed while the provider claimed to be generating. */
  private genStableSince = 0;
  private sawGenerating = false;
  private sawGrowth = false;
  private firstTokenAt: number | undefined;
  private finished = false;

  constructor(options: DoneDetectorOptions) {
    this.opts = {
      stableMs: 1500,
      growthThreshold: 40,
      stalledGeneratingMs: 20_000,
      ...options,
    } as Required<DoneDetectorOptions>;
    this.baseline = options.textLength();
    this.low = this.baseline;
  }

  /** Feed one observation. `now` is passed in so this stays testable. */
  tick(now: number): DoneTick {
    if (this.finished) return this.snapshot(true);

    const generating = this.opts.isGenerating();
    const len = this.opts.textLength();

    // Track the LOW-WATER mark, not the initial reading. Measured live on
    // Perplexity 2026-09-06: the text shrinks first (the composer clears, and
    // off-screen answers unmount from the virtualised list) and only then
    // grows. Comparing against the initial value alone hid a 471-char answer
    // behind a baseline that had already dropped by 150.
    if (len < this.low) this.low = len;
    if (!this.sawGrowth && len > this.low + this.opts.growthThreshold) {
      this.sawGrowth = true;
      this.firstTokenAt ??= now;
    }
    if (generating) {
      this.sawGenerating = true;
      this.firstTokenAt ??= now;
      // A "generating" signal that never clears is not proof of generating.
      // ChatGPT leaves .result-streaming on a FINISHED answer (observed live
      // 2026-09-06: streaming=true, no stop button, answer complete), so a
      // detector that trusts it unconditionally never reports DONE and the
      // lane never frees. If the answer text has not moved for well past the
      // normal settle window, believe the text, not the flag.
      if (len !== this.lastLen) {
        this.lastLen = len;
        this.genStableSince = now;
      } else if (
        this.genStableSince !== 0 &&
        now - this.genStableSince >= this.opts.stalledGeneratingMs
      ) {
        this.finished = true;
        return this.snapshot(true);
      }
      this.stableSince = 0;
      return this.snapshot(false);
    }

    // Neither witness has fired: the answer has not started yet. Waiting here
    // is correct — it is only wrong to wait on the stop button ALONE.
    if (!this.sawGenerating && !this.sawGrowth) return this.snapshot(false);

    if (len !== this.lastLen) {
      this.lastLen = len;
      this.stableSince = now;
      return this.snapshot(false);
    }
    if (this.stableSince !== 0 && now - this.stableSince >= this.opts.stableMs) {
      this.finished = true;
      return this.snapshot(true);
    }
    return this.snapshot(false);
  }

  private snapshot(done: boolean): DoneTick {
    return {
      done,
      firstTokenAt: this.firstTokenAt,
      sawGenerating: this.sawGenerating,
      sawGrowth: this.sawGrowth,
    };
  }
}
