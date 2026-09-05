import { defineConfig } from '@playwright/test';

/**
 * E2E against a real Chrome with the unpacked extension loaded (CLAUDE.md §13).
 *
 * Uses the locally installed Chrome (channel: 'chrome') rather than Playwright's
 * bundled Chromium: extensions need a persistent profile, and the profile that
 * matters is one a human has signed into.
 *
 * Never run in CI — these tests need a real browser and, for the live specs, a
 * signed-in profile that only a person can create.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: false,
    trace: 'retain-on-failure',
  },
});
