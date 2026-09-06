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

  // A freshly created tab has not loaded yet, so its manifest-declared
  // content script does not exist to answer a PING. Give it a chance before
  // falling back to injection: for a provider whose host permission is
  // OPTIONAL (Gemini, DeepSeek), scripting.executeScript is refused with
  // "Cannot access contents of url", which was reported as TAB_GONE even
  // though the tab was fine and the script arrived moments later.
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await pingTab(tabId, providerId)) return true;
    try {
      const tab = await ext.tabs.get(tabId);
      // Loaded and still silent: injection is the right next step.
      if (tab.status === 'complete' && i >= 5) break;
    } catch {
      return false; // tab really is gone
    }
  }

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

  // Deliberately NOT adopting an arbitrary tab the user already has open on
  // this provider: broadcasting types into the composer and presses send, so
  // adopting a tab the user is holding a conversation in would inject an
  // unrelated prompt into that conversation. Only a tab this extension opened
  // (tracked above in runtime.tabs) is reused; otherwise a new one is opened.

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
      await labelCompareTabs([tabId]);
      return tabId;
    }
    const tab = await ext.tabs.create({ url, windowId, active: false });
    if (tab.id === undefined) return null;
    await updateRuntime((r) => ({ ...r, tabs: { ...r.tabs, [providerId]: tab.id as number } }));
    await labelCompareTabs([tab.id]);
    return tab.id;
  } catch {
    return null;
  }
}

/**
 * Put the broadcast tabs in a named, coloured tab group (§5.20).
 *
 * An unlabelled window of AI tabs is indistinguishable from the user's own,
 * which was the single most confusing thing in testing — people looked at
 * their own tabs, saw nothing, and assumed the prompt had never been sent.
 * A "whileAI" group makes it obvious which tabs the extension opened and
 * which are theirs. Purely cosmetic: if tabGroups is unavailable the
 * broadcast works exactly as before.
 */
async function labelCompareTabs(tabIds: number[]): Promise<void> {
  try {
    const groups = ext.tabGroups;
    if (!groups || typeof ext.tabs.group !== 'function') return;
    // tabGroups is OPTIONAL: purely cosmetic, so it is never requested up
    // front and its absence must not change behaviour.
    const granted = await ext.permissions.contains({ permissions: ['tabGroups'] });
    if (!granted) return;
    const groupId = await ext.tabs.group({ tabIds });
    await groups.update(groupId, { title: 'whileAI', color: 'blue', collapsed: false });
  } catch {
    // Tab groups are a nicety, never a requirement.
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
