/**
 * Broadcast half of whileAI (CLAUDE.md §3.2): one prompt, several AI sites,
 * each in the user's own logged-in tab.
 *
 * Deliberately separate from core/types.ts so the shipped tracking types stay
 * untouched. ProviderId reuses the tracking platform ids so a broadcast run
 * and a tracked turn join on the same key in the dashboard.
 */

export const PROVIDER_IDS = ['chatgpt', 'claude', 'perplexity', 'gemini', 'deepseek'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);
}

/** §3.2. A run is in exactly one of these at any time. */
export type RunState =
  | 'queued'
  | 'opening_tab'
  /** Navigating to a fresh conversation before the prompt can be sent. */
  | 'starting_new_chat'
  | 'waiting_ready'
  | 'inserting'
  | 'submitted'
  | 'generating'
  | 'done'
  | 'needs_login'
  | 'blocked_challenge'
  | 'timeout'
  | 'error'
  | 'cancelled';

/**
 * States that free the provider's lane. Everything else means the provider is
 * still busy and the next prompt must wait (§7).
 */
export const TERMINAL_STATES: readonly RunState[] = [
  'done',
  'timeout',
  'error',
  'cancelled',
  'needs_login',
  'blocked_challenge',
] as const;

export function isTerminal(s: RunState): boolean {
  return TERMINAL_STATES.includes(s);
}

/**
 * States where the prompt may already have reached the provider. On service
 * worker wake these must be reconciled against the page before re-sending,
 * or the user gets the same prompt twice (§5.3).
 */
export const IN_FLIGHT_STATES: readonly RunState[] = ['inserting', 'submitted'] as const;

export type PromptMode = 'continue' | 'new_chat';

export interface ProviderRun {
  providerId: ProviderId;
  state: RunState;
  tabId?: number;
  attempts: number;
  enqueuedAt: number;
  startedAt?: number;
  submittedAt?: number;
  firstTokenAt?: number;
  completedAt?: number;
  error?: string;
  errorCode?: ErrorCode;
}

export interface PromptItem {
  id: string;
  text: string;
  hash: string;
  createdAt: number;
  sourceProviderId: ProviderId | null;
  mode: PromptMode;
  runs: Record<string, ProviderRun>;
}

export interface BroadcastSettings {
  version: number;
  providers: Record<string, { enabled: boolean; maxWaitMs: number; longMode: boolean }>;
  sourceProviderId: ProviderId | null;
  mode: PromptMode;
  lockstep: boolean;
  keepHistory: boolean;
  /** Master switch for broadcasting, from the popup. */
  broadcastEnabled: boolean;
  /**
   * Relay a prompt typed in ANY enabled provider's tab to the others (§5.14).
   * This is the product's main promise: ask once, wherever you happen to be,
   * and every AI you picked gets it. Off means only the panel's own box sends.
   */
  captureFromAnyTab: boolean;
  notifications: boolean;
}

export interface QueueState {
  items: PromptItem[];
}

/** Volatile, storage.session (§6): ids that must not outlive the browser. */
export interface BroadcastRuntime {
  compareWindowId?: number;
  /** The shared "whileAI" tab group holding every tab we opened (§5.20). */
  groupId?: number;
  /**
   * Tabs the extension DELIVERED into for the current prompt. A delivered
   * prompt must not be captured and relayed back out, but a tab the user
   * types in themselves must be — even though both end up in runtime.tabs.
   */
  delivered?: Record<string, string>;
  tabs: Record<string, number>;
  sourceTabId?: number;
}

export const ERROR_CODES = [
  'INSERT_FAILED',
  'SUBMIT_FAILED',
  'NO_COMPOSER',
  // The provider accepted us but has nothing left to give: free-tier search
  // limit, message cap, "upgrade to continue". Distinct from a challenge
  // (retrying cannot help) and from an insert failure (the composer is fine).
  'QUOTA_EXHAUSTED',
  'ADAPTER_BROKEN',
  'TAB_GONE',
  'UNKNOWN',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---- Reducer I/O (§3.2: pure (state, event) => { state, commands }) ----

export type QueueEvent =
  | { kind: 'enqueue'; item: PromptItem }
  | { kind: 'tab_opened'; promptId: string; providerId: ProviderId; tabId: number }
  | { kind: 'tab_failed'; promptId: string; providerId: ProviderId }
  | { kind: 'ready'; providerId: ProviderId; tabId: number }
  | { kind: 'inserted'; promptId: string; providerId: ProviderId }
  | { kind: 'submitted'; promptId: string; providerId: ProviderId }
  | { kind: 'generating'; promptId: string; providerId: ProviderId }
  | { kind: 'done'; promptId: string; providerId: ProviderId }
  | { kind: 'not_logged_in'; providerId: ProviderId }
  | { kind: 'challenge'; providerId: ProviderId }
  | { kind: 'failed'; promptId: string; providerId: ProviderId; code: ErrorCode; detail?: string }
  | { kind: 'cancel'; promptId: string; providerId?: ProviderId }
  | { kind: 'cancel_all' }
  | { kind: 'retry'; promptId: string; providerId: ProviderId }
  | { kind: 'reorder'; promptId: string; direction: 'up' | 'down' }
  | { kind: 'edit'; promptId: string; text: string; hash: string }
  | { kind: 'clear_finished' }
  /** Periodic re-evaluation: timeouts, lanes freed while the SW was asleep. */
  | { kind: 'tick' }
  /** Already-sent detection after an SW restart (§5.3). */
  | { kind: 'reconciled'; promptId: string; providerId: ProviderId; alreadySent: boolean };

export type Command =
  | { kind: 'open_tab'; promptId: string; providerId: ProviderId }
  | { kind: 'insert_and_submit'; promptId: string; providerId: ProviderId; tabId: number; text: string }
  | { kind: 'new_chat'; promptId: string; providerId: ProviderId; tabId: number }
  | { kind: 'cancel_run'; promptId: string; providerId: ProviderId; tabId?: number }
  | { kind: 'reconcile'; promptId: string; providerId: ProviderId; tabId: number; hash: string }
  | { kind: 'notify'; level: 'needs_login' | 'blocked_challenge' | 'error' | 'timeout'; providerId: ProviderId; promptId?: string }
  | { kind: 'record_run'; promptId: string; providerId: ProviderId }
  /** Ask the orchestrator to schedule a tick (chrome.alarms, never setTimeout). */
  | { kind: 'schedule'; afterMs: number };
