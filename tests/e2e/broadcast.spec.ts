import { expect, test } from './fixtures';

/**
 * Full broadcast path through a real Chrome with the extension loaded, using
 * the local mock providers — no accounts, no live sites, safe to run often.
 *
 * Start the harness first:  npm run harness
 */
const HARNESS = 'http://localhost:4173';

test.beforeEach(async ({ page }) => {
  const res = await page.goto(HARNESS).catch(() => null);
  test.skip(res === null, 'test harness not running — start it with `npm run harness`');
});

test('the side panel loads and lists every provider', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator('#prompt')).toBeVisible();
  await expect(page.locator('#send')).toBeVisible();
  for (const name of ['ChatGPT', 'Claude', 'Perplexity']) {
    await expect(page.locator('.chip', { hasText: name })).toBeVisible();
  }
});

test('a prompt queued in the panel reaches the queue with one run per provider', async ({
  page,
  extensionId,
  serviceWorker,
}) => {
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Enable a provider, then queue a prompt through the real UI.
  await page.locator('.chip', { hasText: 'ChatGPT' }).locator('input').check();
  await page.locator('#prompt').fill('What is the capital of France?');
  await page.locator('#send').click();

  // The service worker is the source of truth for the queue.
  await expect
    .poll(
      async () =>
        serviceWorker.evaluate(async () => {
          const r = await chrome.storage.local.get('broadcastQueue');
          return r.broadcastQueue?.items?.length ?? 0;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  const item = await serviceWorker.evaluate(async () => {
    const r = await chrome.storage.local.get('broadcastQueue');
    return r.broadcastQueue.items[0];
  });
  expect(item.text).toContain('capital of France');
  expect(Object.keys(item.runs)).toContain('chatgpt');
  expect(item.hash).toHaveLength(64);
});

test('the prompt is typed into a mock provider and submitted', async ({ context, page }) => {
  // The dev build matches localhost, so the broadcast content script runs here.
  const mock = await context.newPage();
  await mock.goto(`${HARNESS}/mock/textarea?ms=1500`);

  // Drive the page the way the content script would, then assert the site
  // actually accepted the prompt (model updated, message committed).
  await mock.evaluate(async () => {
    const el = document.getElementById('composer') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    setter.call(el, 'e2e prompt');
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.getElementById('send')!.click();
  });

  await expect(mock.locator('[data-message-author-role="user"]')).toHaveText('e2e prompt');
  await expect(mock.locator('.assistant')).toContainText('token', { timeout: 15_000 });
  await mock.close();
});

test('the tracking half still records a turn (no regression)', async ({
  context,
  serviceWorker,
}) => {
  const chat = await context.newPage();
  await chat.goto(HARNESS);
  await chat.locator('#send').click();

  await expect
    .poll(
      async () =>
        serviceWorker.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('whileai');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          return new Promise<number>((resolve) => {
            const tx = db.transaction('turns', 'readonly');
            const count = tx.objectStore('turns').count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => resolve(0);
          });
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await chat.close();
});
