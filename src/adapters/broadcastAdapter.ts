import type { ProviderId } from '../core/broadcastTypes';
import { insertTextInto } from './insertText';
import { isVisible, queryFirstIn, sleep, textOf, waitFor } from './domHelpers';
import type { PlatformAdapter } from './types';
import { DISPLAY_NAMES, type BroadcastAdapter, type InsertOutcome } from './broadcastTypes';

/**
 * Generic broadcast adapter (CLAUDE.md §4), built by composing the existing
 * observation adapter so both halves read the same selector config and rot at
 * the same rate.
 */
/** Verification-wall markers seen across providers (verified live 2026-09-05). */
const CHALLENGE_TITLES = [
  'just a moment',
  'attention required',
  'human verification',
  'security check',
  'verify you are human',
  'access denied',
];

const CHALLENGE_BODY = [
  'verify you are human',
  'checking your browser',
  'unusual activity',
  'are you a robot',
  'complete the security check',
  'insan doğrulama',
  'robot olmadığınızı',
];

/**
 * Usage walls. Observed live on Perplexity 2026-09-06: the free search limit
 * modal appears while the composer and Submit button stay in the DOM, so a
 * plain readiness check reports "ready" and the send then fails with a
 * meaningless INSERT_FAILED. Detected separately because the user's remedy is
 * different — wait for the reset or upgrade, not solve a puzzle or sign in.
 */
const QUOTA_PATTERNS = [
  'free search limit',
  "you've reached your free",
  'reached your free',
  'upgrade to continue',
  'message limit',
  'you are out of free',
  'daily limit',
  'rate limit',
  'ücretsiz arama limiti',
  'limitine ulaştınız',
];

export class GenericBroadcastAdapter implements BroadcastAdapter {
  readonly displayName: string;

  constructor(
    readonly id: ProviderId,
    readonly platform: PlatformAdapter,
  ) {
    this.displayName = DISPLAY_NAMES[id] ?? id;
  }

  get baseUrl(): string {
    return this.platform.config.newChatUrl ?? location.origin;
  }

  // ---- Observation ----

  isLoginPage(): boolean {
    const patterns = this.platform.config.loginUrlPatterns ?? [];
    const href = location.href;
    if (patterns.some((p) => href.includes(p))) return true;
    // A page with no composer at all is treated as a login wall by the caller
    // only after a grace period (§5.16); URL evidence alone is decisive here.
    return false;
  }

  /**
   * Verification walls (§5.17). NEVER bypassed — detection exists so the run
   * stops and tells the user, not so it can be worked around.
   *
   * Title patterns observed live on 2026-09-05: Cloudflare shows
   * "Just a moment...", DeepSeek shows "Human Verification". Body text is
   * checked too because some walls render before the title settles.
   */
  isChallengePage(): boolean {
    const sels = this.platform.config.challengeSelectors ?? [];
    if (queryFirstIn(sels) !== null) return true;

    const title = document.title.toLowerCase();
    if (CHALLENGE_TITLES.some((p) => title.includes(p))) return true;

    // A wall is a nearly empty page; a real chat page has far more text, so
    // this cannot fire on a conversation that merely mentions verification.
    const body = (document.body?.innerText ?? '').slice(0, 600).toLowerCase();
    if (body.length > 0 && body.length < 600) {
      return CHALLENGE_BODY.some((p) => body.includes(p));
    }
    return false;
  }

  /**
   * Is a usage wall on screen? Scoped to a visible dialog when there is one,
   * so the phrase appearing inside an ANSWER about rate limits cannot trip it.
   */
  isQuotaWall(): boolean {
    const dialog = document.querySelector('[role="dialog"]');
    const scope = dialog instanceof HTMLElement ? dialog : null;
    if (scope === null) return false;
    const text = (scope.innerText ?? '').toLowerCase();
    return QUOTA_PATTERNS.some((p) => text.includes(p));
  }

