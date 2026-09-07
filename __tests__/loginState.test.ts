import { describe, expect, it } from 'vitest';

/**
 * The popup asks each provider tab whether its composer is ready, to show
 * "ready" or "sign in" beside each AI. That query must never be able to stop
 * the panel rendering.
 *
 * chrome.tabs.sendMessage only rejects when there is NO receiver; a content
 * script that receives the message and never replies leaves the promise
 * pending forever. Awaited in a loop with no ceiling, one stuck tab meant the
 * whole provider list never rendered and the popup opened blank — observed
 * 2026-09-07 while capturing store screenshots.
 */
const TIMEOUT = 50;

async function probe(
  send: () => Promise<unknown>,
  timeoutMs = TIMEOUT,
): Promise<boolean | null> {
  try {
    const res = await Promise.race([
      send(),
      new Promise((resolve) => setTimeout(() => resolve('__timeout'), timeoutMs)),
    ]);
    if (res === '__timeout') return null;
    const r = res as { type?: string; composerReady?: boolean } | undefined;
    return r?.type === 'STATE' ? r.composerReady === true : null;
  } catch {
    return null;
  }
}

describe('provider readiness probe', () => {
  it('reports ready when the tab answers', async () => {
    expect(await probe(async () => ({ type: 'STATE', composerReady: true }))).toBe(true);
  });

  it('reports not-ready when the tab says so', async () => {
    expect(await probe(async () => ({ type: 'STATE', composerReady: false }))).toBe(false);
  });

  it('gives up on a tab that never answers', async () => {
    // The bug: without a ceiling this hangs, and every provider after it in
    // the loop is never asked, so the list never renders at all.
    const start = Date.now();
    expect(await probe(() => new Promise(() => {}))).toBeNull();
    expect(Date.now() - start).toBeLessThan(TIMEOUT * 6);
  });

  it('survives a tab with no content script', async () => {
    expect(await probe(() => Promise.reject(new Error('no receiver')))).toBeNull();
  });

  it('treats an unrecognised reply as unknown rather than throwing', async () => {
    expect(await probe(async () => ({ ok: true }))).toBeNull();
  });

  it('asks every provider even when an early one hangs', async () => {
    // The property that actually matters: one bad tab must not cost the rest.
    const ids = ['a', 'b', 'c'];
    const asked: string[] = [];
    for (const id of ids) {
      asked.push(id);
      await probe(id === 'a' ? () => new Promise(() => {}) : async () => ({ type: 'STATE', composerReady: true }));
    }
    expect(asked).toEqual(ids);
  });
});
