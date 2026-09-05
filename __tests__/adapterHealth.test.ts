import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearChromeStorage } from './setup';
import { brokenProviders, getHealthLog, reportHealth } from '../src/core/adapterHealth';
import { EMBEDDED_CONFIG, refreshRemoteConfig, validateConfig } from '../src/core/config';

/**
 * The remote-config path is what lets a site redesign be fixed without
 * shipping a new extension, so it is tested as carefully as the queue.
 */
beforeEach(() => {
  clearChromeStorage();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetch(body: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** A valid config at an arbitrary version, covering every embedded platform. */
function configAt(version: number) {
  return { ...structuredClone(EMBEDDED_CONFIG), version };
}

describe('adapter health → self healing', () => {
  it('clears failures when a provider reports healthy', async () => {
    await reportHealth('chatgpt', false, ['sendButton']);
    await reportHealth('chatgpt', true);
    const log = await getHealthLog();
    expect(log.chatgpt?.failures).toBe(0);
    expect(log.chatgpt?.broken).toBe(false);
  });

  it('does not react to a single failure (SPAs render late)', async () => {
    const res = await reportHealth('chatgpt', false, ['composer']);
    expect(res.refreshed).toBe(false);
    expect(res.broken).toBe(false);
  });

  it('forces a config refresh once failures repeat', async () => {
    const fetchMock = mockFetch(configAt(EMBEDDED_CONFIG.version + 1));
    await reportHealth('gemini', false, ['sendButton']);
    const res = await reportHealth('gemini', false, ['sendButton']);
    expect(fetchMock).toHaveBeenCalled();
    expect(res.refreshed).toBe(true);
    // A fresh config earns a clean slate rather than an instant "broken".
    expect(res.broken).toBe(false);
  });

  it('marks the provider broken when no newer config exists', async () => {
    mockFetch(null, false); // config host down / nothing published
    await reportHealth('deepseek', false, ['composer']);
    const res = await reportHealth('deepseek', false, ['composer']);
    expect(res.broken).toBe(true);
    expect(await brokenProviders()).toContain('deepseek');
  });

  it('records what was missing, so a fix can be written without guessing', async () => {
    mockFetch(null, false);
    await reportHealth('chatgpt', false, ['sendButton']);
    await reportHealth('chatgpt', false, ['sendButton', 'composer']);
    const log = await getHealthLog();
    expect(log.chatgpt?.lastMissing).toEqual(['sendButton', 'composer']);
  });
});

describe('remote config safety', () => {
  it('accepts a newer valid config', async () => {
    mockFetch(configAt(EMBEDDED_CONFIG.version + 5));
    expect(await refreshRemoteConfig()).toBe(true);
  });

  it('refuses a config older than the one in effect (no rollback)', async () => {
    mockFetch(configAt(EMBEDDED_CONFIG.version - 1));
    expect(await refreshRemoteConfig()).toBe(false);
  });

  it('refuses a config that dropped a platform', async () => {
    const crippled = configAt(EMBEDDED_CONFIG.version + 1);
    delete (crippled.platforms as Record<string, unknown>).chatgpt;
    mockFetch(crippled);
    expect(await refreshRemoteConfig()).toBe(false);
  });

  it('refuses malformed JSON rather than disabling every adapter', async () => {
    mockFetch({ version: 'not a number', platforms: {} });
    expect(await refreshRemoteConfig()).toBe(false);
  });

  it('refuses a config whose regex cannot compile', async () => {
    const bad = configAt(EMBEDDED_CONFIG.version + 1);
    bad.platforms.chatgpt.endpointPatterns = ['('];
    mockFetch(bad);
    expect(await refreshRemoteConfig()).toBe(false);
  });

  it('survives the config host being unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await refreshRemoteConfig()).toBe(false);
    // and the embedded config still validates, so the extension keeps working
    expect(validateConfig(EMBEDDED_CONFIG)).not.toBeNull();
  });
});
