/**
 * Free vs premium.
 *
 * The rule the product sells on: broadcasting a prompt to the other AIs is
 * free for the first FREE_BROADCASTS, then it needs a licence. Everything
 * else — the whole dashboard, every metric, the tracking half — stays free
 * forever. Measuring how long you wait is the honest part of the product and
 * putting it behind a paywall would be a bait-and-switch.
 *
 * Pure and storage-free so the rule can be tested exhaustively; the caller
 * supplies the state. See core/licence.ts for where that state comes from.
 */

/** Broadcasts allowed before a licence is required. */
export const FREE_BROADCASTS = 10;

export interface EntitlementState {
  /** Broadcasts the user has already spent. */
  used: number;
  /** A verified, unexpired licence is present. */
  licensed: boolean;
  /**
   * Licence expiry, epoch ms. Undefined for a lifetime licence.
   *
   * Checked against the clock so a subscription that lapsed offline stops
   * working — but see `graceUntil`: a network outage must not lock out
   * someone who has paid.
   */
  expiresAt?: number;
  /**
   * Until when an expired-looking licence is still honoured, epoch ms.
   *
   * A licence check that cannot reach the server must fail OPEN. The
   * alternative punishes a paying user for our downtime, which is both unfair
   * and the fastest way to earn a refund request.
   */
  graceUntil?: number;
}

export type Verdict =
  | { allowed: true; remaining: number | null }
  | { allowed: false; reason: 'limit_reached' | 'expired' };

/**
 * May the user broadcast right now?
 *
 * `remaining` is null for an unlimited (licensed) user, and a count for a
 * free one so the UI can show what is left before it runs out rather than
 * surprising them at zero.
 */
export function canBroadcast(state: EntitlementState, now: number): Verdict {
  if (state.licensed) {
    const expired = state.expiresAt !== undefined && state.expiresAt < now;
    if (!expired) return { allowed: true, remaining: null };
    // Expired — but honour the grace window rather than locking out a payer
    // because a check could not reach the server.
    if (state.graceUntil !== undefined && state.graceUntil > now) {
      return { allowed: true, remaining: null };
    }
    // A lapsed licence falls back to the free allowance rather than to
    // nothing: they can still use the extension, just not without limit.
    if (state.used < FREE_BROADCASTS) {
      return { allowed: true, remaining: FREE_BROADCASTS - state.used };
    }
    return { allowed: false, reason: 'expired' };
  }
  if (state.used < FREE_BROADCASTS) {
    return { allowed: true, remaining: FREE_BROADCASTS - state.used };
  }
  return { allowed: false, reason: 'limit_reached' };
}

/**
 * Does a broadcast of this shape consume an allowance?
 *
 * One prompt is one broadcast however many AIs it reaches — charging per
 * provider would punish the exact behaviour the product exists for. A
 * broadcast that reached nobody costs nothing.
 */
export function countsAgainstAllowance(providersReached: number): boolean {
  return providersReached > 0;
}
