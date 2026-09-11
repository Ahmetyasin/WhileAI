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

/**
 * Regression: claude.ai renders contenteditable regions that are NOT the
 * prompt box (artifact/preview surfaces, renamable titles). The composer is a
 * ProseMirror root, so a bare `div[contenteditable="true"]` first selector can
 * bind to whichever such region happens to come first in document order and
 * type the user's prompt into it. Same failure shape as the Gemini
 * "always generating" bug: a selector that is too broad to be honest.
 */
describe('claude composer targeting', () => {
  const claudeCfg = EMBEDDED_CONFIG.platforms.claude!;

  function makeClaude(): GenericBroadcastAdapter {
    return new GenericBroadcastAdapter(
      'claude',
      new GenericAdapter('claude', ['claude.ai'], claudeCfg),
    );
  }

  it('picks the ProseMirror prompt box, not another contenteditable on the page', () => {
    document.body.innerHTML = `
      <div contenteditable="true" id="artifact-surface">rendered artifact</div>
      <fieldset>
        <div contenteditable="true" class="ProseMirror" id="real-composer"></div>
      </fieldset>`;
    // jsdom reports every rect as 0x0, which isVisible() rejects; give the
    // candidates a real box so this exercises selector order, not layout.
    for (const n of Array.from(document.querySelectorAll('[contenteditable]'))) {
      (n as HTMLElement).getBoundingClientRect = () =>
        ({ width: 300, height: 40 }) as DOMRect;
    }
    const el = (makeClaude() as unknown as { composer(): HTMLElement | null }).composer();
    expect(el?.id).toBe('real-composer');
  });
});

/**
 * Perplexity's follow-up composer sits below the answer, and answer bodies can
 * themselves contain editable regions. Anchor on the composer's own id first.
 */
describe('perplexity composer targeting', () => {
  it('prefers #ask-input over any other editable region in main', () => {
    document.body.innerHTML = `
      <main>
        <div contenteditable="true" id="answer-scratch">answer body</div>
        <div contenteditable="true" id="ask-input"></div>
      </main>`;
    for (const n of Array.from(document.querySelectorAll('[contenteditable]'))) {
      (n as HTMLElement).getBoundingClientRect = () => ({ width: 300, height: 40 }) as DOMRect;
    }
    const a = new GenericBroadcastAdapter(
      'perplexity',
      new GenericAdapter('perplexity', ['perplexity.ai'], EMBEDDED_CONFIG.platforms.perplexity!),
    );
    const el = (a as unknown as { composer(): HTMLElement | null }).composer();
    expect(el?.id).toBe('ask-input');
  });
});

/**
 * Observed live on Perplexity 2026-09-06: the free-search-limit modal is up,
 * but #ask-input and the Submit button are STILL in the DOM. Readiness checks
 * therefore pass and the send fails with a meaningless INSERT_FAILED. The user
 * needs "your free limit is reached", not "could not paste".
 */
