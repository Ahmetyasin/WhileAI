/**
 * Did the prompt we just submitted actually land?
 *
 * Pure so it can be tested against the awkward moments this has to survive:
 * an SPA re-rendering after submit, a background tab that draws nothing, a
 * sign-in wall that appears only after the click.
 *
 * The rule that matters: evidence the prompt LANDED always beats evidence
 * that something looks wrong. A page mid-render momentarily has no composer,
 * and reporting that as "signed out" told the user nothing was sent when it
 * had been (observed live on Claude 2026-09-07: the prompt was in the
 * transcript while the popup said "sign in first").
 */

export interface PageProbe {
  /** URL matches a known sign-in path. */
  isLoginPage: boolean;
  /** A usable composer exists right now. */
  composerReady: boolean;
  /** A usage/quota wall is on screen. */
  quotaWall: boolean;
  /** Newest user message, or null when nothing is rendered. */
  lastUserMessage: string | null;
  /** How many user messages the transcript shows. */
  userMessageCount: number;
}

export interface DeliveryBaseline {
  /** Newest user message immediately BEFORE submitting. */
  lastUserMessage: string | null;
  /** User message count immediately BEFORE submitting. */
  userMessageCount: number;
  /** The text we submitted. */
  sentText: string;
}

export type Verdict = 'accepted' | 'gated' | 'quota' | 'other' | 'unknown';

/** Whitespace-insensitive comparison; sites re-wrap and trim what they render. */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/**
 * One observation of the page after submitting.
 *
 * Returns null for "cannot tell yet" so the caller keeps polling; a verdict
 * only when the page has actually said something.
 */
export function judge(probe: PageProbe, base: DeliveryBaseline): Verdict | null {
  // 1. Did our prompt land? This is checked FIRST and unconditionally: once
  //    the transcript shows it, nothing else about the page can make the
  //    delivery a failure.
  if (probe.lastUserMessage !== null && sameText(probe.lastUserMessage, base.sentText)) {
    const grew = probe.userMessageCount > base.userMessageCount;
    const changed = base.lastUserMessage === null || !sameText(base.lastUserMessage, base.sentText);
    if (grew || changed) return 'accepted';
    // Same text, same count, and it was already there before we submitted:
    // the page has not moved. Keep looking rather than claiming success.
    return null;
  }

  // 2. A wall the site put up. Only a login URL counts as decisive here — a
  //    missing composer is NOT, because an SPA re-rendering after submit has
  //    no composer for a moment, and calling that "signed out" reported a
  //    delivered prompt as never sent.
  if (probe.isLoginPage) return 'gated';
  if (probe.quotaWall) return 'quota';

  // 3. The transcript clearly shows a DIFFERENT newest message. The site took
  //    the click and put something else there, so ours was refused.
  if (probe.lastUserMessage !== null && probe.userMessageCount > base.userMessageCount) {
    return 'other';
  }

  return null; // nothing rendered yet, or nothing conclusive
}

/**
 * What to conclude when the polling window expires with no verdict.
 *
 * Silence is NOT failure. A throttled background tab can accept a prompt and
 * render nothing at all (seen on DeepSeek), so the delivery is assumed to
 * have worked unless the page said otherwise — with one exception: a page
 * that has no composer AND never rendered our message by the deadline really
 * does look like a wall.
 */
export function judgeOnTimeout(probe: PageProbe): Verdict {
  if (probe.isLoginPage) return 'gated';
  if (probe.quotaWall) return 'quota';
  if (!probe.composerReady && probe.lastUserMessage === null) return 'gated';
  return 'accepted';
}