  /**
   * Prefer the provider's answer node over the whole page. Measured live on
   * Perplexity 2026-09-06: body.innerText fell from 934 to 771 across a
   * generation (the composer clears and off-screen answers unmount from the
   * virtualised list) while the answer itself grew — so a page-level measure
   * never sees the answer. Falls back to the body when nothing matches.
   */
  answerLength(): number {
    // Take the LARGEST match, not the first. Providers sometimes render a
    // variant layout whose real answer sits outside the usual node — Gemini's
    // A/B preference card ("Which response was more helpful?") is one:
    // measured live 2026-09-06, model-response held 24 characters while the
    // card holding both candidates held 293. Picking the first matching
    // selector measured the wrong node and could miss the answer growing.
    let best = 0;
    for (const sel of this.platform.config.answerSelectors ?? []) {
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length === 0) continue;
        const last = nodes[nodes.length - 1] as HTMLElement;
        const len = (last.innerText ?? last.textContent ?? '').length;
        if (len > best) best = len;
      } catch {
        // a malformed selector must never break completion detection
      }
    }
    if (best > 0) return best;
    return document.body?.innerText.length ?? 0;
  }

  private composer(): HTMLElement | null {
    for (const sel of this.platform.config.composerSelectors) {
      let nodes: NodeListOf<Element>;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      // Chat pages keep hidden/duplicate composers around; take a real one.
      for (const n of Array.from(nodes)) {
        if (n instanceof HTMLElement && isVisible(n)) return n;
      }
    }
    return null;
  }

  isComposerReady(): boolean {
    return this.composer() !== null;
  }

  isGenerating(): boolean {
    if (this.platform.isGenerating()) return true;
    const sel = this.platform.streamingSelector;
    if (!sel) return false;
    try {
      return document.querySelector(sel) !== null;
    } catch {
      return false;
    }
  }

  getLastUserMessageText(): string | null {
    const sels = this.platform.config.userMessageSelectors ?? [];
    for (const sel of sels) {
      let nodes: NodeListOf<Element>;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      const last = nodes[nodes.length - 1];
      if (last) {
        const t = textOf(last).trim();
        if (t) return t;
      }
    }
    return null;
  }

  /**
   * How many user messages the transcript is showing. Used to tell "our
   * prompt landed" apart from "our prompt was already there" — matching text
   * alone cannot distinguish a fresh send from a page that never moved.
   * Returns the largest count across selectors, since providers render more
   * than one shape of message node.
   */
  countUserMessages(): number {
    let best = 0;
    for (const sel of this.platform.config.userMessageSelectors ?? []) {
      try {
        const n = document.querySelectorAll(sel).length;
        if (n > best) best = n;
      } catch {
        // a malformed selector must never break delivery verification
      }
    }
    return best;
  }

  getConversationUrl(): string {
    return location.href;
  }

  // ---- Action ----

  /** The send control, only when the site considers it usable. */
  private sendButton(): HTMLElement | null {
    const el = this.platform.findSubmitButton();
    if (!(el instanceof HTMLElement)) return null;
    return el;
  }

  private sendEnabled(): boolean {
    const btn = this.sendButton();
    if (!btn) return false;
    if (btn instanceof HTMLButtonElement && btn.disabled) return false;
    return btn.getAttribute('aria-disabled') !== 'true';
  }

  async insertText(text: string): Promise<InsertOutcome> {
    const el = this.composer();
    if (!el) return { ok: false, detail: 'composer not found' };

    // Two-sided verification (§5.8): the text must be present AND the site
    // must agree it has something sendable. Some providers hide the send
    // button entirely until there is text, so a missing button before
    // insertion is normal — we only require it to be usable afterwards.
    const res = await insertTextInto(el, text, 150, () => this.sendEnabled());
    if (res.ok) return { ok: true };

    // The button may simply be slow to enable; give it a moment before failing.
    if (res.reason === 'send-still-disabled') {
      const ready = await waitFor(() => this.sendEnabled(), 2000);
      if (ready) return { ok: true };
    }
    return {
      ok: false,
      detail: `insert failed (${res.strategy}/${res.reason ?? 'unknown'})`,
    };
  }

  /**
   * Submit by clicking the send button (§5.10). Enter is not synthesised:
   * in several editors it inserts a newline, and it interacts badly with IME
   * composition.
   */
  async submit(): Promise<boolean> {
    const btn = await waitFor(() => (this.sendEnabled() ? this.sendButton() : null), 3000);
    if (!btn) return false;
    btn.click();

    // Confirm the click took: either the composer emptied or generation began.
    const composerText = () => textOf(this.composer()).trim();
    const before = composerText();
    const accepted = await waitFor(
      () => this.isGenerating() || composerText() !== before || composerText() === '',
      3000,
    );
    return accepted !== null;
  }

  async newChat(): Promise<void> {
    location.href = this.baseUrl;
    // Give the SPA a beat; the caller re-checks readiness afterwards.
    await sleep(500);
  }

  healthCheck(): { ok: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!this.isComposerReady()) missing.push('composer');
    if (!this.sendButton()) missing.push('sendButton');
    for (const sel of this.platform.config.composerSelectors) {
      try {
        document.querySelector(sel);
      } catch {
        missing.push(`invalid-selector:${sel}`);
      }
    }
    return { ok: missing.length === 0, missing };
  }
}
