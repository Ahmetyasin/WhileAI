import { describe, expect, it } from 'vitest';
import {
  FREE_BROADCASTS,
  canBroadcast,
  countsAgainstAllowance,
  type EntitlementState,
} from '../src/core/entitlement';

const NOW = 1_700_000_000_000;

/**
 * A finite allowance for the tests that exercise the LIMIT.
 *
 * The shipped FREE_BROADCASTS is Infinity — the gate is deliberately off
 * until there is evidence to price against. These tests still pin the rule
 * itself, so that switching it back on is a one-line change rather than a
 * rewrite of untested logic.
 */
const LIMIT = 10;
const state = (over: Partial<EntitlementState> = {}): EntitlementState => ({
  used: 0,
  licensed: false,
  ...over,
});

describe('as shipped — the gate is off', () => {
  it('never blocks anyone, however much they use it', () => {
    // FREE_BROADCASTS is Infinity at launch. This is the behaviour users
    // actually get, so it is tested directly rather than inferred.
    expect(FREE_BROADCASTS).toBe(Number.POSITIVE_INFINITY);
    expect(canBroadcast(state({ used: 100_000 }), NOW).allowed).toBe(true);
  });

  it('does not offer a countdown that would never reach zero', () => {
    // "Infinity of Infinity left" is not a sentence. An unlimited free user
    // must look the same as a licensed one to the UI.
    const v = canBroadcast(state(), NOW);
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.remaining).toBeNull();
  });
});

describe('free tier, with a limit set', () => {
  it('allows the first broadcast', () => {
    expect(canBroadcast(state(), NOW, LIMIT)).toEqual({ allowed: true, remaining: LIMIT });
  });

  it('counts down so the user is not surprised at zero', () => {
    expect(canBroadcast(state({ used: 7 }), NOW, LIMIT)).toEqual({ allowed: true, remaining: 3 });
  });

  it('allows exactly the free allowance and no more', () => {
    expect(canBroadcast(state({ used: LIMIT - 1 }), NOW, LIMIT).allowed).toBe(true);
    expect(canBroadcast(state({ used: LIMIT }), NOW, LIMIT)).toEqual({
      allowed: false,
      reason: 'limit_reached',
    });
  });

  it('stays blocked once over the limit', () => {
    expect(canBroadcast(state({ used: 999 }), NOW, LIMIT).allowed).toBe(false);
  });
});

describe('licensed', () => {
  it('is unlimited', () => {
    expect(canBroadcast(state({ licensed: true, used: 9999 }), NOW)).toEqual({
      allowed: true,
      remaining: null,
    });
  });

  it('stays valid until the expiry passes', () => {
    expect(canBroadcast(state({ licensed: true, expiresAt: NOW + 1000 }), NOW).allowed).toBe(true);
  });

  it('honours a lifetime licence with no expiry', () => {
    expect(canBroadcast(state({ licensed: true }), NOW).allowed).toBe(true);
  });
});

describe('expiry and grace', () => {
  it('keeps working inside the grace window when a check could not run', () => {
    // A licence check that cannot reach the server must fail OPEN: locking
    // out someone who has paid because of our downtime is both unfair and the
    // fastest route to a refund.
    const v = canBroadcast(
      state({ licensed: true, used: 500, expiresAt: NOW - 1000, graceUntil: NOW + 86_400_000 }),
      NOW,
    );
    expect(v).toEqual({ allowed: true, remaining: null });
  });

  it('falls back to the free allowance when a licence lapses', () => {
    // Not to nothing: a lapsed subscriber keeps the same extension a new user
    // would have, rather than being locked out of what was never paid for.
    expect(canBroadcast(state({ licensed: true, used: 2, expiresAt: NOW - 1 }), NOW, LIMIT)).toEqual(
      { allowed: true, remaining: LIMIT - 2 },
    );
  });

  it('blocks a lapsed licence whose free allowance is also spent', () => {
    expect(
      canBroadcast(state({ licensed: true, used: 50, expiresAt: NOW - 1 }), NOW, LIMIT),
    ).toEqual({ allowed: false, reason: 'expired' });
  });

  it('does not extend a licence past a grace window that has also passed', () => {
    expect(
      canBroadcast(
        state({ licensed: true, used: 50, expiresAt: NOW - 2000, graceUntil: NOW - 1000 }),
        NOW,
        LIMIT,
      ).allowed,
    ).toBe(false);
  });

  it('never locks out a lapsed licence while the gate is off', () => {
    // With no limit set, an expired licence costs the user nothing at all.
    expect(canBroadcast(state({ licensed: true, used: 999, expiresAt: NOW - 1 }), NOW).allowed).toBe(
      true,
    );
  });
});

describe('what counts as one broadcast', () => {
  it('charges one prompt once, however many AIs it reached', () => {
    // Charging per provider would punish the exact behaviour the product is
    // for: asking everyone at once.
    expect(countsAgainstAllowance(4)).toBe(true);
    expect(countsAgainstAllowance(1)).toBe(true);
  });

  it('charges nothing for a broadcast that reached nobody', () => {
    // A prompt held back because an AI was signed out never went anywhere.
    expect(countsAgainstAllowance(0)).toBe(false);
  });
});

describe('the gate as the broadcast path uses it', () => {
  // Mirrors the sequence in background/broadcast.ts so the ordering is
  // pinned: check FIRST, count only once the prompt is actually going out.
  function attempt(s: EntitlementState, providersReached: number): {
    sent: boolean;
    used: number;
  } {
    const v = canBroadcast(s, NOW, LIMIT);
    if (!v.allowed) return { sent: false, used: s.used };
    const charged = countsAgainstAllowance(providersReached);
    return { sent: true, used: s.used + (charged ? 1 : 0) };
  }

  it('lets exactly ten free broadcasts through, then stops', () => {
    let s = state();
    let sent = 0;
    for (let i = 0; i < 15; i++) {
      const r = attempt(s, 4);
      if (r.sent) sent++;
      s = { ...s, used: r.used };
    }
    expect(sent).toBe(LIMIT);
  });

  it('does not spend an allowance on a broadcast that reached nobody', () => {
    // Held back because an AI was signed out: nothing was delivered, so
    // charging for it would take a free use for no value.
    const r = attempt(state({ used: 3 }), 0);
    expect(r.sent).toBe(true);
    expect(r.used).toBe(3);
  });

  it('never spends an allowance once the limit is reached', () => {
    const r = attempt(state({ used: LIMIT }), 4);
    expect(r.sent).toBe(false);
    expect(r.used).toBe(LIMIT);
  });

  it('never counts down for a licensed user', () => {
    let s = state({ licensed: true });
    for (let i = 0; i < 50; i++) {
      const r = attempt(s, 4);
      expect(r.sent).toBe(true);
      s = { ...s, used: r.used };
    }
    // Usage is still recorded, but it gates nothing.
    expect(canBroadcast(s, NOW, LIMIT).allowed).toBe(true);
  });
});

describe('price presentation', () => {
  it('describes a one-time price as a one-off', async () => {
    const { PRICE, priceSentence } = await import('../src/core/entitlement');
    // The wording has to follow the pricing model, not be typed twice: a
    // one-time product described as "a month" is the kind of contradiction a
    // buyer notices and a store reviewer flags.
    if (PRICE.kind === 'one_time') expect(priceSentence()).toContain('once');
    else expect(priceSentence()).toContain('month');
  });

  it('quotes the same figure everywhere', async () => {
    const { PRICE, priceSentence } = await import('../src/core/entitlement');
    expect(priceSentence()).toContain(PRICE.display);
    expect(PRICE.display).toContain(String(PRICE.amount));
  });
});
