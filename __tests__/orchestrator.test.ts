import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearChromeStorage } from './setup';
import { dispatch, hydrate } from '../src/core/orchestrator';
import { getQueue, setBroadcastSettings, DEFAULT_BROADCAST_SETTINGS } from '../src/core/broadcastStorage';
import { makeRun } from '../src/core/queue';
import { setCommandTimeoutForTests } from '../src/core/tabs';
import type { PromptItem, ProviderId } from '../src/core/broadcastTypes';

/**
 * Drives the real orchestrator against a scripted chrome.* so the whole
 * send path — reducer, storage, tab handling, command dispatch — is exercised
 * without a browser.
 */

interface FakeTab { id: number; url: string; alive: boolean }

function scriptChrome(opts: {
  /** How each tab replies to INSERT_AND_SUBMIT. */
  onInsert?: (tabId: number, text: string) => unknown;
  /** What GET_STATE reports (used by reconciliation). */
  state?: () => unknown;
  failTabCreate?: boolean;
}) {
  const tabs = new Map<number, FakeTab>();
  let nextId = 100;
  const sent: { tabId: number; type: string; text?: string }[] = [];

  const c = globalThis.chrome as unknown as Record<string, any>;

  c.tabs.query = vi.fn(async () => []);
  c.windows.create = vi.fn(async ({ url }: { url: string }) => {
    if (opts.failTabCreate) throw new Error('cannot create');
    const id = nextId++;
    tabs.set(id, { id, url, alive: true });
    return { id: 10, tabs: [{ id }] };
  });
  c.tabs.create = vi.fn(async ({ url }: { url: string }) => {
    if (opts.failTabCreate) throw new Error('cannot create');
    const id = nextId++;
    tabs.set(id, { id, url, alive: true });
    return { id };
  });
  c.tabs.get = vi.fn(async (id: number) => {
    const t = tabs.get(id);
    if (!t) throw new Error('No tab with id');
    return { id, url: t.url, windowId: 10 };
  });
  c.windows.get = vi.fn(async () => ({ id: 10 }));
  c.tabs.sendMessage = vi.fn(async (tabId: number, msg: Record<string, unknown>) => {
    const t = tabs.get(tabId);
    if (!t || !t.alive) throw new Error('Receiving end does not exist');
    sent.push({ tabId, type: msg.type as string, text: msg.text as string | undefined });
    if (msg.type === 'PING') return { ok: true };
    if (msg.type === 'GET_STATE') return opts.state ? opts.state() : { ok: true };
    if (msg.type === 'INSERT_AND_SUBMIT') {
      // A real content script always answers with an observation describing
      // the outcome; the default here mirrors a successful send.
      return opts.onInsert
        ? opts.onInsert(tabId, msg.text as string)
        : {
            v: 1,
            ts: Date.now(),
            providerId: msg.providerId,
            type: 'SUBMITTED',
            promptId: msg.promptId,
          };
    }
    return { ok: true };
  });

  return { tabs, sent };
}

function promptItem(id: string, providers: ProviderId[]): PromptItem {
  const runs: PromptItem['runs'] = {};
  for (const p of providers) runs[p] = makeRun(p, Date.now());
  return {
    id,
    text: 'what is the capital of France?',
    hash: `hash-${id}`,
    createdAt: Date.now(),
    sourceProviderId: null,
    mode: 'continue',
    runs,
  };
}

beforeEach(async () => {
  clearChromeStorage();
  await setBroadcastSettings({
    ...DEFAULT_BROADCAST_SETTINGS,
    providers: {
      ...DEFAULT_BROADCAST_SETTINGS.providers,
      chatgpt: { enabled: true, maxWaitMs: 300_000, longMode: false },
      claude: { enabled: true, maxWaitMs: 300_000, longMode: false },
    },
  });
});