describe('usage wall detection', () => {
  function px(): GenericBroadcastAdapter {
    return new GenericBroadcastAdapter(
      'perplexity',
      new GenericAdapter('perplexity', ['perplexity.ai'], EMBEDDED_CONFIG.platforms.perplexity!),
    );
  }

  it('detects the free-search-limit modal even though the composer is present', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <h2>You've reached your free search limit</h2>
        <p>Your access will reset in a few hours.</p>
        <button>Upgrade</button>
      </div>
      <div contenteditable="true" id="ask-input"></div>
      <button aria-label="Submit"></button>`;
    const a = px();
    expect(a.isQuotaWall()).toBe(true);
    // The trap: the page still looks perfectly usable.
    expect(document.querySelector('#ask-input')).not.toBeNull();
  });

  it('does not fire on an answer that merely discusses rate limits', () => {
    document.body.innerHTML = `
      <main><div class="prose">API providers often impose a daily limit
      and a rate limit on requests.</div></main>
      <div contenteditable="true" id="ask-input"></div>`;
    expect(px().isQuotaWall()).toBe(false);
  });

  it('does not fire on a normal empty chat page', () => {
    document.body.innerHTML = `<div contenteditable="true" id="ask-input"></div>`;
    expect(px().isQuotaWall()).toBe(false);
  });
});

/**
 * Perplexity virtualises its answer list: measured live 2026-09-06,
 * body.innerText fell 934 -> 771 across a generation while the answer grew.
 * Measuring the answer node instead keeps growth monotonic.
 */
describe('answerLength', () => {
  function px(): GenericBroadcastAdapter {
    return new GenericBroadcastAdapter(
      'perplexity',
      new GenericAdapter('perplexity', ['perplexity.ai'], EMBEDDED_CONFIG.platforms.perplexity!),
    );
  }

  it('measures the newest answer, not the whole page', () => {
    document.body.innerHTML = `
      <nav>lots of unrelated sidebar chrome that dwarfs the answer text</nav>
      <main>
        <div class="prose">an older answer</div>
        <div class="prose">the newest answer text</div>
      </main>`;
    expect(px().answerLength()).toBe('the newest answer text'.length);
  });

  it('falls back to the page when no answer node exists yet', () => {
    document.body.innerHTML = `<main>no answer nodes here</main>`;
    expect(px().answerLength()).toBeGreaterThan(0);
  });

  it('survives a malformed selector without throwing', () => {
    const cfg = { ...EMBEDDED_CONFIG.platforms.perplexity!, answerSelectors: ['((('] };
    const a = new GenericBroadcastAdapter(
      'perplexity',
      new GenericAdapter('perplexity', ['perplexity.ai'], cfg),
    );
    document.body.innerHTML = `<main>text</main>`;
    expect(() => a.answerLength()).not.toThrow();
  });
});

/**
 * Gemini sometimes answers with an A/B preference card ("Hangi yanıtı daha
 * faydalı buldunuz?") whose two candidates live OUTSIDE model-response.
 * Measured live 2026-09-06: model-response held 24 chars, the card 293.
 * Taking the first matching selector measured the wrong node.
 */
describe('answerLength with a variant layout', () => {
  it('measures the largest matching node, not the first selector', () => {
    document.body.innerHTML = `
      <div class="side-by-side">
        Option A Elephant. Option B Tiger. Which was more helpful?
      </div>
      <model-response>Gemini said:</model-response>`;
    // Deliberately list the SMALL node's selector first: the result must not
    // depend on config ordering, only on which node actually holds the answer.
    const cfg = {
      ...EMBEDDED_CONFIG.platforms.gemini!,
      answerSelectors: ['model-response', '.side-by-side'],
    };
    const a = new GenericBroadcastAdapter(
      'gemini',
      new GenericAdapter('gemini', ['gemini.google.com'], cfg),
    );
    const mr = (document.querySelector('model-response') as HTMLElement).textContent ?? '';
    // The point is that it measures the BIG node (the A/B card), not the
    // small one that model-response matches first.
    expect(a.answerLength()).toBeGreaterThan(mr.length);
  });
});

describe('paused conversation detection', () => {
  it('spots the "Chat paused" card', () => {
    // Claude, live 2026-09-07: a safety check paused the conversation and
    // removed the composer. The tab then looked identical to a half-loaded
    // page, so the extension told the user to reload — which does nothing.
    // Only they can clear it, from the card itself.
    document.body.innerHTML = `
      <div class="flex flex-wrap items-center gap-x-4">
        <div>Chat paused</div><a>Edit and retry with Opus 5</a>
      </div>`;
    expect(makeAdapter().isConversationPaused()).toBe(true);
  });

  it('does not fire on an ordinary conversation', () => {
    document.body.innerHTML = `<div><div data-testid="user-message">hello</div></div>`;
    expect(makeAdapter().isConversationPaused()).toBe(false);
  });

  it('does not fire on an ANSWER that merely mentions a paused chat', () => {
    // The phrase inside a long reply must not stop a working conversation.
    document.body.innerHTML = `
      <div><div class="answer">${'When a chat paused unexpectedly, you can usually resume it. '.repeat(8)}</div></div>`;
    expect(makeAdapter().isConversationPaused()).toBe(false);
  });
});

describe('usage wall shown inline, not in a dialog', () => {
  it('detects Claude\'s model-limit banner', () => {
    // Reported 2026-09-07 with a screenshot: Claude showed "You've reached
    // your Fable limit. Turn on usage credits to keep using Fable or switch
    // models to continue this chat." The prompt sat in the composer, the send
    // button stayed disabled, nothing moved and NO error was ever raised —
    // because the detector only looked inside [role="dialog"] and this notice
    // is an inline banner.
    document.body.innerHTML = `
      <main>
        <div class="notice">You've reached your Fable limit. Turn on usage credits
          to keep using Fable or switch models to continue this chat.</div>
      </main>`;
    expect(makeAdapter().isQuotaWall()).toBe(true);
  });

  it('still detects a wall inside a dialog', () => {
    document.body.innerHTML = `
      <div role="dialog">You've reached your free search limit. Upgrade to continue.</div>`;
    expect(makeAdapter().isQuotaWall()).toBe(true);
  });

  it('does not fire on an ANSWER that discusses rate limits', () => {
    // The phrase inside a long reply must not stop a working conversation.
    document.body.innerHTML = `
      <div class="answer">${'API rate limits are usually documented per endpoint, and when you have reached your limit the service returns 429. '.repeat(6)}</div>`;
    expect(makeAdapter().isQuotaWall()).toBe(false);
  });

  it('does not fire on an ordinary page', () => {
    document.body.innerHTML = `<div><div data-testid="user-message">hello</div></div>`;
    expect(makeAdapter().isQuotaWall()).toBe(false);
  });
});

