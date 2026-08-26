export const PRODUCT_NAME = 'WhileAI';
export const EXTENSION_VERSION = '0.3.0';
export const ADAPTER_VERSION = '1.1.0';
export const SCHEMA_VERSION = 1;

// Turn validation (spec §2.5)
export const MIN_VALID_WAIT_MS = 300;
export const MAX_VALID_WAIT_MS = 3_600_000; // 1 hour
export const CONFIRM_TIMEOUT_MS = 1500; // single end-signal confirmation wait (spec §3.2)

// Clock consistency: performance.now() can pause when the tab sleeps.
// If wall-clock delta and monotonic delta diverge more than this, the turn is invalid (spec §3.7).
export const CLOCK_DRIFT_TOLERANCE_MS = 5000;

// Derived metrics (spec §2.3) — user-adjustable estimate, NOT a scientific constant.
export const RESUME_PENALTY_DEFAULT_MS = 180_000;

// Mode classification thresholds (spec §2.4)
export const RESEARCH_MIN_WAIT_MS = 120_000;
export const THINKING_MIN_WAIT_MS = 15_000;

// Storage
export const RETENTION_DEFAULT_DAYS = 180;
export const DB_NAME = 'whileai';
export const DB_VERSION = 1;
export const TURNS_STORE = 'turns';
export const META_STORE = 'meta';

// Orphan sweep: open turns older than MAX_VALID_WAIT_MS become 'orphaned'
export const ORPHAN_CHECK_ALARM = 'whileai:orphan-check';
export const CONFIG_REFRESH_ALARM = 'whileai:config-refresh';
export const RETENTION_PRUNE_ALARM = 'whileai:retention-prune';

// Remote selector config (spec §3.5). Data only, never code.
export const REMOTE_CONFIG_URL =
  'https://raw.githubusercontent.com/Ahmetyasin/WhileAI/main/config/selectors.json';
