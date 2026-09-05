import type { ProviderId } from '../core/broadcastTypes';
import type { PlatformAdapter } from './types';

/**
 * The broadcast half of an adapter (CLAUDE.md §4).
 *
 * Deliberately a separate interface from PlatformAdapter rather than an
 * extension of it. PlatformAdapter is pure observation and is loaded on every
 * supported tab by the tracking content script; keeping the mutating methods
 * (insertText/submit/newChat) in a different object that only the broadcast
 * runtime constructs means the tracking path can never gain the ability to
 * type into or submit a chat form.
 */
export interface BroadcastAdapter {
  id: ProviderId;
  displayName: string;
  /** The observation adapter this one wraps. */
  readonly platform: PlatformAdapter;
  /** Where to open a fresh conversation. */
  baseUrl: string;

  // --- Observation ---
  isLoginPage(): boolean;
  /** Cloudflare / CAPTCHA / rate-limit wall. Never bypassed (§5.17). */
  isChallengePage(): boolean;
  isComposerReady(): boolean;
  isGenerating(): boolean;
  /** Text of the newest user message, for capture and send confirmation (§5.13). */
  getLastUserMessageText(): string | null;
  getConversationUrl(): string;

  // --- Action ---
  insertText(text: string): Promise<InsertOutcome>;
  submit(): Promise<boolean>;
  newChat(): Promise<void>;

  /**
   * Stricter than PlatformAdapter.selfTest: broadcasting needs BOTH a composer
   * and a send button, whereas measuring only needs one of them.
   */
  healthCheck(): { ok: boolean; missing: string[] };
}

export interface InsertOutcome {
  ok: boolean;
  detail?: string;
}

export const DISPLAY_NAMES: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};
