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
/**
 * A PING must never outlive its usefulness. sendMessage only rejects when
 * there is NO receiver; a script that received the ping and never replied
 * leaves the promise pending forever, and every caller waiting on it — which
 * is how a half-rendered SPA stalled a whole delivery (2026-09-07).
 */
const PING_TIMEOUT_MS = 1500;

export async function pingTab(tabId: number, providerId: ProviderId): Promise<boolean> {
  try {
    const res = await Promise.race([
      ext.tabs.sendMessage(tabId, command('PING', providerId, {})),
      new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), PING_TIMEOUT_MS)),
    ]);
    return res !== TIMED_OUT && Boolean(res);
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
  // Bounded by wall clock, not by iteration count. Each ping has its own 2s
  // ceiling (a script that receives a ping and never answers used to hang the
  // promise outright), so counting iterations could add up to a minute —
  // multiplied again by the retry, that is minutes of the user waiting with
  // nothing on screen. Measured live: a healthy tab answers in well under a
  // second, so 3s is generous, and keeping it tight is what makes a genuinely
  // dead tab surface as an error while the user is still looking at it.
  const deadline = Date.now() + 3000;
  for (let i = 0; Date.now() < deadline; i++) {
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
  const injectedDeadline = Date.now() + 2000;
  while (Date.now() < injectedDeadline) {
    await new Promise((r) => setTimeout(r, 200));
    if (await pingTab(tabId, providerId)) return true;
  }
  return false;
}

/**
 * Make sure the TRACKING content script is running in a tab.
 *
 * Separate from ensureContentScript, which handles the broadcast half. The
 * two are deliberately independent (CLAUDE.md §16: tracking never gains a
 * "send" capability), and only the broadcast script was ever re-injected —
 * so after an extension update or reload, every already-open AI tab silently
 * stopped being MEASURED until the user reloaded it by hand. Seen live
 * 2026-09-07: broadcast runs completing while platformActivity had not been
 * touched for hours.
 *
 * Injecting twice is harmless: the script guards on window.__whileai.
 */
export async function ensureTrackingScript(tabId: number): Promise<void> {
  try {
    await ext.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    // A host we lack permission for, or a tab that closed mid-flight. The
    // manifest-declared script still covers the next navigation.
  }
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
      // Look more than once. These sites navigate when a prompt is submitted
      // (DeepSeek / -> /a/chat/s/<id>, Claude /new -> /chat/<id>), and during
      // that moment the tab can be missing from the query results. A single
      // empty answer was enough to declare "its tab could not be opened" for
      // a tab sitting right in front of the user (live 2026-09-07).
      let open = await ext.tabs.query({ url: origin });
      // One short retry when the query comes back empty. These sites navigate
      // on submit (DeepSeek / -> /a/chat/s/<id>, Claude /new -> /chat/<id>)
      // and the tab can be missing from the results for a moment — long
      // enough to either fail the run outright ("its tab could not be
      // opened", for a tab in plain sight) or open a SECOND tab beside the
      // conversation the user is reading. Both were seen live 2026-09-07.
      //
      // Deliberately brief: this sits on the common delivery path, so it must
      // not add noticeable latency when the tab really is absent.
      if (open.length === 0) {
        await new Promise((r) => setTimeout(r, 400));
        open = await ext.tabs.query({ url: origin });
      }
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
      // naming is cosmetic; the grouping itself is what matters
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
/**
 * How long to wait for a tab to answer a command before treating it as gone.
 *
 * Generous on purpose: INSERT_AND_SUBMIT itself waits up to 8s for a composer
 * and then up to 6s to confirm the prompt landed, so anything under ~20s
 * would abandon deliveries that were about to succeed.
 */
let commandTimeoutMs = 25_000;

/** Test seam: lets the suite exercise the timeout without waiting 25s. */
export function setCommandTimeoutForTests(ms: number): void {
  commandTimeoutMs = ms;
}

/**
 * Send a command to a tab, giving up if it never answers.
 *
 * chrome.tabs.sendMessage only rejects when there is no receiver at all. A
 * content script that RECEIVES the message and then never calls sendResponse
 * leaves the promise pending forever — and with it the run. Seen live
 * 2026-09-07: DeepSeek's SPA reported readyState 'complete' while rendering
 * no composer at all, so the script sat waiting for one and the run stayed
 * 'inserting' until the 5-minute ceiling, telling the user nothing.
 */
export async function sendCommand(
  tabId: number,
  msg: ReturnType<typeof command>,
): Promise<Observation | typeof ALIVE_UNPARSED | null> {
  try {
    const res = await Promise.race([
      ext.tabs.sendMessage(tabId, msg),
      new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), commandTimeoutMs)),
    ]);
    if (res === TIMED_OUT) return null;
    const obs = parseObservation(res);
    if (obs !== null) return obs;
    // The tab answered with something we do not model. That is not a dead
    // tab — it is a live one whose reply we cannot use — so report it as
    // ALIVE_UNPARSED rather than null, which callers treat as "gone".
    return res === undefined || res === null ? null : ALIVE_UNPARSED;
  } catch {
    return null;
  }
}

/** Sentinel distinguishing "timed out" from a tab that genuinely replied. */
const TIMED_OUT = Symbol('timed-out');

/**
 * A tab replied, but with a shape we do not model (an ack from an older
 * script, say). It is alive — only "no reply at all" means the tab cannot be
 * delivered to, and conflating the two would abandon working tabs.
 */
export const ALIVE_UNPARSED = { type: 'ALIVE' } as const;

export async function focusTab(tabId: number): Promise<void> {
  try {
    const tab = await ext.tabs.get(tabId);
    await ext.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) await ext.windows.update(tab.windowId, { focused: true });
  } catch {
    // tab vanished — nothing to focus
  }
}
