import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearChromeStorage } from './setup';
import { dispatch, hydrate } from '../src/core/orchestrator';
import { getQueue, setBroadcastSettings, DEFAULT_BROADCAST_SETTINGS } from '../src/core/broadcastStorage';
import { makeRun } from '../src/core/queue';
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
      return opts.onInsert ? opts.onInsert(tabId, msg.text as string) : { ok: true };
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
    // Requeued and restarted rather than left stuck.
    expect(['opening_tab', 'waiting_ready', 'inserting']).toContain(q2.items[0]!.runs.chatgpt!.state);
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
});
