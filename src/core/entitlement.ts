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

/**
 * Broadcasts allowed before a licence is required.
 *
 * Infinite at launch — the gate below is fully built and tested, but switched
 * off, because there is nothing yet to price. Five separate pieces of
 * research agreed on the shape of this decision (2026-09-07):
 *
 *  - The four FREE competitors that do the same broadcast have 28, 296, 580
 *    and 2,000 installs. That is not a market being fought over; it is one
 *    nobody has shown up for. A price tag before there is demand only buys a
 *    reason not to try it.
 *  - The dashboard is not the sellable half. RescueTime, after seventeen
 *    years and its own private retention data, gives tracking and reports
 *    away FREE and charges for the active features. Rize made the same move.
 *    Their own founders say measurement alone does not hold people.
 *  - Our users are developers — the group WakaTime's founder identified as
 *    least willing to pay for something they could build themselves. He also
 *    raised his price from $5 to $9 and saw no change in conversion: the
 *    people who do not pay do not pay at any price.
 *  - Documented one-time prices that work sit at $60-89, and every one is a
 *    daily-use tool. Nothing in the $5-40 band has a documented success.
 *
 * So the question to answer first is not "how much" but "does anyone still
 * use this in week four". Setting a number now would be answering a question
 * we have no evidence for, and the wrong answer is expensive in both
 * directions: too low anchors us there permanently, too high stops the
 * adoption we need to learn anything.
 *
 * When there IS evidence, this becomes a number again and everything below
 * starts working. Raising a price later is normal; CSS Scan went from $1.99
 * to $120 that way.
 */
export const FREE_BROADCASTS = Number.POSITIVE_INFINITY;

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

/**
 * How many are left, or null when that is not a meaningful thing to say.
 *
 * An unlimited allowance has no countdown: "Infinity of Infinity left" is not
 * a sentence, and the UI already knows how to render null as "unlimited".
 */
function remainingOf(limit: number, used: number): number | null {
  return Number.isFinite(limit) ? limit - used : null;
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
export function canBroadcast(
  state: EntitlementState,
  now: number,
  /**
   * The free allowance. A parameter so the rule can be exercised at a finite
   * limit while the shipped default is unlimited — the gate is off, but it is
   * not untested code waiting to break the day it is switched on.
   */
  limit: number = FREE_BROADCASTS,
): Verdict {
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
    if (state.used < limit) {
      return { allowed: true, remaining: remainingOf(limit, state.used) };
    }
    return { allowed: false, reason: 'expired' };
  }
  if (state.used < limit) {
    return { allowed: true, remaining: remainingOf(limit, state.used) };
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

/**
 * What the paid tier costs, in one place.
 *
 * Kept as data rather than baked into a sentence so the popup, the store
 * listing and any future page all quote the same figure — a price that
 * disagrees with itself across surfaces is the kind of thing a buyer notices
 * and a reviewer flags.
 */
export const PRICE = {
  /** Major units, e.g. 14.99. */
  amount: 3.99,
  currency: 'USD',
  /** How it reads to a buyer. */
  display: '$3.99',
  /** One-time or recurring; the wording in the UI depends on it. */
  kind: 'one_time' as 'one_time' | 'monthly',
};

/** "$3.99 once" / "$3.99 a month" — used wherever the offer is described. */
export function priceSentence(): string {
  return PRICE.kind === 'one_time' ? `${PRICE.display} once` : `${PRICE.display} a month`;
}
