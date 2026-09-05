import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const DIST = join(root, 'dist');
/**
 * Persistent profile. `npm run e2e:login` opens a browser against this
 * directory so a human can sign in once; every later run reuses those
 * sessions. Git-ignored — it holds real cookies.
 */
export const PROFILE = join(root, '.pw-profile');

/** Our worker, not one of Chrome's own component extensions. */
function findOurWorker(context: BrowserContext): Worker | undefined {
  return context.serviceWorkers().find((w) => w.url().includes('/background.js'));
}

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}>({
  context: async ({}, use) => {
    if (!existsSync(DIST)) {
      throw new Error('dist/ missing — run `npm run build:dev` first');
    }
    mkdirSync(PROFILE, { recursive: true });
    const context = await chromium.launchPersistentContext(PROFILE, {
      channel: 'chrome',
      headless: false,
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
      ],
      // Playwright adds --disable-extensions and disables component extensions
      // with background pages by default, which silently prevents the unpacked
      // extension from loading at all: the browser starts, but no service
      // worker ever registers. Dropping those two defaults is what makes
      // --load-extension take effect.
      ignoreDefaultArgs: [
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
      ],
    });
    await use(context);
    await context.close();
  },

  // The MV3 service worker doubles as the handle for the extension's id.
  //
  // Chrome 152 no longer honours --load-extension when the browser is started
  // by an automation driver (and, on this machine, not from the command line
  // at all), so the worker may never appear. When that happens the tests skip
  // with an explanation instead of timing out for two minutes each: the fix is
  // a human loading dist/ once via chrome://extensions, not a code change.
  serviceWorker: async ({ context }, use) => {
    let sw = findOurWorker(context);
    if (!sw) {
      const deadline = Date.now() + 15_000;
      while (!sw && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        sw = findOurWorker(context);
      }
    }
    if (!sw) {
      base.skip(
        true,
        'Extension did not load. Chrome 152 ignores --load-extension under ' +
          'automation; load dist/ manually via chrome://extensions (Developer ' +
          'mode → Load unpacked) in the .pw-profile profile, then re-run.',
      );
      return;
    }
    await use(sw);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;
