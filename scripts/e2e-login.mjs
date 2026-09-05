// Opens Chrome on the persistent e2e profile so you can sign in to each
// provider once by hand. Sessions persist in .pw-profile/ for later runs.
//
//   npm run e2e:login
//
// Nothing is automated here and no credentials are read or stored by us —
// you type them into a normal browser window; Chrome keeps the cookies.
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = join(root, '.pw-profile');
const dist = join(root, 'dist');
mkdirSync(profile, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  // See tests/e2e/fixtures.ts: without this the extension never loads.
  ignoreDefaultArgs: [
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
  ],
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://chatgpt.com/');

console.log(`
Profile: ${profile}

Sign in to each provider you want to test:
  • https://chatgpt.com
  • https://claude.ai
  • https://www.perplexity.ai

Close the browser window when you are done. The sessions stay in the profile,
so later runs (npm run e2e, npm run e2e:health) will not ask again.
`);

await context.waitForEvent('close', { timeout: 0 });
