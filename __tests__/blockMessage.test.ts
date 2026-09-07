import { describe, expect, it } from 'vitest';

/**
 * The wording shown when a broadcast is held back, kept honest here because
 * each cause has a DIFFERENT remedy and offering the wrong one is worse than
 * offering none. "Reload that tab" does nothing for a usage limit, and the
 * user reported exactly that gap: a Fable limit with no message at all.
 *
 * Mirrors notifySignedOut's decision so the rule is testable without a
 * browser; the strings live there.
 */
interface Blocked { id: string; paused: boolean; quota: boolean }

function messageFor(blocked: Blocked[], names: string): string {
  const allAre = (pick: (b: Blocked) => boolean): boolean =>
    blocked.length > 0 && blocked.every(pick);
  const tail = 'Prompts are held back so your chat histories stay in step.';
  return allAre((b) => b.quota)
    ? `Nothing was sent: ${names} has hit a usage limit. Switch model in that tab, or wait for the reset. ${tail}`
    : allAre((b) => b.paused)
      ? `Nothing was sent: ${names} paused the conversation and is waiting for you. Open that tab and choose how to continue. ${tail}`
      : `Nothing was sent: ${names} is not ready. If you are signed out, sign in; otherwise reload that tab. ${tail}`;
}

const quota = (id: string): Blocked => ({ id, paused: false, quota: true });
const paused = (id: string): Blocked => ({ id, paused: true, quota: false });
const notReady = (id: string): Blocked => ({ id, paused: false, quota: false });

describe('block message', () => {
  it('offers switching model for a usage limit', () => {
    const m = messageFor([quota('claude')], 'Claude');
    expect(m).toContain('usage limit');
    expect(m).toContain('Switch model');
    // Reloading does not clear a usage limit, so it must not be suggested.
    expect(m).not.toContain('reload');
  });

  it('offers the card for a paused conversation, not a reload', () => {
    const m = messageFor([paused('claude')], 'Claude');
    expect(m).toContain('paused');
    expect(m).not.toContain('reload');
  });

  it('offers sign-in or reload when the page is simply not ready', () => {
    const m = messageFor([notReady('gemini')], 'Gemini');
    expect(m).toContain('signed out');
    expect(m).toContain('reload');
  });

  it('falls back to the generic remedy when causes differ', () => {
    // Two providers blocked for different reasons: naming one remedy would be
    // wrong for the other, so neither specific one is claimed.
    const m = messageFor([quota('claude'), notReady('gemini')], 'Claude and Gemini');
    expect(m).toContain('not ready');
  });

  it('always says nothing was sent', () => {
    // The whole complaint was silence: whatever the cause, the user has to
    // learn that the prompt did not go anywhere.
    for (const b of [quota('a'), paused('a'), notReady('a')]) {
      expect(messageFor([b], 'X')).toContain('Nothing was sent');
    }
  });

  it('always explains why the other AIs got nothing either', () => {
    for (const b of [quota('a'), paused('a'), notReady('a')]) {
      expect(messageFor([b], 'X')).toContain('histories stay in step');
    }
  });
});
