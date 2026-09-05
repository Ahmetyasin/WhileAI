/**
 * Opens ONE long-lived Chrome on the .pw-profile with the extension loaded,
 * and exposes a CDP port so later scripts drive this same window instead of
 * launching more.
 *
 *   npm run session      # leave it running; log in to the providers by hand
 *
 * Nothing here automates a login: you sign in yourself, Chrome keeps the
 * cookies in the profile directory.
 */
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ctx = await chromium.launchPersistentContext(join(root, '.pw-profile'), {
  channel: 'chrome',
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${join(root, 'dist')}`,
    `--load-extension=${join(root, 'dist')}`,
    '--remote-debugging-port=9333',
  ],
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://chatgpt.com/');

console.log(`
Session window is open (CDP on 127.0.0.1:9333).

Sign in to whichever of these you want tested:
  chatgpt.com · claude.ai · www.perplexity.ai · gemini.google.com · chat.deepseek.com

Leave this window open. Say "go on" and I will drive THIS window — no new
windows will be opened.
`);
await new Promise(() => {});