describe('orchestrator end-to-end (no browser)', () => {
  it('opens a tab and delivers the prompt to every enabled provider', async () => {
    const { sent } = scriptChrome({});
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt', 'claude']) });

    // A tab was opened and the content script pinged for each provider.
    const inserts = sent.filter((s) => s.type === 'INSERT_AND_SUBMIT');
    expect(sent.some((s) => s.type === 'PING')).toBe(true);

    // Tabs report READY (the content script does this on its own).
    const queue = await getQueue();
    const tabIds = Object.values(queue.items[0]!.runs).map((r) => r.tabId);
    expect(tabIds.every((t) => typeof t === 'number')).toBe(true);

    for (const [providerId, run] of Object.entries(queue.items[0]!.runs)) {
      await dispatch({ kind: 'ready', providerId: providerId as ProviderId, tabId: run.tabId! });
    }

    const after = sent.filter((s) => s.type === 'INSERT_AND_SUBMIT');
    expect(after.length).toBe(2);
    expect(after[0]!.text).toContain('capital of France');
    expect(inserts.length).toBe(0); // none before READY
  });

  /**
   * Found in the loaded extension 2026-09-06: every run sat in waiting_ready
   * with the provider tabs open and idle. A content script injected into an
   * ALREADY-loaded page (tab reuse, or re-injection after a discard) has no
   * not-ready -> ready transition to report, so its own READY never fires.
   * The orchestrator asks GET_STATE for exactly this case but was throwing
   * the reply away. Note the other tests dispatch 'ready' by hand, which is
   * why this never showed up.
   */
  it('starts the send when GET_STATE says the composer was already ready', async () => {
    const { sent } = scriptChrome({
      state: () => ({
        v: 1, ts: Date.now(), type: 'STATE', providerId: 'chatgpt',
        composerReady: true, generating: false, lastUserHash: null,
      }),
    });
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });

    // No manual 'ready' dispatch: the reply alone must move the run on.
    const queue = await getQueue();
    expect(queue.items[0]!.runs.chatgpt!.state).not.toBe('waiting_ready');
    expect(sent.filter((s) => s.type === 'INSERT_AND_SUBMIT').length).toBe(1);
  });

  it('does not re-send a prompt that already landed before a worker restart (§5.3)', async () => {
    // The page reports the prompt hash as the newest user message.
    const { sent } = scriptChrome({ state: () => ({
      v: 1, ts: Date.now(), providerId: 'chatgpt', type: 'STATE',
      composerReady: true, generating: true, lastUserHash: 'hash-p1',
    }) });

    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    const q1 = await getQueue();
    const tabId = q1.items[0]!.runs.chatgpt!.tabId!;
    await dispatch({ kind: 'ready', providerId: 'chatgpt', tabId });

    const before = sent.filter((s) => s.type === 'INSERT_AND_SUBMIT').length;
    expect(before).toBe(1);

    // Worker dies here; on wake, hydrate reconciles instead of resending.
    await hydrate();

    const after = sent.filter((s) => s.type === 'INSERT_AND_SUBMIT').length;
    expect(after).toBe(before); // no duplicate send
    const q2 = await getQueue();
    expect(q2.items[0]!.runs.chatgpt!.state).toBe('submitted');
  });

  it('re-sends when the reconciliation shows the prompt never landed', async () => {
    const { sent } = scriptChrome({ state: () => ({
      v: 1, ts: Date.now(), providerId: 'chatgpt', type: 'STATE',
      composerReady: true, generating: false, lastUserHash: null,
    }) });

    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    const q1 = await getQueue();
    await dispatch({ kind: 'ready', providerId: 'chatgpt', tabId: q1.items[0]!.runs.chatgpt!.tabId! });
    const before = sent.filter((s) => s.type === 'INSERT_AND_SUBMIT').length;

    await hydrate();
    const q2 = await getQueue();
    // Requeued and restarted rather than left stuck. Since the page reports a
    // ready composer, the restart now runs straight through to the send
    // instead of parking in waiting_ready.
    expect(['opening_tab', 'waiting_ready', 'inserting', 'submitted'])
      .toContain(q2.items[0]!.runs.chatgpt!.state);
    expect(before).toBe(1);
  });

  it('marks the run failed when a tab cannot be opened', async () => {
    scriptChrome({ failTabCreate: true });
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    const q = await getQueue();
    // First failure is retried once, so it lands back in a starting state or error.
    const state = q.items[0]!.runs.chatgpt!.state;
    expect(['error', 'queued', 'opening_tab']).toContain(state);
  });

  it('reports an insert failure as a failed run, not a silent success', async () => {
    scriptChrome({
      onInsert: () => ({
        v: 1, ts: Date.now(), providerId: 'chatgpt', type: 'ERROR', code: 'INSERT_FAILED',
      }),
    });
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    const q1 = await getQueue();
    await dispatch({ kind: 'ready', providerId: 'chatgpt', tabId: q1.items[0]!.runs.chatgpt!.tabId! });

    // The content script's ERROR reply arrives as an explicit event. The first
    // failure buys one automatic retry (§7), so the run must be driven through
    // a second ready/insert cycle before it is allowed to give up.
    await dispatch({ kind: 'failed', promptId: 'p1', providerId: 'chatgpt', code: 'INSERT_FAILED' });
    const retry = await getQueue();
    await dispatch({
      kind: 'ready',
      providerId: 'chatgpt',
      tabId: retry.items[0]!.runs.chatgpt!.tabId!,
    });
    await dispatch({ kind: 'failed', promptId: 'p1', providerId: 'chatgpt', code: 'INSERT_FAILED' });
    const q2 = await getQueue();
    expect(q2.items[0]!.runs.chatgpt!.state).toBe('error');
    expect(q2.items[0]!.runs.chatgpt!.errorCode).toBe('INSERT_FAILED');
  });

  it('queues a second prompt behind the first for the same provider', async () => {
    scriptChrome({});
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    await dispatch({ kind: 'enqueue', item: { ...promptItem('p2', ['chatgpt']), hash: 'hash-p2' } });
    const q = await getQueue();
    expect(q.items).toHaveLength(2);
    expect(q.items[1]!.runs.chatgpt!.state).toBe('queued');
  });

  it('persists the queue so a restarted worker sees the same runs', async () => {
    scriptChrome({});
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    // A fresh read simulates the worker waking with no memory.
    const q = await getQueue();
    expect(q.items[0]!.id).toBe('p1');
    expect(q.items[0]!.runs.chatgpt).toBeDefined();
  });

  it('turns an insert failure reply into a failed run without waiting for the timeout', async () => {
    // The content script answers INSERT_AND_SUBMIT with the outcome rather
    // than reporting it separately. Dropping that reply left the run sitting
    // in 'inserting' — the panel claiming it was typing — until it timed out.
    scriptChrome({
      onInsert: () => ({
        v: 1, ts: Date.now(), providerId: 'chatgpt', type: 'ERROR',
        code: 'INSERT_FAILED', detail: 'composer rejected the text',
      }),
    });
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    const q1 = await getQueue();
    await dispatch({ kind: 'ready', providerId: 'chatgpt', tabId: q1.items[0]!.runs.chatgpt!.tabId! });

    const q2 = await getQueue();
    const run = q2.items[0]!.runs.chatgpt!;
    // One automatic retry is allowed, so it must be retrying or already failed
    // — but never still claiming to be inserting.
    expect(run.state).not.toBe('inserting');
    expect(run.errorCode).toBe('INSERT_FAILED');
  });

  it('advances the run to submitted when the page confirms the send', async () => {
    scriptChrome({
      onInsert: () => ({
        v: 1, ts: Date.now(), providerId: 'chatgpt', type: 'SUBMITTED', promptId: 'p1',
      }),
    });
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    const q1 = await getQueue();
    await dispatch({ kind: 'ready', providerId: 'chatgpt', tabId: q1.items[0]!.runs.chatgpt!.tabId! });

    const q2 = await getQueue();
    expect(q2.items[0]!.runs.chatgpt!.state).toBe('submitted');
  });

  it('treats a silent tab as a delivery failure rather than hanging', async () => {
    scriptChrome({ onInsert: () => undefined });
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    const q1 = await getQueue();
    await dispatch({ kind: 'ready', providerId: 'chatgpt', tabId: q1.items[0]!.runs.chatgpt!.tabId! });

    const q2 = await getQueue();
    expect(q2.items[0]!.runs.chatgpt!.state).not.toBe('inserting');
  });

  it('parks the run on a login wall reported at insert time', async () => {
    scriptChrome({
      onInsert: () => ({
        v: 1, ts: Date.now(), providerId: 'chatgpt', type: 'NOT_LOGGED_IN',
      }),
    });
    await dispatch({ kind: 'enqueue', item: promptItem('p1', ['chatgpt']) });
    const q1 = await getQueue();
    await dispatch({ kind: 'ready', providerId: 'chatgpt', tabId: q1.items[0]!.runs.chatgpt!.tabId! });

    const q2 = await getQueue();
    expect(q2.items[0]!.runs.chatgpt!.state).toBe('needs_login');
  });
});

