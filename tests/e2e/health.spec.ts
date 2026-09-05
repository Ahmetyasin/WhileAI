import { expect, test } from './fixtures';

/**
 * Selector health against the LIVE provider sites (CLAUDE.md §13).
 *
 * Requires a profile already signed in to each provider:
 *     npm run e2e:login     # sign in by hand, once
 *     npm run e2e:health
 *
 * Run this manually — never in CI. It needs real sessions, and the sites
 * change underneath it, which is exactly what it is here to detect.
 *
 * It only READS the page. It never sends a prompt to a real account.
 */
const SITES: { id: string; url: string }[] = [
  { id: 'chatgpt', url: 'https://chatgpt.com/' },
  { id: 'claude', url: 'https://claude.ai/new' },
  { id: 'perplexity', url: 'https://www.perplexity.ai/' },
];

for (const site of SITES) {
  test(`${site.id}: adapter selectors still match the live site`, async ({
    context,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await page.goto(site.url, { waitUntil: 'domcontentloaded' });
    // SPAs need a moment before the composer exists.
    await page.waitForTimeout(6000);

    const cfg = await serviceWorker.evaluate(async (id) => {
      const r = await chrome.storage.local.get('remoteSelectorConfig');
      return r.remoteSelectorConfig?.platforms?.[id] ?? null;
    }, site.id);

    const result = await page.evaluate((platform) => {
      const q = (sels: string[]): string | null => {
        for (const s of sels ?? []) {
          try {
            if (document.querySelector(s)) return s;
          } catch {
            /* invalid selector */
          }
        }
        return null;
      };
      return {
        url: location.href,
        composer: q(platform?.composerSelectors ?? []),
        send: q(platform?.sendButtonSelectors ?? []),
        signedOut: /login|signin|sign-in|auth/i.test(location.href),
      };
    }, cfg);

    console.log(`[${site.id}]`, JSON.stringify(result));
    test.skip(result.signedOut, `${site.id}: profile is signed out — run npm run e2e:login`);

    // A composer is the minimum for the adapter to be usable at all.
    expect(result.composer, `${site.id}: no composer selector matched`).not.toBeNull();
    await page.close();
  });
}
