import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  emptyQueue,
  findRun,
  forgetSettledText,
  makeRun,
  reduce,
  type QueuePolicy,
} from '../src/core/queue';
import type { Command, PromptItem, ProviderId } from '../src/core/broadcastTypes';

const T0 = 1_700_000_000_000;

function item(
  id: string,
  providers: ProviderId[],
  over: Partial<PromptItem> = {},
): PromptItem {
  const runs: PromptItem['runs'] = {};
  for (const p of providers) runs[p] = makeRun(p, T0);
  return {
    id,
    text: `text of ${id}`,
    hash: `hash-${id}`,
    createdAt: T0,
    sourceProviderId: null,
    mode: 'continue',
    runs,
    ...over,
  };
}

const opens = (cs: Command[]): ProviderId[] =>
  cs.filter((c): c is Extract<Command, { kind: 'open_tab' }> => c.kind === 'open_tab').map((c) => c.providerId);

describe('queue reducer (§3.2, §7)', () => {
  it('enqueue starts one run per target provider immediately', () => {
    const r = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt', 'claude']) }, T0);
    expect(opens(r.commands).sort()).toEqual(['chatgpt', 'claude']);
    expect(findRun(r.state, 'p1', 'chatgpt')!.state).toBe('opening_tab');
  });

  it('dedupes a repeated hash inside the 10s window (§5.13)', () => {
    const a = item('p1', ['chatgpt']);
    const b = { ...item('p2', ['chatgpt']), hash: a.hash };
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: a }, T0).state;
    s = reduce(s, { kind: 'enqueue', item: b }, T0 + 5_000).state;
    expect(s.items).toHaveLength(1);
  });

  it('accepts the same hash again once the window has passed', () => {
    const a = item('p1', ['chatgpt']);
    const b = { ...item('p2', ['chatgpt']), hash: a.hash };
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: a }, T0).state;
    s = reduce(s, { kind: 'enqueue', item: b }, T0 + 11_000).state;
    expect(s.items).toHaveLength(2);
  });

  it('drives the happy path opening_tab -> waiting_ready -> inserting -> submitted -> generating -> done', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 7 }, T0 + 10).state;
    expect(findRun(s, 'p1', 'chatgpt')!.state).toBe('waiting_ready');

    const ready = reduce(s, { kind: 'ready', providerId: 'chatgpt', tabId: 7 }, T0 + 20);
    s = ready.state;
    expect(findRun(s, 'p1', 'chatgpt')!.state).toBe('inserting');
    expect(ready.commands.some((c) => c.kind === 'insert_and_submit')).toBe(true);

    s = reduce(s, { kind: 'submitted', promptId: 'p1', providerId: 'chatgpt' }, T0 + 30).state;
    s = reduce(s, { kind: 'generating', promptId: 'p1', providerId: 'chatgpt' }, T0 + 40).state;
    const fin = reduce(s, { kind: 'done', promptId: 'p1', providerId: 'chatgpt' }, T0 + 50);
    expect(findRun(fin.state, 'p1', 'chatgpt')!.state).toBe('done');
    expect(fin.state.items[0]!.runs.chatgpt!.completedAt).toBe(T0 + 50);
    expect(fin.commands.some((c) => c.kind === 'record_run')).toBe(true);
  });

  it('holds the second prompt while the provider lane is busy (§7)', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    const second = reduce(s, { kind: 'enqueue', item: item('p2', ['chatgpt']) }, T0 + 100);
    s = second.state;
    expect(opens(second.commands)).toEqual([]); // lane occupied by p1
    expect(findRun(s, 'p2', 'chatgpt')!.state).toBe('queued');
  });

  it('starts the queued prompt once the lane frees, respecting the 3s gap (§5.18)', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'enqueue', item: item('p2', ['chatgpt']) }, T0 + 100).state;

    // p1 finishes; the gap has not elapsed, so p2 must wait and a tick is asked for.
    const doneRes = reduce(s, { kind: 'done', promptId: 'p1', providerId: 'chatgpt' }, T0 + 1000);
    s = doneRes.state;
    expect(opens(doneRes.commands)).toEqual([]);
    expect(doneRes.commands.some((c) => c.kind === 'schedule')).toBe(true);
    expect(findRun(s, 'p2', 'chatgpt')!.state).toBe('queued');

    const tick = reduce(s, { kind: 'tick' }, T0 + 1000 + 3001);
    expect(opens(tick.commands)).toEqual(['chatgpt']);
  });

  it('keeps providers independent: a slow claude does not block chatgpt', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt', 'claude']) }, T0).state;
    s = reduce(s, { kind: 'enqueue', item: item('p2', ['chatgpt', 'claude']) }, T0 + 10).state;
    // chatgpt finishes p1 long after the gap; claude is still running.
    s = reduce(s, { kind: 'done', promptId: 'p1', providerId: 'chatgpt' }, T0 + 20_000).state;
    const tick = reduce(s, { kind: 'tick' }, T0 + 30_000);
    expect(opens(tick.commands)).toEqual(['chatgpt']);
    expect(findRun(tick.state, 'p2', 'claude')!.state).toBe('queued');
  });

  it('lockstep holds prompt 2 until every provider settled prompt 1', () => {
    const policy: QueuePolicy = { ...DEFAULT_POLICY, lockstep: true, minGapMs: 0 };
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt', 'claude']) }, T0, policy).state;
    s = reduce(s, { kind: 'enqueue', item: item('p2', ['chatgpt']) }, T0 + 10, policy).state;
    s = reduce(s, { kind: 'done', promptId: 'p1', providerId: 'chatgpt' }, T0 + 100, policy).state;

    const stillBlocked = reduce(s, { kind: 'tick' }, T0 + 200, policy);
    expect(opens(stillBlocked.commands)).toEqual([]); // claude still running

    const unblocked = reduce(stillBlocked.state, { kind: 'done', promptId: 'p1', providerId: 'claude' }, T0 + 300, policy);
    expect(opens(unblocked.commands)).toEqual(['chatgpt']);
  });

  it('retries an error once, then gives up and notifies (§7)', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 5 }, T0 + 10).state;
    s = reduce(s, { kind: 'ready', providerId: 'chatgpt', tabId: 5 }, T0 + 20).state;
    expect(findRun(s, 'p1', 'chatgpt')!.attempts).toBe(1);

    // First failure -> back to queued for one more attempt.
    const first = reduce(s, { kind: 'failed', promptId: 'p1', providerId: 'chatgpt', code: 'INSERT_FAILED' }, T0 + 30);
    expect(findRun(first.state, 'p1', 'chatgpt')!.state).toBe('opening_tab'); // rescheduled at once
    s = reduce(first.state, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 6 }, T0 + 40).state;
    s = reduce(s, { kind: 'ready', providerId: 'chatgpt', tabId: 6 }, T0 + 50).state;
    expect(findRun(s, 'p1', 'chatgpt')!.attempts).toBe(2);

    // Second failure -> terminal error + notification.
    const second = reduce(s, { kind: 'failed', promptId: 'p1', providerId: 'chatgpt', code: 'INSERT_FAILED' }, T0 + 60);
    expect(findRun(second.state, 'p1', 'chatgpt')!.state).toBe('error');
    expect(second.commands.some((c) => c.kind === 'notify' && c.level === 'error')).toBe(true);
  });

  it('never retries a login block, and notifies once (§5.16)', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['gemini']) }, T0).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'gemini', tabId: 3 }, T0 + 10).state;
    const res = reduce(s, { kind: 'not_logged_in', providerId: 'gemini' }, T0 + 20);
    expect(findRun(res.state, 'p1', 'gemini')!.state).toBe('needs_login');
    expect(res.commands.some((c) => c.kind === 'notify' && c.level === 'needs_login')).toBe(true);
    // no new attempt is scheduled
    expect(opens(res.commands)).toEqual([]);
  });

  it('never retries or waits out a challenge (§5.17)', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 3 }, T0 + 10).state;
    const res = reduce(s, { kind: 'challenge', providerId: 'chatgpt' }, T0 + 20);
    expect(findRun(res.state, 'p1', 'chatgpt')!.state).toBe('blocked_challenge');
    expect(res.commands.some((c) => c.kind === 'notify' && c.level === 'blocked_challenge')).toBe(true);
    const later = reduce(res.state, { kind: 'tick' }, T0 + 600_000);
    expect(opens(later.commands)).toEqual([]);
  });

  it('times out a run that exceeds the provider ceiling (§5.11)', () => {
    const policy: QueuePolicy = { ...DEFAULT_POLICY, defaultMaxWaitMs: 60_000 };
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0, policy).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 9 }, T0 + 10, policy).state;
    s = reduce(s, { kind: 'ready', providerId: 'chatgpt', tabId: 9 }, T0 + 20, policy).state;
    s = reduce(s, { kind: 'submitted', promptId: 'p1', providerId: 'chatgpt' }, T0 + 30, policy).state;

    const res = reduce(s, { kind: 'tick' }, T0 + 61_000, policy);
    expect(findRun(res.state, 'p1', 'chatgpt')!.state).toBe('timeout');
    expect(res.commands.some((c) => c.kind === 'notify' && c.level === 'timeout')).toBe(true);
  });

  it('honours a per-provider maxWaitMs (long mode)', () => {
    const policy: QueuePolicy = { ...DEFAULT_POLICY, defaultMaxWaitMs: 60_000, maxWaitMs: { chatgpt: 600_000 } };
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0, policy).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 9 }, T0 + 10, policy).state;
    s = reduce(s, { kind: 'ready', providerId: 'chatgpt', tabId: 9 }, T0 + 20, policy).state;
    const res = reduce(s, { kind: 'tick' }, T0 + 120_000, policy);
    expect(findRun(res.state, 'p1', 'chatgpt')!.state).not.toBe('timeout');
  });

  it('cancels one provider without disturbing the others', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt', 'claude']) }, T0).state;
    const res = reduce(s, { kind: 'cancel', promptId: 'p1', providerId: 'chatgpt' }, T0 + 10);
    expect(findRun(res.state, 'p1', 'chatgpt')!.state).toBe('cancelled');
    expect(findRun(res.state, 'p1', 'claude')!.state).toBe('opening_tab');
    expect(res.commands.some((c) => c.kind === 'cancel_run')).toBe(true);
  });

  it('cancel_all stops every non-terminal run', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt', 'claude']) }, T0).state;
    s = reduce(s, { kind: 'enqueue', item: item('p2', ['chatgpt']) }, T0 + 5).state;
    const res = reduce(s, { kind: 'cancel_all' }, T0 + 10);
    const states = res.state.items.flatMap((i) => Object.values(i.runs).map((r) => r.state));
    expect(states.every((st) => st === 'cancelled')).toBe(true);
  });

  it('a manual retry resets attempts so the run is tried afresh', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 5 }, T0 + 10).state;
    s = reduce(s, { kind: 'ready', providerId: 'chatgpt', tabId: 5 }, T0 + 20).state;
    s = reduce(s, { kind: 'failed', promptId: 'p1', providerId: 'chatgpt', code: 'UNKNOWN' }, T0 + 30).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 6 }, T0 + 40).state;
    s = reduce(s, { kind: 'ready', providerId: 'chatgpt', tabId: 6 }, T0 + 50).state;
    s = reduce(s, { kind: 'failed', promptId: 'p1', providerId: 'chatgpt', code: 'UNKNOWN' }, T0 + 60).state;
    expect(findRun(s, 'p1', 'chatgpt')!.state).toBe('error');

    const res = reduce(s, { kind: 'retry', promptId: 'p1', providerId: 'chatgpt' }, T0 + 100_000);
    expect(findRun(res.state, 'p1', 'chatgpt')!.attempts).toBe(0);
    expect(opens(res.commands)).toEqual(['chatgpt']);
  });

  it('reconciliation after a service worker restart does not re-send (§5.3)', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 4 }, T0 + 10).state;
    s = reduce(s, { kind: 'ready', providerId: 'chatgpt', tabId: 4 }, T0 + 20).state;
    expect(findRun(s, 'p1', 'chatgpt')!.state).toBe('inserting');

    const seen = reduce(s, { kind: 'reconciled', promptId: 'p1', providerId: 'chatgpt', alreadySent: true }, T0 + 5000);
    expect(findRun(seen.state, 'p1', 'chatgpt')!.state).toBe('submitted');
    expect(seen.commands.some((c) => c.kind === 'insert_and_submit')).toBe(false);
  });

  it('reconciliation re-queues when the prompt never landed', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'tab_opened', promptId: 'p1', providerId: 'chatgpt', tabId: 4 }, T0 + 10).state;
    s = reduce(s, { kind: 'ready', providerId: 'chatgpt', tabId: 4 }, T0 + 20).state;
    const res = reduce(s, { kind: 'reconciled', promptId: 'p1', providerId: 'chatgpt', alreadySent: false }, T0 + 10_000);
    // requeued, and the scheduler picks it straight back up
    expect(findRun(res.state, 'p1', 'chatgpt')!.state).toBe('opening_tab');
  });

  it('edits a queued prompt but refuses once it has started', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'enqueue', item: item('p2', ['chatgpt']) }, T0 + 10).state;
    // p2 is still queued (lane busy) -> editable
    s = reduce(s, { kind: 'edit', promptId: 'p2', text: 'new text', hash: 'new-hash' }, T0 + 20).state;
    expect(s.items.find((i) => i.id === 'p2')!.text).toBe('new text');
    // p1 already started -> immutable
    s = reduce(s, { kind: 'edit', promptId: 'p1', text: 'nope', hash: 'nope' }, T0 + 30).state;
    expect(s.items.find((i) => i.id === 'p1')!.text).not.toBe('nope');
  });

  it('reorder moves a queued prompt ahead of another', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'enqueue', item: item('p2', ['chatgpt']) }, T0 + 5).state;
    s = reduce(s, { kind: 'enqueue', item: item('p3', ['chatgpt']) }, T0 + 6).state;
    s = reduce(s, { kind: 'reorder', promptId: 'p3', direction: 'up' }, T0 + 7).state;
    expect(s.items.map((i) => i.id)).toEqual(['p1', 'p3', 'p2']);
  });

  it('clear_finished keeps only prompts still in flight', () => {
    let s = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    s = reduce(s, { kind: 'enqueue', item: item('p2', ['claude']) }, T0 + 5).state;
    s = reduce(s, { kind: 'done', promptId: 'p1', providerId: 'chatgpt' }, T0 + 10).state;
    s = reduce(s, { kind: 'clear_finished' }, T0 + 20).state;
    expect(s.items.map((i) => i.id)).toEqual(['p2']);
  });

  it('is pure: reducing does not mutate the input state', () => {
    const start = reduce(emptyQueue(), { kind: 'enqueue', item: item('p1', ['chatgpt']) }, T0).state;
    const snapshot = JSON.stringify(start);
    reduce(start, { kind: 'done', promptId: 'p1', providerId: 'chatgpt' }, T0 + 10);
    expect(JSON.stringify(start)).toBe(snapshot);
  });

  it('ignores events for unknown prompts or providers without throwing', () => {
    const s = reduce(emptyQueue(), { kind: 'done', promptId: 'nope', providerId: 'chatgpt' }, T0);
    expect(s.state.items).toEqual([]);
  });

  describe('prompt text retention (PRIVACY.md)', () => {
    function settled(id: string, completedAt: number): PromptItem {
      const it = item(id, ['chatgpt']);
      it.runs.chatgpt = { ...it.runs.chatgpt!, state: 'done', completedAt };
      return it;
    }

    it('drops the text of a finished prompt once the grace period passes', () => {
      const state = { items: [settled('p1', T0)] };
      const after = forgetSettledText(state, T0 + 6 * 60_000, false);
      expect(after.items[0]!.text).toBe('');
      // The record itself survives so the queue can still show what ran.
      expect(after.items[0]!.id).toBe('p1');
      expect(after.items[0]!.runs.chatgpt!.state).toBe('done');
    });

    it('keeps the text during the grace period so Copy still works', () => {
      const state = { items: [settled('p1', T0)] };
      const after = forgetSettledText(state, T0 + 60_000, false);
      expect(after.items[0]!.text).not.toBe('');
    });

    it('never drops text while any provider is still running', () => {
      const it = item('p1', ['chatgpt', 'claude']);
      it.runs.chatgpt = { ...it.runs.chatgpt!, state: 'done', completedAt: T0 };
      it.runs.claude = { ...it.runs.claude!, state: 'generating' };
      const after = forgetSettledText({ items: [it] }, T0 + 60 * 60_000, false);
      expect(after.items[0]!.text).not.toBe('');
    });

    it('keeps everything when the user opted into history', () => {
      const state = { items: [settled('p1', T0)] };
      const after = forgetSettledText(state, T0 + 60 * 60_000, true);
      expect(after.items[0]!.text).not.toBe('');
    });
  });
});