/**
 * A prompt that lands in some conversations but not others leaves the user's
 * chat histories out of step, and they only discover it later. So a single
 * signed-out provider holds the entire broadcast back rather than sending a
 * partial one. A provider with no open tab is NOT evidence of anything — the
 * extension will open one, and the normal needs_login flow takes over there.
 */
describe('signed-out providers block the whole broadcast', () => {
  it('refuses to enqueue when an enabled provider shows a login wall', async () => {
    const { handleBroadcastMessage } = await import('../src/background/broadcast');
    const c = globalThis.chrome as unknown as Record<string, any>;

    await setBroadcastSettings({
      ...DEFAULT_BROADCAST_SETTINGS,
      providers: {
        ...DEFAULT_BROADCAST_SETTINGS.providers,
        chatgpt: { enabled: true, maxWaitMs: 300_000, longMode: false },
        claude: { enabled: true, maxWaitMs: 300_000, longMode: false },
      },
    });

    c.tabs.query = vi.fn(async ({ url }: { url: string }) =>
      url.includes('claude') ? [{ id: 7, url: 'https://claude.ai/' }] : [],
    );
    // Claude reports no composer: it is showing a login wall.
    c.tabs.sendMessage = vi.fn(async () => ({
      v: 1, type: 'STATE', providerId: 'claude',
      composerReady: false, generating: false, lastUserHash: null,
    }));
    c.permissions = { contains: vi.fn(async () => false) };

    const res = (await handleBroadcastMessage(
      { kind: 'broadcast:enqueue', item: promptItem('p1', ['chatgpt', 'claude']) } as never,
      {} as never,
    )) as { ok: boolean; blocked?: string[] };

    expect(res.ok).toBe(false);
    expect(res.blocked).toContain('claude');
    // Nothing was queued at all — not even for the provider that was ready.
    expect((await getQueue()).items).toHaveLength(0);
  });

  it('does not block when a provider simply has no tab open yet', async () => {
    const { handleBroadcastMessage } = await import('../src/background/broadcast');
    const c = globalThis.chrome as unknown as Record<string, any>;

    await setBroadcastSettings({
      ...DEFAULT_BROADCAST_SETTINGS,
      providers: {
        ...DEFAULT_BROADCAST_SETTINGS.providers,
        chatgpt: { enabled: true, maxWaitMs: 300_000, longMode: false },
      },
    });
    c.tabs.query = vi.fn(async () => []); // no tabs anywhere
    c.permissions = { contains: vi.fn(async () => false) };

    const res = (await handleBroadcastMessage(
      { kind: 'broadcast:enqueue', item: promptItem('p2', ['chatgpt']) } as never,
      {} as never,
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect((await getQueue()).items).toHaveLength(1);
  });
});

describe('orchestrator — a tab that never answers', () => {
  it('fails the run instead of hanging forever on a silent tab', { timeout: 40_000 }, async () => {
    // Observed live 2026-09-07: DeepSeek's SPA reported readyState
    // 'complete' while rendering nothing — no composer, no content script
    // state. The content script sat waiting for a composer that never
    // appeared and never called sendResponse, so chrome.tabs.sendMessage
    // never settled and the run stayed 'inserting' indefinitely. Only the
    // 5-minute ceiling would eventually free it, with the user told nothing
    // in the meantime.
    // Production waits 25s — long enough for the content script's own composer
    // wait. Shortened here so the suite stays fast; the behaviour under test
    // is that the wait ENDS, not how long it is.
    setCommandTimeoutForTests(200);
    try {
      scriptChrome({});
      // The real failure: the content script RECEIVES the message and never
      // calls sendResponse, so the promise never settles. That is different
      // from "no receiver", which rejects immediately.
      (globalThis.chrome as unknown as Record<string, any>).tabs.sendMessage = vi.fn(
        () => new Promise(() => {}),
      );
      await dispatch({ kind: 'enqueue', item: promptItem('p-hang', ['chatgpt']) });
      await vi.waitFor(
        async () => {
          const q = await getQueue();
          expect(q.items[0]!.runs.chatgpt!.state).toBe('error');
        },
        // The recovery legitimately takes seconds — ping ceiling, then the
        // injection fallback. What matters is that it ENDS rather than
        // sitting in waiting_ready until the 5-minute cap.
        { timeout: 35_000 },
      );
      // And it says WHY, so the popup and notification can explain it.
      const q = await getQueue();
      expect(q.items[0]!.runs.chatgpt!.errorCode).toBe('TAB_GONE');
    } finally {
      setCommandTimeoutForTests(25_000);
    }
  });
});