describe('usage wall — structural signals, not just words', () => {
  /**
   * Keyword lists rot: a provider rewords its notice and detection stops.
   * Text is therefore only ONE of the signals. The structural one — a
   * composer holding text whose send button will not enable — is what these
   * sites all have in common when they refuse, and it needs no vocabulary.
   */
  it('reports a blocked composer even when the wording is unknown', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">a prompt the user typed</div>
      <button data-testid="send-button" disabled>Send</button>
      <div class="notice">Some wording we have never seen before.</div>`;
    // happy-dom lays nothing out, so every element reports zero size and the
    // adapter's visibility filter rejects the composer. Give it a box so the
    // composer is "visible" the way it is in a real browser.
    const composer = document.querySelector('#composer') as HTMLElement;
    composer.getBoundingClientRect = () => ({ width: 300, height: 40 }) as DOMRect;
    expect(makeAdapter().isBlockedFromSending()).toBe(true);
  });

  it('does not report a block when the composer is empty', () => {
    // An empty composer disables send on every one of these sites. That is
    // the normal resting state, not a refusal.
    document.body.innerHTML = `
      <div id="composer" contenteditable="true"></div>
      <button data-testid="send-button" disabled>Send</button>`;
    expect(makeAdapter().isBlockedFromSending()).toBe(false);
  });

  it('does not report a block when send is enabled', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">a prompt</div>
      <button data-testid="send-button">Send</button>`;
    expect(makeAdapter().isBlockedFromSending()).toBe(false);
  });

  it('does not report a block while the site is generating', () => {
    // Send is disabled during generation on every provider — that is the
    // system working, and calling it a refusal would fire on every answer.
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">a prompt</div>
      <button data-testid="send-button" disabled>Send</button>
      <button data-testid="stop-button">Stop</button>`;
    expect(makeAdapter().isBlockedFromSending()).toBe(false);
  });
});

describe('remotely updatable wording', () => {
  const withPatterns = (over: Partial<PlatformSelectorConfig>) =>
    makeAdapter({ ...CFG, ...over });

  it('detects a wall using wording that only the remote config knows', () => {
    // The point of making these updatable: a provider rewords its notice and
    // we ship a config, not a store release.
    document.body.innerHTML = `<div class="n">Bu ay için kullanım hakkınız doldu.</div>`;
    expect(withPatterns({ quotaPatterns: ['kullanım hakkınız doldu'] }).isQuotaWall()).toBe(true);
  });

  it('keeps the built-in wording when the remote config adds its own', () => {
    // Merged, never replaced: a remote list that omits a known phrase must
    // not silently remove detection for it.
    document.body.innerHTML = `<div class="n">You've reached your free plan limit.</div>`;
    expect(withPatterns({ quotaPatterns: ['something else entirely'] }).isQuotaWall()).toBe(true);
  });

  it('keeps the built-in wording when the remote list is empty', () => {
    document.body.innerHTML = `<div class="n">You've reached your free plan limit.</div>`;
    expect(withPatterns({ quotaPatterns: [] }).isQuotaWall()).toBe(true);
  });

  it('matches remote wording case-insensitively', () => {
    document.body.innerHTML = `<div class="n">KULLANIM HAKKINIZ DOLDU</div>`;
    expect(withPatterns({ quotaPatterns: ['Kullanım Hakkınız Doldu'] }).isQuotaWall()).toBe(true);
  });

  it('does the same for paused wording', () => {
    document.body.innerHTML = `<div class="n">Sohbet askıya alındı</div>`;
    expect(withPatterns({ pausedPatterns: ['askıya alındı'] }).isConversationPaused()).toBe(true);
  });
});

