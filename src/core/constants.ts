export const PRODUCT_NAME = 'WhileAI';
export const ADAPTER_VERSION = '1.2.0';
export const SCHEMA_VERSION = 1;

// Turn validation (spec §2.5)
// 300ms discarded REAL answers: Gemini returns a one-word reply in 100-200ms
// and every one was filed 'invalid', which the dashboard hides — so a fast
// provider looked like it was never tracked at all (verified live 2026-09-06
// from the debug log: submit -> first_token -> end, all signals correct, only
// the duration below the floor). 50ms still rejects the zero-length noise a
// mis-fired signal produces.
export const MIN_VALID_WAIT_MS = 50;
export const MAX_VALID_WAIT_MS = 3_600_000; // 1 hour
export const CONFIRM_TIMEOUT_MS = 1500; // single end-signal confirmation wait (spec §3.2)

/**
 * Safety net for multi-request generations. The page's "still generating"
 * markers can get stuck (e.g. an interrupted research run leaves the
 * streaming element in the DOM). After the streams have ended, hold the turn
 * open for at most this long waiting for the next request; then close it.
 */
export const GENERATION_GAP_MAX_MS = 60_000;

// Clock consistency: performance.now() can pause when the tab sleeps.
// If wall-clock delta and monotonic delta diverge more than this, the turn is invalid (spec §3.7).
export const CLOCK_DRIFT_TOLERANCE_MS = 5000;

// Derived metrics (spec §2.3) — user-adjustable estimate, NOT a scientific constant.
// 5s, not 3m. This is a user-set ASSUMPTION about how long it takes to pick
// up where you left off, and a 3-minute default dwarfed the measured waits it
// was added to — the estimate read as the headline number. The dashboard caps
// the slider at 60s for the same reason.
export const RESUME_PENALTY_DEFAULT_MS = 5_000;

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

/**
 * A repeat start signal of the SAME type arriving within this window is part
 * of the answer already running, not a new prompt.
 *
 * Providers fire background requests around a generation — Gemini emits a
 * flurry of 140-byte telemetry and batch calls that match its endpoint
 * pattern. Seen live 2026-09-07: one prompt produced thirty-plus turns, all
 * 0-2ms and discarded as invalid. Nobody types two prompts a second apart, so
 * anything that close belongs to the turn in flight.
 */
// 1500ms, not longer: at 3s this began swallowing genuinely overlapping
// prompts, which the "ambiguous overlapping turns" guarantee exists to catch.
// The residual 0ms turns from a provider's request burst are the smaller
// harm — they are filtered from the dashboard as invalid.
export const REPEAT_START_GRACE_MS = 1500;

/**
 * Below this, a turn that was ONLY ever seen as network traffic is treated as
 * the provider's own background chatter rather than an answer.
 *
 * Set from live measurement (2026-09-07): Gemini's periodic RPC closed in
 * 150-400ms, while its genuine short answers arrived with a button or DOM
 * signal alongside. 1000ms leaves generous headroom above the observed noise
 * without reaching into answer territory — and a turn with any second signal
 * is kept regardless of how brief it was.
 */
export const BACKGROUND_TRAFFIC_MAX_MS = 1000;

/**
 * At or below this, a turn has no duration worth calling a measurement.
 *
 * Nothing a person does takes zero time. Gemini fires its send handler and a
 * background request in the same tick, producing 0-2ms turns carrying both
 * signals — 242 of them in one profile (2026-09-07). They were filed as
 * failed measurements, which overstated how often measurement actually fails.
 * Kept tight so a genuinely fast answer (Gemini answers a one-word prompt in
 * 100-200ms) is never caught by it.
 */
export const ZERO_DURATION_MAX_MS = 5;
