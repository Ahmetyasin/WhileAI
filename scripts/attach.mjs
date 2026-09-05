/**
 * Connects to the ALREADY-OPEN session window (scripts/session.mjs) over CDP.
 * Opens no new browser, and no new tab unless a provider has none open.
 */
import { chromium } from '@playwright/test';

export async function attach() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('no context — is `npm run session` still running?');
  return { browser, ctx };
}

/** The existing tab for this origin, or a spare blank one. */
export async function pageFor(ctx, url) {
  const host = new URL(url).hostname;
  for (const p of ctx.pages()) {
    try { if (new URL(p.url()).hostname === host) return p; } catch { /* about:blank */ }
  }
  const spare = ctx.pages().find((p) => p.url() === 'about:blank');
  const page = spare ?? (await ctx.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  return page;
}

export const SITES = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com/',
  claude: 'https://claude.ai/new',
  perplexity: 'https://www.perplexity.ai/',
};
