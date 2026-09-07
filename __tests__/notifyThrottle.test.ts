import { describe, expect, it } from 'vitest';
import { NotifyThrottle } from '../src/core/notifyThrottle';

describe('NotifyThrottle', () => {
  it('lets the first notification through', () => {
    expect(new NotifyThrottle().shouldSend('claude not ready')).toBe(true);
  });

  it('suppresses the same message while nothing has changed', () => {
    // The capture retry re-evaluates a deliberate block on every poll. Before
    // this, that meant the same alert every 30 seconds until the user fixed
    // it — which is how a helpful notification becomes noise.
    const t = new NotifyThrottle();
    t.shouldSend('claude not ready');
    expect(t.shouldSend('claude not ready')).toBe(false);
  });

  it('lets a DIFFERENT problem through immediately', () => {
    const t = new NotifyThrottle();
    t.shouldSend('claude not ready');
    expect(t.shouldSend('gemini hit its usage limit')).toBe(true);
  });

  it('speaks up again once the quiet period passes', () => {
    let now = 1000;
    const t = new NotifyThrottle(60_000, () => now);
    expect(t.shouldSend('x')).toBe(true);
    now += 30_000;
    expect(t.shouldSend('x')).toBe(false);
    now += 40_000; // past the window
    expect(t.shouldSend('x')).toBe(true);
  });

  it('speaks up at once after the condition clears', () => {
    const t = new NotifyThrottle();
    t.shouldSend('x');
    t.clear('x');
    expect(t.shouldSend('x')).toBe(true);
  });

  it('does not grow without bound in a long-lived worker', () => {
    const t = new NotifyThrottle();
    for (let i = 0; i < 200; i++) t.shouldSend(`problem ${i}`);
    // The newest is still remembered, so it stays suppressed.
    expect(t.shouldSend('problem 199')).toBe(false);
  });
});
