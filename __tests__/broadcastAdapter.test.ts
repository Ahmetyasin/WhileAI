import { beforeEach, describe, expect, it } from 'vitest';
import { GenericAdapter } from '../src/adapters/baseAdapter';
import { GenericBroadcastAdapter } from '../src/adapters/broadcastAdapter';
import { EMBEDDED_CONFIG } from '../src/core/config';
import type { PlatformSelectorConfig } from '../src/core/types';

/**
 * Mirrors the mock provider page used for live browser verification
 * (test-harness/mock-provider.html): a composer whose send button is driven by
 * an internal model, so a DOM-only write leaves send disabled.
 */
const CFG: PlatformSelectorConfig = {
  streamingSelector: '.result-streaming',
  stopButtonSelectors: ['[data-testid="stop-button"]'],
  sendButtonSelectors: ['[data-testid="send-button"]'],
  composerSelectors: ['#composer'],
  thinkingSelector: null,
  modelSelectors: [],
  endpointPatterns: [],
  userMessageSelectors: ['[data-message-author-role="user"]'],
  loginUrlPatterns: ['/login', 'auth.example.com'],
  challengeSelectors: ['#challenge-running'],
  newChatUrl: 'https://example.test/new',
};

function makeAdapter(cfg: PlatformSelectorConfig = CFG): GenericBroadcastAdapter {
  return new GenericBroadcastAdapter('chatgpt', new GenericAdapter('chatgpt', ['x'], cfg));
}

/** Build a page with a textarea composer and a model-gated send button. */
function buildPage(): { composer: HTMLTextAreaElement; send: HTMLButtonElement } {
  document.body.innerHTML = `
    <div id="messages"></div>
    <textarea id="composer"></textarea>
    <button id="send" data-testid="send-button" disabled>Send</button>`;
  const composer = document.getElementById('composer') as HTMLTextAreaElement;
  const send = document.getElementById('send') as HTMLButtonElement;
  composer.addEventListener('input', () => {
    send.disabled = composer.value.trim().length === 0;
  });
  // happy-dom has no layout, so give the composer a box for the visibility check.
  composer.getBoundingClientRect = () => ({ width: 200, height: 40 }) as DOMRect;
  return { composer, send };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('GenericBroadcastAdapter', () => {
  it('reports healthy when both a composer and a send button exist', () => {
    buildPage();
    expect(makeAdapter().healthCheck()).toEqual({ ok: true, missing: [] });
  });

  it('reports the send button missing rather than failing silently (§4)', () => {
    document.body.innerHTML = '<textarea id="composer"></textarea>';
    const composer = document.getElementById('composer') as HTMLTextAreaElement;
    composer.getBoundingClientRect = () => ({ width: 200, height: 40 }) as DOMRect;
    const health = makeAdapter().healthCheck();
    expect(health.ok).toBe(false);
    expect(health.missing).toContain('sendButton');
  });

  it('is stricter than the tracking self-test, which accepts a composer alone', () => {
    document.body.innerHTML = '<textarea id="composer"></textarea>';
    const composer = document.getElementById('composer') as HTMLTextAreaElement;
    composer.getBoundingClientRect = () => ({ width: 200, height: 40 }) as DOMRect;
    const platform = new GenericAdapter('chatgpt', ['x'], CFG);
    expect(platform.selfTest().ok).toBe(true);          // measuring is fine
    expect(makeAdapter().healthCheck().ok).toBe(false); // broadcasting is not
  });

  it('inserts, enables send, and submits', async () => {
    const { composer, send } = buildPage();
    let clicked = false;
    send.addEventListener('click', () => {
      clicked = true;
      composer.value = '';
    });
    const a = makeAdapter();

    const ins = await a.insertText('What is the capital of France?');
    expect(ins.ok).toBe(true);
    expect(composer.value).toBe('What is the capital of France?');
    expect(send.disabled).toBe(false);

    expect(await a.submit()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('preserves a multi-line prompt with a code block (§5.9)', async () => {
    const { composer } = buildPage();
    const prompt = 'Explain this code:\n\n```ts\nconst a = 1;\n```\n\nthanks';
    const ins = await makeAdapter().insertText(prompt);
    expect(ins.ok).toBe(true);
    expect(composer.value).toBe(prompt);
  });

  it('fails clearly when there is no composer at all', async () => {
    document.body.innerHTML = '<div>signed out</div>';
    const res = await makeAdapter().insertText('hello');
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('composer');
  });

  it('detects a login page from the URL pattern (§5.16)', () => {
    buildPage();
    // A pattern that cannot match this page, then one that must.
    expect(makeAdapter({ ...CFG, loginUrlPatterns: ['/definitely-not-here'] }).isLoginPage())
      .toBe(false);
    expect(makeAdapter({ ...CFG, loginUrlPatterns: [location.hostname] }).isLoginPage())
      .toBe(true);
  });

  it('detects a challenge wall and never tries to solve it (§5.17)', () => {
    buildPage();
    expect(makeAdapter().isChallengePage()).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<div id="challenge-running"></div>');
    expect(makeAdapter().isChallengePage()).toBe(true);
  });

  it('reads the newest user message for capture and confirmation (§5.13)', () => {
    buildPage();
    const msgs = document.getElementById('messages') as HTMLElement;
    msgs.innerHTML =
      '<div data-message-author-role="user">first</div>' +
      '<div data-message-author-role="user">second</div>';
    expect(makeAdapter().getLastUserMessageText()).toBe('second');
  });

  it('tracks generation via the stop button and the streaming marker', () => {
    buildPage();
    const a = makeAdapter();
    expect(a.isGenerating()).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<button data-testid="stop-button"></button>');
    expect(a.isGenerating()).toBe(true);
    document.body.innerHTML = '<div class="result-streaming"></div>';
    expect(makeAdapter().isGenerating()).toBe(true);
  });

  it('degrades safely when a config predates the broadcast fields', () => {
    buildPage();
    const legacy: PlatformSelectorConfig = {
      ...CFG,
      userMessageSelectors: undefined,
      loginUrlPatterns: undefined,
      challengeSelectors: undefined,
      newChatUrl: undefined,
    };
    const a = makeAdapter(legacy);
    expect(a.getLastUserMessageText()).toBeNull();
    expect(a.isLoginPage()).toBe(false);
    expect(a.isChallengePage()).toBe(false);
    expect(a.healthCheck().ok).toBe(true); // still usable for sending
  });

  it('exposes a new-chat URL for every shipped provider', () => {
    for (const [id, cfg] of Object.entries(EMBEDDED_CONFIG.platforms)) {
      expect(cfg.newChatUrl, `${id} newChatUrl`).toBeTruthy();
      expect(cfg.userMessageSelectors?.length, `${id} userMessageSelectors`).toBeGreaterThan(0);
    }
  });
});