/**
 * Live 2026-09-09: while an answer streamed, DeepSeek rendered progress
 * notices ("Read 12 web pages", "Searching for ...") inside a .ds-message that
 * did not yet contain .ds-markdown. The old selector treated those as user
 * messages, so the extension relayed DeepSeek's own status text to the other
 * four AIs as if the user had typed it.
 */
describe('DeepSeek user messages vs. its own status notices', () => {
  const dsCfg = EMBEDDED_CONFIG.platforms.deepseek;

  function deepseekAdapter(): GenericBroadcastAdapter {
    return new GenericBroadcastAdapter(
      'deepseek',
      new GenericAdapter('deepseek', ['chat.deepseek.com'], dsCfg),
    );
  }

  /**
   * Mirrors the live DOM sampled 2026-09-12: a just-sent user turn carries a
   * negative virtual-list key and wraps its text in .ds-collapsible-text; the
   * answer carries a positive key and .ds-markdown.
   */
  function renderTranscript(): void {
    document.body.innerHTML = `
      <div data-virtual-list-item-key="-2">
        <div class="ds-message">
          <div class="ds-collapsible-text">Name one animal that can sleep standing up.</div>
        </div>
      </div>
      <div data-virtual-list-item-key="2">
        <div class="ds-message">
          <div class="ds-markdown ds-assistant-message-main-content">Horses can.</div>
        </div>
      </div>
    `;
  }

  it('reads the user prompt, not the assistant answer', () => {
    renderTranscript();
    expect(deepseekAdapter().getLastUserMessageText()).toBe(
      'Name one animal that can sleep standing up.',
    );
  });

  it('does not mistake a streaming progress notice for a typed prompt', () => {
    renderTranscript();
    // The answer row, still streaming: no .ds-markdown yet, just a status line.
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div data-virtual-list-item-key="4">
         <div class="ds-message">Read 12 web pages</div>
       </div>`,
    );
    // The last USER message must still be the prompt -- never the notice.
    expect(deepseekAdapter().getLastUserMessageText()).toBe(
      'Name one animal that can sleep standing up.',
    );
  });

  /**
   * Live 2026-09-12: the negative key only lasts while a turn is PENDING.
   * Open the same conversation again (a reload, or the extension reusing an
   * existing chat) and the user's own turn comes back with a POSITIVE key --
   * observed as key="1" for "Name one continent." next to key="2" for the
   * answer. The negative-key selector then matches nothing, the
   * ':not(:has(.ds-markdown))' fallback takes over, and that fallback matches
   * DeepSeek's own "Found 8 web pages" notice: the 2026-09-09 leak again.
   *
   * What actually separates them, in both states, is .ds-collapsible-text --
   * present in the user's bubble, absent from the notice and from the answer.
   */
  it('still tells a LOADED user turn from a status notice', () => {
    document.body.innerHTML = `
      <div data-virtual-list-item-key="1">
        <div class="ds-message"><div class="ds-collapsible-text">Name one continent.</div></div>
      </div>
      <div data-virtual-list-item-key="2">
        <div class="ds-message"><div class="ds-markdown ds-assistant-message-main-content">Africa.</div></div>
      </div>
      <div data-virtual-list-item-key="4">
        <div class="ds-message">Found 8 web pages</div>
      </div>
    `;
    expect(deepseekAdapter().getLastUserMessageText()).toBe('Name one continent.');
  });

  /**
   * Live 2026-09-12: a pending answer row also carries a NEGATIVE key while it
   * is still empty (key="-3", no markdown yet), so "negative" alone does not
   * mean "the user typed this".
   */
  it('ignores the empty pending row that shares the negative key', () => {
    document.body.innerHTML = `
      <div data-virtual-list-item-key="-2">
        <div class="ds-message"><div class="ds-collapsible-text">Why is the sky blue?</div></div>
      </div>
      <div data-virtual-list-item-key="-3">
        <div class="ds-message"></div>
      </div>
    `;
    expect(deepseekAdapter().getLastUserMessageText()).toBe('Why is the sky blue?');
  });

  it('does not rely on a build-generated class name', () => {
    // '.fbb737a4' changes on every DeepSeek deploy, so it must not be relied on.
    expect((dsCfg.userMessageSelectors ?? []).join(' ')).not.toContain('fbb737a4');
  });
});
