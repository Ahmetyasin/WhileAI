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
 * Register the tab the user typed in as this provider's tab, and put it in
 * the whileAI group.
 *
 * Without this the user prompts in their own Gemini tab, the extension does
 * not recognise it, and the next broadcast opens a SECOND Gemini tab — while
 * the conversation they are actually reading sits outside the group. Adopting
 * is safe here precisely because the prompt came FROM this tab: the user has
 * already chosen it as the place this conversation happens.
 */
export async function adoptSourceTab(
  providerId: ProviderId,
  tabId: number,
): Promise<void> {
  const rt = await getRuntime();
  if (rt.tabs[providerId] === tabId) return; // already ours
  await updateRuntime((r) => ({ ...r, tabs: { ...r.tabs, [providerId]: tabId } }));
  await addToWhileAIGroup(tabId);
}

/** Find or create this provider's tab, returning its id. */
export async function getOrCreateProviderTab(
  providerId: ProviderId,
  url: string,
  allowOpen = true,
): Promise<number | null> {
  const rt = await getRuntime();
  const known = rt.tabs[providerId];
  if (known !== undefined && (await tabExists(known))) return known;

  // Adopt a tab the user already has open on this provider rather than adding
  // a second one. Typing into their existing conversation is exactly what the
  // product does — they enabled this provider — and opening a duplicate left
  // the conversation they were reading outside the group.
  const origin = PROVIDER_ORIGIN_PATTERNS[providerId];
  if (origin !== undefined) {
    try {
      const open = await ext.tabs.query({ url: origin });
      const adopt = open.find((t) => t.id !== undefined);
      if (adopt?.id !== undefined) {
        await updateRuntime((r) => ({ ...r, tabs: { ...r.tabs, [providerId]: adopt.id as number } }));
        await addToWhileAIGroup(adopt.id);
        return adopt.id;
      }
    } catch {
      // fall through to opening one
    }
  }

  // No tab at all: the user closed it, which turns the provider off (see
  // forgetTab). Do not resurrect it — sending into a tab they deliberately
  // closed, in a fresh conversation, is a surprise.
  if (!allowOpen) return null;

  // Open in the CURRENT window as a tab, never a new window. A separate
  // window was the single most confusing thing about the product: the user
  // looked at their own tabs, saw nothing, and assumed nothing was sent.
  // Everything lives in one "whileAI" tab group instead.
  try {
    const tab = await ext.tabs.create({ url, active: false });
    if (tab.id === undefined) return null;
    await updateRuntime((r) => ({ ...r, tabs: { ...r.tabs, [providerId]: tab.id as number } }));
    await addToWhileAIGroup(tab.id);
    return tab.id;
  } catch {
    return null;
  }
}

/**
 * Put a broadcast tab into the shared "whileAI" group (§5.20).
 *
 * The group is the organising idea: every tab the extension opens joins it,
 * so the user can see at a glance which tabs are theirs and which are ours,
 * collapse the lot, or close them together. Reusing one group also means a
 * second Gemini tab the user opened themselves is never touched.
 */
// Group creation is serialised. Broadcasting opens several tabs at once, and
// two of them racing addToWhileAIGroup both saw "no group yet", each created
// one, and the tabs ended up split across two groups (seen live 2026-09-07:
// Claude alone in a second group). One at a time, the second joins the first.
const PROVIDER_ORIGIN_PATTERNS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com/*',
  claude: 'https://claude.ai/*',
  perplexity: 'https://www.perplexity.ai/*',
  gemini: 'https://gemini.google.com/*',
  deepseek: 'https://chat.deepseek.com/*',
};

let groupChain: Promise<unknown> = Promise.resolve();

async function addToWhileAIGroup(tabId: number): Promise<void> {
  const run = groupChain.then(() => addToWhileAIGroupUnlocked(tabId));
  groupChain = run.catch(() => {});
  return run;
}

async function addToWhileAIGroupUnlocked(tabId: number): Promise<void> {
  try {
    if (typeof ext.tabs.group !== 'function') return;
    const rt = await getRuntime();
    // Join the existing group when it is still alive.
    if (rt.groupId !== undefined) {
      try {
        await ext.tabs.group({ groupId: rt.groupId, tabIds: [tabId] });
        return;
      } catch {
        // group was closed — fall through and make a new one
      }
    }
    const groupId = await ext.tabs.group({ tabIds: [tabId] });
    await updateRuntime((r) => ({ ...r, groupId }));
    try {
      await ext.tabGroups?.update(groupId, { title: 'whileAI', color: 'blue' });
    } catch {
      // titling needs the tabGroups permission; grouping alone still helps
    }
  } catch {
    // Grouping is a nicety and must never break delivery.
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
