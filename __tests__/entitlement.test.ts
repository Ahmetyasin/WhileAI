import { describe, expect, it } from 'vitest';
import {
  FREE_BROADCASTS,
  canBroadcast,
  countsAgainstAllowance,
  type EntitlementState,
} from '../src/core/entitlement';

const NOW = 1_700_000_000_000;
const state = (over: Partial<EntitlementState> = {}): EntitlementState => ({
  used: 0,
  licensed: false,
  ...over,
});

describe('free tier', () => {
  it('allows the first broadcast', () => {
    expect(canBroadcast(state(), NOW)).toEqual({ allowed: true, remaining: FREE_BROADCASTS });
  });

  it('counts down so the user is not surprised at zero', () => {
    const v = canBroadcast(state({ used: 7 }), NOW);
    expect(v).toEqual({ allowed: true, remaining: 3 });
  });

  it('allows exactly the free allowance and no more', () => {
    expect(canBroadcast(state({ used: FREE_BROADCASTS - 1 }), NOW).allowed).toBe(true);
    expect(canBroadcast(state({ used: FREE_BROADCASTS }), NOW)).toEqual({
      allowed: false,
      reason: 'limit_reached',
    });
  });

  it('stays blocked once over the limit', () => {
    expect(canBroadcast(state({ used: 999 }), NOW).allowed).toBe(false);
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
    expect(canBroadcast(state({ licensed: true, used: 2, expiresAt: NOW - 1 }), NOW)).toEqual({
      allowed: true,
      remaining: FREE_BROADCASTS - 2,
    });
  });

  it('blocks a lapsed licence whose free allowance is also spent', () => {
    expect(canBroadcast(state({ licensed: true, used: 50, expiresAt: NOW - 1 }), NOW)).toEqual({
      allowed: false,
      reason: 'expired',
    });
  });

  it('does not extend a licence past a grace window that has also passed', () => {
    expect(
      canBroadcast(
        state({ licensed: true, used: 50, expiresAt: NOW - 2000, graceUntil: NOW - 1000 }),
        NOW,
      ).allowed,
    ).toBe(false);
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
    const v = canBroadcast(s, NOW);
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
    expect(sent).toBe(FREE_BROADCASTS);
  });

  it('does not spend an allowance on a broadcast that reached nobody', () => {
    // Held back because an AI was signed out: nothing was delivered, so
    // charging for it would take a free use for no value.
    const r = attempt(state({ used: 3 }), 0);
    expect(r.sent).toBe(true);
    expect(r.used).toBe(3);
  });

  it('never spends an allowance once the limit is reached', () => {
    const r = attempt(state({ used: FREE_BROADCASTS }), 4);
    expect(r.sent).toBe(false);
    expect(r.used).toBe(FREE_BROADCASTS);
  });

  it('never counts down for a licensed user', () => {
    let s = state({ licensed: true });
    for (let i = 0; i < 50; i++) {
      const r = attempt(s, 4);
      expect(r.sent).toBe(true);
      s = { ...s, used: r.used };
    }
    // Usage is still recorded, but it gates nothing.
    expect(canBroadcast(s, NOW).allowed).toBe(true);
  });
});
