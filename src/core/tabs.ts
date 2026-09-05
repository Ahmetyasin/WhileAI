/**
 * Tab and window handling for broadcast (CLAUDE.md §5.20, §5.5, §5.2).
 *
 * Every id read back from storage.session is re-validated against the live
 * browser before use: after a service worker restart, or a browser restart, an
 * id may be stale or now belong to somebody else's tab.
 */
import { ext } from './browser';
import { getRuntime, updateRuntime } from './broadcastStorage';
import type { ProviderId } from './broadcastTypes';
import { command, parseObservation, type Observation } from './messages';

export async function tabExists(tabId: number): Promise<boolean> {
  try {
    const tab = await ext.tabs.get(tabId);
    return tab !== undefined && tab.id !== undefined;
  } catch {
    return false; // "No tab with id" is an expected flow, not a crash (§11)
  }
}

/** Is the content script alive in this tab? Discarded tabs answer nothing (§5.5). */
export async function pingTab(tabId: number, providerId: ProviderId): Promise<boolean> {
  try {
    const res = await ext.tabs.sendMessage(tabId, command('PING', providerId, {}));
    return Boolean(res);
  } catch {
    return false;
  }
}

/**
 * Ensure the broadcast content script is running in a tab, re-injecting it if
 * the tab was discarded by Memory Saver (§5.5).
 */
export async function ensureContentScript(
  tabId: number,
  providerId: ProviderId,
): Promise<boolean> {
  if (await pingTab(tabId, providerId)) return true;
  try {
    await ext.scripting.executeScript({ target: { tabId }, files: ['broadcast.js'] });
  } catch {
    return false;
  }
  // Give the freshly injected script a moment to register its listener.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await pingTab(tabId, providerId)) return true;
  }
  return false;
}

/**
 * The compare window (§5.20): one window holding one tab per provider, reused
 * across prompts rather than opening a tab per prompt.
 */
async function ensureCompareWindow(): Promise<number | undefined> {
  const rt = await getRuntime();
  if (rt.compareWindowId !== undefined) {
    try {
      await ext.windows.get(rt.compareWindowId);
      return rt.compareWindowId;
    } catch {
      // window was closed — fall through and make a new one
    }
  }
  return undefined;
}

/** Find or create this provider's tab, returning its id. */
export async function getOrCreateProviderTab(
  providerId: ProviderId,
  url: string,
): Promise<number | null> {
  const rt = await getRuntime();
  const known = rt.tabs[providerId];
  if (known !== undefined && (await tabExists(known))) return known;

  // Reuse a tab the user already has open on that provider before opening one.
  try {
    const host = new URL(url).hostname;
    const existing = await ext.tabs.query({ url: `*://${host}/*` });
    const usable = existing.find((t) => t.id !== undefined && t.id !== rt.sourceTabId);
    if (usable?.id !== undefined) {
      await updateRuntime((r) => ({ ...r, tabs: { ...r.tabs, [providerId]: usable.id as number } }));
      return usable.id;
    }
  } catch {
    // query is best effort
  }

  const windowId = await ensureCompareWindow();
  try {
    if (windowId === undefined) {
      const win = await ext.windows.create({ url, focused: false });
      const tabId = win?.tabs?.[0]?.id;
      if (tabId === undefined) return null;
      await updateRuntime((r) => ({
        ...r,
        compareWindowId: win?.id,
        tabs: { ...r.tabs, [providerId]: tabId },
      }));
      return tabId;
    }
    const tab = await ext.tabs.create({ url, windowId, active: false });
    if (tab.id === undefined) return null;
    await updateRuntime((r) => ({ ...r, tabs: { ...r.tabs, [providerId]: tab.id as number } }));
    return tab.id;
  } catch {
    return null;
  }
}

export async function forgetProviderTab(providerId: ProviderId): Promise<void> {
  await updateRuntime((r) => {
    const tabs = { ...r.tabs };
    delete tabs[providerId];
    return { ...r, tabs };
  });
}

/** Send a command and return the observation the content script replied with. */
export async function sendCommand(
  tabId: number,
  msg: ReturnType<typeof command>,
): Promise<Observation | null> {
  try {
    const res = await ext.tabs.sendMessage(tabId, msg);
    return parseObservation(res);
  } catch {
    return null;
  }
}

export async function focusTab(tabId: number): Promise<void> {
  try {
    const tab = await ext.tabs.get(tabId);
    await ext.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) await ext.windows.update(tab.windowId, { focused: true });
  } catch {
    // tab vanished — nothing to focus
  }
}
