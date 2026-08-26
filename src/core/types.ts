export type SignalType = 'network' | 'button' | 'dom';
export type SignalEvent = 'start' | 'first_token' | 'end' | 'error' | 'abort';
export type TurnStatus = 'ok' | 'aborted' | 'invalid' | 'orphaned' | 'ambiguous';
export type TurnMode = 'standard' | 'thinking' | 'research' | 'unknown';
export type Confidence = 'high' | 'low';

/** Persisted turn record (spec §4.1). Never contains message content. */
export interface Turn {
  id: string;
  schemaVersion: number;
  platform: string;
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
