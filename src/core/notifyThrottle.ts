/**
 * Stops the same alert being repeated while nothing has changed.
 *
 * The capture path retries a prompt it could not confirm, which is what makes
 * a dropped relay recoverable — but it also means a DELIBERATE block ("Claude
 * is not ready") is re-evaluated on every poll. Without this the user would
 * get the same notification every 30 seconds until they fixed it.
 *
 * Keyed by message, so a genuinely different problem still speaks up at once.
 */
const DEFAULT_QUIET_MS = 5 * 60_000;

export class NotifyThrottle {
  private lastSent = new Map<string, number>();

  constructor(
    private readonly quietMs: number = DEFAULT_QUIET_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Should this message be shown? True the first time, and again only once
   * the quiet period has passed.
   */
  shouldSend(key: string): boolean {
    const last = this.lastSent.get(key);
    const t = this.now();
    if (last !== undefined && t - last < this.quietMs) return false;
    this.lastSent.set(key, t);
    // A tab that stays open for days must not accumulate keys forever.
    if (this.lastSent.size > 50) {
      const oldest = [...this.lastSent.entries()].sort((a, b) => a[1] - b[1])[0];
      if (oldest) this.lastSent.delete(oldest[0]);
    }
    return true;
  }

  /** The condition cleared: the next occurrence should speak up immediately. */
  clear(key: string): void {
    this.lastSent.delete(key);
  }
}
