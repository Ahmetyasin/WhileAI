import { describe, expect, it } from 'vitest';
import {
  judge,
  judgeOnTimeout,
  sameText,
  type DeliveryBaseline,
  type PageProbe,
} from '../src/content/deliveryVerdict';

const SENT = 'Reply with exactly one word: alpha';

const base = (over: Partial<DeliveryBaseline> = {}): DeliveryBaseline => ({
  lastUserMessage: null,
  userMessageCount: 0,
  sentText: SENT,
  ...over,
});

const probe = (over: Partial<PageProbe> = {}): PageProbe => ({
  isLoginPage: false,
  composerReady: true,
  quotaWall: false,
  lastUserMessage: null,
  userMessageCount: 0,
  ...over,
});

describe('judge — the prompt landed', () => {
  it('accepts when our prompt is the newest message and the transcript grew', () => {
    expect(judge(probe({ lastUserMessage: SENT, userMessageCount: 1 }), base())).toBe('accepted');
  });

  it('accepts even while the page is mid-render with no composer', () => {
    // THE reported bug: Claude navigates /new -> /chat/<id> on submit, so the
    // composer is briefly gone. That was read as "signed out" and the user
    // was told nothing had been sent — while the prompt sat in the
    // transcript, already answered (observed live 2026-09-07).
    expect(
      judge(probe({ composerReady: false, lastUserMessage: SENT, userMessageCount: 1 }), base()),
    ).toBe('accepted');
  });

  it('accepts even if a wall is also on screen, once the prompt is visibly there', () => {
    // Evidence of delivery beats evidence of a problem: the prompt was sent,
    // whatever else the page is showing.
    expect(
      judge(
        probe({ isLoginPage: true, quotaWall: true, lastUserMessage: SENT, userMessageCount: 1 }),
        base(),
      ),
    ).toBe('accepted');
  });

  it('accepts a follow-up prompt in an existing conversation', () => {
    expect(
      judge(
        probe({ lastUserMessage: SENT, userMessageCount: 4 }),
        base({ lastUserMessage: 'an earlier question', userMessageCount: 3 }),
      ),
    ).toBe('accepted');
  });

  it('ignores whitespace differences in how the site re-renders our text', () => {
    expect(
      judge(probe({ lastUserMessage: `  ${SENT}\n `, userMessageCount: 1 }), base()),
    ).toBe('accepted');
  });

  it('keeps waiting when the same text was already there and nothing changed', () => {
    // A retry of an identical prompt: matching text alone proves nothing,
    // because the page may simply not have moved.
    expect(
      judge(
        probe({ lastUserMessage: SENT, userMessageCount: 2 }),
        base({ lastUserMessage: SENT, userMessageCount: 2 }),
      ),
    ).toBeNull();
  });
});

describe('judge — walls and refusals', () => {
  it('reports a sign-in wall that appears after the click', () => {
    expect(judge(probe({ isLoginPage: true }), base())).toBe('gated');
  });

  it('reports a usage wall', () => {
    expect(judge(probe({ quotaWall: true }), base())).toBe('quota');
  });

  it('does NOT report a missing composer as a sign-in problem', () => {
    // A composer missing for a moment is a re-render, not a logout. Only a
    // login URL is decisive.
    expect(judge(probe({ composerReady: false }), base())).toBeNull();
  });

  it('reports refusal when the site posted a different message instead', () => {
    expect(
      judge(probe({ lastUserMessage: 'something else', userMessageCount: 1 }), base()),
    ).toBe('other');
  });

  it('keeps waiting when nothing is rendered yet', () => {
    expect(judge(probe(), base())).toBeNull();
  });

  it('keeps waiting when an old message is showing but the count has not grown', () => {
    // A virtualised transcript can present an older message while it settles.
    expect(
      judge(
        probe({ lastUserMessage: 'older question', userMessageCount: 3 }),
        base({ lastUserMessage: 'older question', userMessageCount: 3 }),
      ),
    ).toBeNull();
  });
});

describe('judgeOnTimeout — silence is not failure', () => {
  it('assumes success when the tab simply drew nothing', () => {
    // A throttled background tab accepts the prompt and renders nothing;
    // calling that a failure produced errors for prompts that had been sent.
    expect(judgeOnTimeout(probe())).toBe('accepted');
  });

  it('still reports a login wall on timeout', () => {
    expect(judgeOnTimeout(probe({ isLoginPage: true }))).toBe('gated');
  });

  it('still reports a usage wall on timeout', () => {
    expect(judgeOnTimeout(probe({ quotaWall: true }))).toBe('quota');
  });

  it('reports a wall when there is no composer AND nothing was ever rendered', () => {
    expect(judgeOnTimeout(probe({ composerReady: false, lastUserMessage: null }))).toBe('gated');
  });

  it('does not report a wall when the transcript rendered but the composer is gone', () => {
    expect(
      judgeOnTimeout(probe({ composerReady: false, lastUserMessage: SENT, userMessageCount: 1 })),
    ).toBe('accepted');
  });
});

describe('sameText', () => {
  it('ignores leading, trailing and repeated whitespace', () => {
    expect(sameText('  a   b \n', 'a b')).toBe(true);
  });

  it('does not treat different text as equal', () => {
    expect(sameText('alpha', 'beta')).toBe(false);
  });
});
