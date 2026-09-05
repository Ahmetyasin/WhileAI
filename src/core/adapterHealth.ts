/**
 * Keeping adapters working without shipping a new extension (CLAUDE.md §3.5,
 * §5.23-24).
 *
 * Chat sites change their markup without warning, and a store review takes
 * days. The escape hatch is remote *configuration*: selectors are DATA, fetched
 * from a static JSON file, validated, and swapped in at runtime. No remote code
 * is ever fetched or executed — MV3 forbids it and so do we.
 *
 * This module closes the loop:
 *   1. content scripts report whether their selectors still match
 *   2. a provider that starts failing triggers an immediate config re-fetch,
 *      instead of waiting for the daily one
 *   3. if the fresh config fixes it, the user never notices
 *   4. if it does not, the provider is marked broken so the UI can say so
 *      rather than failing silently
 */
import { ext } from './browser';
import { refreshRemoteConfig } from './config';

const HEALTH_KEY = 'adapterHealthLog';

/** Consecutive failures before we suspect the site changed, not the network. */
const FAILURE_THRESHOLD = 2;
/** Don't hammer the config host: at most one forced refresh per this window. */
const REFRESH_COOLDOWN_MS = 30 * 60_000;

export interface ProviderHealth {
  /** Consecutive failed checks since the last success. */
  failures: number;
  lastOkAt?: number;
  lastFailAt?: number;
  lastMissing?: string[];
  /** Set once a forced refresh did not fix it — the UI surfaces this. */
  broken: boolean;
  /** Config version in effect when it last worked, for diagnosis. */
  configVersion?: number;
}

export type HealthLog = Record<string, ProviderHealth>;

let lastForcedRefresh = 0;

export async function getHealthLog(): Promise<HealthLog> {
  try {
    const res = await ext.storage.local.get(HEALTH_KEY);
    const raw = res[HEALTH_KEY];
    return typeof raw === 'object' && raw !== null ? (raw as HealthLog) : {};
  } catch {
    return {};
  }
}

async function writeHealthLog(log: HealthLog): Promise<void> {
  try {
    await ext.storage.local.set({ [HEALTH_KEY]: log });
  } catch {
    // storage full or unavailable — health tracking is best effort
  }
}

/**
 * Record a health check from a content script. Returns true when a config
 * refresh was triggered, so the caller can retry once it lands.
 */
export async function reportHealth(
  providerId: string,
  ok: boolean,
  missing: string[] = [],
  configVersion?: number,
): Promise<{ refreshed: boolean; broken: boolean }> {
  const log = await getHealthLog();
  const cur: ProviderHealth = log[providerId] ?? { failures: 0, broken: false };

  if (ok) {
    log[providerId] = {
      failures: 0,
      lastOkAt: Date.now(),
      broken: false,
      configVersion,
    };
    await writeHealthLog(log);
    return { refreshed: false, broken: false };
  }

  const next: ProviderHealth = {
    ...cur,
    failures: cur.failures + 1,
    lastFailAt: Date.now(),
    lastMissing: missing,
    configVersion,
  };

  let refreshed = false;
  if (next.failures >= FAILURE_THRESHOLD && Date.now() - lastForcedRefresh > REFRESH_COOLDOWN_MS) {
    // The site probably changed. Pull the newest selectors right now rather
    // than waiting up to a day for the scheduled refresh.
    lastForcedRefresh = Date.now();
    refreshed = await refreshRemoteConfig();
    if (refreshed) {
      // Give the new config a fair chance before calling the adapter broken.
      next.failures = 0;
    } else {
      next.broken = true;
    }
  } else if (next.failures >= FAILURE_THRESHOLD) {
    next.broken = true;
  }

  log[providerId] = next;
  await writeHealthLog(log);
  return { refreshed, broken: next.broken };
}

/** Providers currently believed broken, for the UI badge (§4). */
export async function brokenProviders(): Promise<string[]> {
  const log = await getHealthLog();
  return Object.entries(log)
    .filter(([, h]) => h.broken)
    .map(([id]) => id);
}
