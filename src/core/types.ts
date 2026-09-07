export type SignalType = 'network' | 'button' | 'dom';
export type SignalEvent = 'start' | 'first_token' | 'end' | 'error' | 'abort';
/**
 * 'noise' is deliberately separate from 'invalid'. Both are excluded from the
 * stats, but they mean opposite things to the user: 'invalid' is a wait we
 * failed to measure properly, while 'noise' is a provider's own background
 * request that was never an answer at all. Reporting the two together made a
 * working extension look broken — 484 filtered Gemini RPCs were presented as
 * failed measurements (2026-09-07).
 */
export type TurnStatus = 'ok' | 'aborted' | 'invalid' | 'orphaned' | 'ambiguous' | 'noise';
export type TurnMode = 'standard' | 'thinking' | 'research' | 'unknown';
export type Confidence = 'high' | 'low';

/** Persisted turn record (spec §4.1). Never contains message content. */
export interface Turn {
  id: string;
  schemaVersion: number;
  platform: string;
  /**
   * Which tab this turn happened in (§8). Three Gemini tabs are three
   * independent sessions, and the dashboard shows per-platform totals with a
   * per-session breakdown underneath. Optional so pre-0.7 records still load.
   */
  tabId?: number;
  model: string | null;
  mode: TurnMode;

  startedAt: number; // Date.now()
  totalWaitMs: number;
  ttftMs: number | null;
  streamMs: number | null;

  visibleMs: number;
  hiddenMs: number;
  focusMs: number;
  escapeCount: number;

  bytes: number | null;
  status: TurnStatus;
  confidence: Confidence;
  signals: SignalType[];
  adapterVersion: string;
  /**
   * Which half of the extension produced this record. Absent on everything
   * written before broadcasting existed, so readers must treat undefined as
   * 'tracked'.
   */
  origin?: 'tracked' | 'broadcast';
}

/** Timing core produced by TurnTracker; content script enriches it into a Turn. */
export interface TurnCore {
  id: string;
  startedAt: number;
  totalWaitMs: number;
  ttftMs: number | null;
  streamMs: number | null;
  bytes: number | null;
  status: TurnStatus;
  confidence: Confidence;
  signals: SignalType[];
}

export interface VisibilityResult {
  visibleMs: number;
  focusMs: number;
  escapeCount: number;
}

export interface Settings {
  /** Master switch for the response tracker, from the popup. */
  trackingEnabled: boolean;
  resumePenaltyMs: number;
  retentionDays: number;
  notificationsEnabled: boolean;
  /** Ring-buffer signal logging for field debugging (dashboard → Data). */
  debugLogging: boolean;
}

export interface DebugLogEntry {
  at: number; // Date.now()
  src: 'content' | 'sw';
  platform?: string;
  event: string;
  detail?: Record<string, unknown>;
}

export interface DailySummary {
  totalWaitMs: number;
  turnCount: number; // status 'ok' only
  visibleMs: number;
  hiddenMs: number;
  escapeCount: number;
  abortedCount: number;
  unmeasuredCount: number; // invalid + orphaned + ambiguous
  byPlatform: Record<string, { waitMs: number; count: number }>;
}

export interface OpenTurnState {
  id: string;
  platform: string;
  startedAt: number;
  updatedAt: number;
  /** Last visibility snapshot (sent on pagehide) so an orphaned close keeps partial data. */
  snapshot?: { totalWaitMs: number; visibleMs: number; focusMs: number; escapeCount: number };
}

export interface PlatformActivity {
  lastActiveAt: number; // content script loaded on host
  lastTurnAt: number; // last recorded turn
}

/** Selector/pattern config, embeddable and remotely refreshable (spec §3.5). */
export interface PlatformSelectorConfig {
  streamingSelector: string | null;
  stopButtonSelectors: string[];
  sendButtonSelectors: string[];
  /** Composer/input selectors — health check fallback when the send button moves. */
  composerSelectors: string[];
  thinkingSelector: string | null;
  modelSelectors: string[];
  endpointPatterns: string[]; // regex sources, compiled at use site

  // ---- Broadcast additions (CLAUDE.md §4). All optional so a cached v5
  // config from before broadcast existed still validates and simply
  // degrades: the platform can be measured, just not broadcast to.
  /** Newest user message node — source capture and send-confirmation (§5.13). */
  userMessageSelectors?: string[];
  /** URL fragments meaning "this is a login wall" (§5.16). */
  loginUrlPatterns?: string[];
  /** Cloudflare / CAPTCHA / "unusual activity" markers (§5.17). */
  challengeSelectors?: string[];
  /** Where to go for a fresh conversation (§4 baseUrl). */
  newChatUrl?: string;
  /**
   * The answer body, for completion detection (§5.11).
   *
   * document.body.innerText is a poor proxy on virtualised pages: measured
   * live on Perplexity 2026-09-06 it SHRANK (615 -> 462) as the composer
   * cleared and off-screen answers unmounted, while the answer itself grew
   * 0 -> 471 chars. Pointing at the answer node makes growth monotonic.
   * Falls back to document.body when unset.
   */
  answerSelectors?: string[];
  /**
   * Wording that means "you have hit a usage limit". Remotely updatable so a
   * provider rewording its notice can be handled without a store release —
   * these strings are the most perishable thing in the extension, and the
   * 24-hour config refresh exists precisely for them.
   *
   * Merged with the built-in list rather than replacing it, so a bad remote
   * config can only ADD coverage, never silently remove it.
   */
  quotaPatterns?: string[];
  /** Wording that means "this conversation is paused, only you can resume". */
  pausedPatterns?: string[];
  /** Page titles that mean a verification wall is up. */
  challengeTitlePatterns?: string[];
}

export interface SelectorConfig {
  version: number;
  updated: string;
  platforms: Record<string, PlatformSelectorConfig>;
}

// ---- Runtime messages (content <-> service worker) ----
export type RuntimeMessage =
  | { kind: 'turn:open'; open: OpenTurnState }
  | { kind: 'turn:heartbeat'; id: string; updatedAt: number }
  | { kind: 'turn:completed'; turn: Turn }
  | {
      kind: 'turn:pagehide';
      id: string;
      snapshot: { totalWaitMs: number; visibleMs: number; focusMs: number; escapeCount: number };
    }
  | { kind: 'platform:active'; platform: string }
  | { kind: 'adapter:selftest'; platform: string; ok: boolean; missing: string[] }
  | { kind: 'debug:log'; entry: DebugLogEntry };
