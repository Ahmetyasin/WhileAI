// Dev tool: dump the controls around a provider's composer, before and after
// typing, so send/stop selectors can be written from fact rather than guesswork.
//   node scripts/inspect-composer.mjs gemini
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(readFileSync(join(root, 'config/selectors.json'), 'utf8'));
const id = process.argv[2] ?? 'gemini';
const URLS = {
  chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new',
  perplexity: 'https://www.perplexity.ai/', gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com/',
};

const ctx = await chromium.launchPersistentContext(join(root, '.pw-profile'), {
  channel: 'chrome', headless: false, viewport: null,
});
const page = await ctx.newPage();
await page.goto(URLS[id], { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);

const dump = await page.evaluate(async (platform) => {
  const q = (sels) => { for (const s of sels ?? []) { try { const e = document.querySelector(s); if (e) return e; } catch {} } return null; };
  const describe = (b) => ({
    tag: b.tagName,
    al: b.getAttribute('aria-label'),
    tid: b.getAttribute('data-testid'),
    type: b.getAttribute('type'),
    cls: (b.className.baseVal ?? b.className ?? '').toString().slice(0, 80),
    txt: (b.textContent || '').trim().slice(0, 25),
    dis: b.disabled ?? b.getAttribute('aria-disabled'),
    icon: b.querySelector('svg')?.getAttribute('data-icon')
        ?? b.querySelector('mat-icon')?.getAttribute('fonticon')
        ?? b.querySelector('mat-icon')?.textContent?.trim() ?? null,
  });
  const el = q(platform.composerSelectors);
  // Search the whole document: provider markup nests the composer differently
  // and an ancestor guess can silently match nothing.
  const all = () => [...document.querySelectorAll('button,[role="button"]')].map(describe);
  const before = all();

  let after = null;
  if (el) {
    el.focus();
    try { document.execCommand('insertText', false, 'health probe'); } catch {}
    if (!el.textContent && 'value' in el) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, 'health probe');
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 1500));
    after = all();
  }
  return { lang: document.documentElement.lang, title: document.title, composerFound: !!el, before, after };
}, cfg.platforms[id]);

console.log(JSON.stringify(dump, null, 1));
await ctx.close();
