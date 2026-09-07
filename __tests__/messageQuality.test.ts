import { describe, expect, it } from 'vitest';
import { ERROR_TEXT, NOTIFY_TEXT } from '../src/core/orchestrator';

/**
 * Every warning the user can see, held to the same contract. These are the
 * only words most users will ever read from this extension, and the failures
 * that prompted them were all the same shape: a message that did not say what
 * happened, or that named a remedy which could not work.
 */
const NAME = 'Claude';
const all = (): [string, string][] => [
  ...Object.entries(ERROR_TEXT).map(([k, f]) => [k, f(NAME)] as [string, string]),
  ...Object.entries(NOTIFY_TEXT).map(([k, f]) => [k, f(NAME)] as [string, string]),
];

describe('every user-facing warning', () => {
  it('names the AI it is about', () => {
    for (const [key, text] of all()) {
      expect(text, key).toContain(NAME);
    }
  });

  it('tells the user what to do', () => {
    // A warning with no next step leaves them to work it out themselves.
    for (const [key, text] of all()) {
      const actionable =
        /sign in|switch model|reload|open |paste|send it yourself|solve|update|try again|see why|check/i.test(
          text,
        );
      expect(actionable, `${key}: "${text}"`).toBe(true);
    }
  });

  it('reads as a sentence, not a code', () => {
    for (const [key, text] of all()) {
      expect(text.length, key).toBeGreaterThan(30);
      expect(text, key).toMatch(/\.$/);
      expect(text, key).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/); // no raw codes
    }
  });

  it('never tells the user to reload for something a reload cannot fix', () => {
    // A paused conversation and a usage limit both survive a reload; saying
    // otherwise sends them round in circles.
    expect(ERROR_TEXT.CONVERSATION_PAUSED!(NAME)).not.toMatch(/reload/i);
    expect(ERROR_TEXT.QUOTA_EXHAUSTED!(NAME)).not.toMatch(/reload/i);
    expect(NOTIFY_TEXT.quota!(NAME)).not.toMatch(/reload/i);
  });

  it('never tells the user to open a tab that is already open', () => {
    // NO_SCRIPT means the tab is right there but not listening. "Open it
    // yourself" was the message users saw for a tab in front of them.
    expect(ERROR_TEXT.NO_SCRIPT!(NAME)).not.toMatch(/^.*open Claude and/i);
  });

  it('gives the same advice for the same problem, whichever path reports it', () => {
    // A usage limit reaches the user through two code paths. Different advice
    // from each leaves them deciding which to believe.
    expect(NOTIFY_TEXT.quota!(NAME)).toBe(ERROR_TEXT.QUOTA_EXHAUSTED!(NAME));
  });

  it('says nothing was sent whenever that is the case', () => {
    // The complaint that started this: silence, or a message that did not
    // make clear the prompt had gone nowhere.
    for (const key of ['QUOTA_EXHAUSTED', 'CONVERSATION_PAUSED', 'NO_SCRIPT', 'TAB_GONE', 'NO_COMPOSER', 'INSERT_FAILED', 'ADAPTER_BROKEN']) {
      expect(ERROR_TEXT[key]!(NAME), key).toMatch(/nothing was sent/i);
    }
  });
});
