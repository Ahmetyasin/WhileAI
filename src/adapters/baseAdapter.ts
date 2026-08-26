import type { PlatformSelectorConfig } from '../core/types';
import { queryFirst, type PlatformAdapter } from './types';

/**
 * Both v1 platforms (and the dev harness) share the same mechanics; only the
 * selector config differs, so one generic implementation serves them all.
 * Platform-specific quirks get their own subclass when they appear.
 */
export class GenericAdapter implements PlatformAdapter {
  constructor(
    public id: string,
    public hosts: string[],
    public config: PlatformSelectorConfig,
  ) {}

  get streamingSelector(): string | null {
    return this.config.streamingSelector;
  }

  findSubmitButton(): Element | null {
    return queryFirst(this.config.sendButtonSelectors);
  }

  findStopButton(): Element | null {
    return queryFirst(this.config.stopButtonSelectors);
  }

  isGenerating(): boolean {
    return this.findStopButton() !== null;
  }

  detectModel(): string | null {
    const el = queryFirst(this.config.modelSelectors);
    const text = el?.textContent?.trim();
    if (!text || text.length > 60) return null; // suspicious match — better null than wrong
    return text;
  }

  hasThinkingIndicator(): boolean {
    if (!this.config.thinkingSelector) return false;
    try {
      return document.querySelector(this.config.thinkingSelector) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Health check (spec §3.4). A chat page should show a send button OR a
   * composer input; the send button alone moves too often to be the sole
   * criterion. Streaming/stop elements only exist mid-generation, so their
   * absence is not a failure — only a syntactically broken selector is.
   */
  selfTest(): { ok: boolean; missing: string[] } {
    const missing: string[] = [];
    const hasComposer = queryFirst(this.config.composerSelectors) !== null;
    if (!this.findSubmitButton() && !hasComposer) missing.push('sendButton/composer');
    for (const sel of [
      this.config.streamingSelector,
      ...this.config.stopButtonSelectors,
    ]) {
      if (!sel) continue;
      try {
        document.querySelector(sel);
      } catch {
        missing.push(`invalid-selector:${sel}`);
      }
    }
    return { ok: missing.length === 0, missing };
  }
}
