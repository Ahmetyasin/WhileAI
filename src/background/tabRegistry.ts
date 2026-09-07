/**
 * Which open tab belongs to which provider.
 *
 * Split out of background/index.ts so the rules can be tested directly. They
 * decide whether closing a tab switches an AI off, and getting that wrong is
 * very visible: an AI the user never touched stops receiving prompts, or one
 * they deliberately closed keeps reopening.
 *
 * `chrome.tabs.onRemoved` gives only a tab id — the tab is already gone, so
 * its URL cannot be read then. The mapping therefore has to be maintained
 * while the tab is alive.
 */
import type { ProviderId } from '../core/broadcastTypes';

export const PROVIDER_HOSTS: Record<string, ProviderId> = {
  'chatgpt.com': 'chatgpt',
  'claude.ai': 'claude',
  'www.perplexity.ai': 'perplexity',
  'perplexity.ai': 'perplexity',
  'gemini.google.com': 'gemini',
  'chat.deepseek.com': 'deepseek',
};

export function providerForUrl(url: string | undefined): ProviderId | null {
  if (url === undefined || url === '') return null;
  try {
    return PROVIDER_HOSTS[new URL(url).hostname] ?? null;
  } catch {
    return null;
  }
}

/**
 * Tracks provider tabs by id.
 *
 * The important part is `note()` REMOVING a tab that has navigated away. The
 * map used to be add-only: a tab that had once been on claude.ai stayed
 * marked as Claude's forever, so if the user navigated it elsewhere and later
 * closed it, Claude was switched off — an AI they never closed silently
 * stopped receiving prompts.
 */
export class TabRegistry {
  private byTab = new Map<number, ProviderId>();

  /** Record the tab's current URL. Call on every tabs.onUpdated. */
  note(tabId: number, url: string | undefined): void {
    const providerId = providerForUrl(url);
    if (providerId === null) {
      // Only forget when we actually know where the tab went. onUpdated fires
      // with no URL for unrelated changes (title, favicon, audible), and
      // treating those as "navigated away" would drop a tab that never moved.
      if (url !== undefined && url !== '') this.byTab.delete(tabId);
      return;
    }
    this.byTab.set(tabId, providerId);
  }

  get(tabId: number): ProviderId | undefined {
    return this.byTab.get(tabId);
  }

  forget(tabId: number): void {
    this.byTab.delete(tabId);
  }

  /** Tabs currently believed to belong to this provider. */
  tabsFor(providerId: ProviderId): number[] {
    const out: number[] = [];
    for (const [tabId, id] of this.byTab) if (id === providerId) out.push(tabId);
    return out;
  }

  get size(): number {
    return this.byTab.size;
  }
}

/**
 * Should closing this tab switch the provider off?
 *
 * Only when it was the LAST tab for that provider. The user may keep several
 * ChatGPT tabs open and close one without meaning anything by it.
 *
 * `remainingTabIds` comes from a live chrome.tabs.query, which is the
 * authority — the registry can lag behind a tab that was opened moments ago.
 */
export function shouldDisableProvider(
  closedTabId: number,
  remainingTabIds: number[],
): boolean {
  return remainingTabIds.filter((id) => id !== closedTabId).length === 0;
}
