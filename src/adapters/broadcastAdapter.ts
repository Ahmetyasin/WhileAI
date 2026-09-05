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

  isChallengePage(): boolean {
    const sels = this.platform.config.challengeSelectors ?? [];
    if (queryFirstIn(sels) !== null) return true;
    // Cloudflare interstitials commonly announce themselves in the title.
    const t = document.title.toLowerCase();
    return t.includes('just a moment') || t.includes('attention required');
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
