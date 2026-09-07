import { describe, expect, it } from 'vitest';
import { CaptureGuard, conversationKeyOf } from '../src/content/captureGuard';

/**
 * These cases are the things a user actually does to a chat tab. Each one
 * re-renders the transcript, and before this guard existed several of them
 * re-broadcast a prompt that had already gone out.
 */
const guard = (key = 'https://chatgpt.com/c/1'): CaptureGuard =>
  new CaptureGuard({ conversationKey: key });

describe('CaptureGuard — a prompt is relayed once per conversation', () => {
  it('relays a prompt the first time it is seen', () => {
    expect(guard().shouldRelay('h1')).toBe(true);
  });

  it('does not relay the same prompt twice', () => {
    const g = guard();
    expect(g.shouldRelay('h1')).toBe(true);
    expect(g.shouldRelay('h1')).toBe(false);
  });

  it('does not re-relay an earlier prompt when a newer one is on screen', () => {
    // The reported bug: switching the model re-renders the transcript, and
    // the guard was only remembering the PREVIOUS hash, so the older prompt
    // looked new again and went out to every other AI a second time.
    const g = guard();
    g.shouldRelay('first');
    g.shouldRelay('second');
    expect(g.shouldRelay('first')).toBe(false);
  });

  it('survives many prompts before forgetting anything', () => {
    const g = guard();
    for (let i = 0; i < 150; i++) g.shouldRelay(`h${i}`);
    expect(g.shouldRelay('h0')).toBe(false);
    expect(g.shouldRelay('h149')).toBe(false);
  });

  it('bounds its memory so a long-lived tab cannot grow forever', () => {
    const g = guard();
    for (let i = 0; i < 500; i++) g.shouldRelay(`h${i}`);
    expect(g.size).toBeLessThanOrEqual(200);
  });

  it('baselines what is already on the page without relaying it', () => {
    // A freshly injected script must not re-broadcast the conversation it
    // lands in — an install or an extension reload used to do exactly that.
    const g = guard();
    g.markSeen('already-there');
    expect(g.shouldRelay('already-there')).toBe(false);
  });

  it('does not relay a prompt the extension itself delivered', () => {
    const g = guard();
    g.markSeen('delivered-by-us');
    expect(g.shouldRelay('delivered-by-us')).toBe(false);
  });
});

describe('CaptureGuard — conversation boundaries', () => {
  it('relays the same text again in a DIFFERENT conversation', () => {
    // Asking the same question in a new chat is a real new prompt.
    const g = guard('https://chatgpt.com/c/1');
    expect(g.shouldRelay('same')).toBe(true);
    g.setConversation('https://chatgpt.com/c/2');
    expect(g.shouldRelay('same')).toBe(true);
  });

  it('keeps its memory when told the SAME conversation again', () => {
    // SPA re-renders fire navigation events for the page already on screen.
    const g = guard('https://chatgpt.com/c/1');
    g.shouldRelay('h1');
    g.setConversation('https://chatgpt.com/c/1');
    expect(g.shouldRelay('h1')).toBe(false);
  });

  it('treats a model switch as the same conversation', () => {
    // Model pickers push a query string. That is not a new conversation, and
    // treating it as one re-armed the relay for prompts already sent.
    const g = guard(conversationKeyOf('https://chatgpt.com/c/1'));
    g.shouldRelay('h1');
    g.setConversation(conversationKeyOf('https://chatgpt.com/c/1?model=gpt-4o'));
    expect(g.shouldRelay('h1')).toBe(false);
  });

  it('treats a fragment change as the same conversation', () => {
    const g = guard(conversationKeyOf('https://claude.ai/chat/abc'));
    g.shouldRelay('h1');
    g.setConversation(conversationKeyOf('https://claude.ai/chat/abc#panel'));
    expect(g.shouldRelay('h1')).toBe(false);
  });

  it('treats a different chat id as a different conversation', () => {
    const g = guard(conversationKeyOf('https://claude.ai/chat/abc'));
    g.shouldRelay('h1');
    g.setConversation(conversationKeyOf('https://claude.ai/chat/def'));
    expect(g.shouldRelay('h1')).toBe(true);
  });

  it('treats a new chat as a different conversation', () => {
    // "New chat" is where the user most expects a repeated question to go out.
    const g = guard(conversationKeyOf('https://claude.ai/chat/abc'));
    g.shouldRelay('h1');
    g.setConversation(conversationKeyOf('https://claude.ai/new'));
    expect(g.shouldRelay('h1')).toBe(true);
  });
});

describe('conversationKeyOf', () => {
  it('ignores query and fragment', () => {
    expect(conversationKeyOf('https://a.com/c/1?x=2#y')).toBe('https://a.com/c/1');
  });

  it('distinguishes different paths', () => {
    expect(conversationKeyOf('https://a.com/c/1')).not.toBe(conversationKeyOf('https://a.com/c/2'));
  });

  it('does not throw on a malformed url', () => {
    expect(conversationKeyOf('not a url')).toBe('not a url');
  });
});

describe('CaptureGuard — a relay that never arrived', () => {
  it('lets a prompt be retried when the relay was not confirmed', () => {
    // The content script marks a hash as relayed the moment it reports it.
    // If the worker never actually queues it — a dropped message, a service
    // worker restart mid-report — the prompt is lost for good: the page still
    // shows it, but the guard will never offer it again. Seen live
    // 2026-09-07, one of five prompts vanished silently.
    const g = guard();
    expect(g.shouldRelay('h1')).toBe(true);
    g.unconfirm('h1'); // the report did not land
    expect(g.shouldRelay('h1')).toBe(true);
  });

  it('does not offer a confirmed prompt again', () => {
    const g = guard();
    g.shouldRelay('h1');
    g.confirm('h1');
    g.unconfirm('h1'); // a late failure for an already-confirmed relay
    expect(g.shouldRelay('h1')).toBe(false);
  });

  it('still suppresses a prompt marked seen without a relay', () => {
    // Baselining and echo-suppression are unconditional: they were never
    // "pending", so unconfirm must not resurrect them.
    const g = guard();
    g.markSeen('baseline');
    g.unconfirm('baseline');
    expect(g.shouldRelay('baseline')).toBe(false);
  });
});

describe('CaptureGuard — baselining must not block a repeat', () => {
  it('relays a prompt whose text matches the baselined one, once it is asked again', () => {
    // Baselining at injection is right: the message already on the page when
    // the script loads was not typed just now. But it recorded the HASH, so
    // asking the very same question again — which is exactly what a user does
    // after reloading the extension — was silently suppressed forever.
    // Observed live 2026-09-07: the same fifth prompt vanished twice running.
    const g = guard();
    g.markSeen('baseline-hash');
    // The user asks it again, and the page reports a NEW message.
    g.noteNewMessage();
    expect(g.shouldRelay('baseline-hash')).toBe(true);
  });

  it('still suppresses the baselined message when nothing new was typed', () => {
    // Re-renders keep presenting the same message; without a new one arriving
    // it must stay suppressed, or every re-render re-broadcasts it.
    const g = guard();
    g.markSeen('baseline-hash');
    expect(g.shouldRelay('baseline-hash')).toBe(false);
    expect(g.shouldRelay('baseline-hash')).toBe(false);
  });

  it('does not resurrect a prompt we delivered ourselves', () => {
    // Echo suppression is not a baseline: our own delivery must never bounce
    // back out, however many messages arrive afterwards.
    const g = guard();
    g.markSeen('our-delivery', { echo: true });
    g.noteNewMessage();
    expect(g.shouldRelay('our-delivery')).toBe(false);
  });
});
