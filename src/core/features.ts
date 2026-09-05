/**
 * Feature flags (CLAUDE.md §15). Everything is unlimited today; these exist so
 * a future paid tier has a single place to gate, not so limits ship now.
 */
export interface Features {
  /** Master switch for the broadcast half while it is being hardened. */
  broadcastEnabled: boolean;
  maxProviders: number;
  queueDepth: number;
  historyDays: number;
  compareView: boolean;
}

export const FEATURES: Features = {
  broadcastEnabled: true,
  maxProviders: Number.POSITIVE_INFINITY,
  queueDepth: Number.POSITIVE_INFINITY,
  historyDays: Number.POSITIVE_INFINITY,
  compareView: false,
};
