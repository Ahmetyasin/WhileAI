import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMBEDDED_CONFIG, validateConfig } from '../src/core/config';

describe('validateConfig (spec §3.5)', () => {
  it('accepts the embedded config itself', () => {
    expect(validateConfig(EMBEDDED_CONFIG)).not.toBeNull();
  });

  it('accepts a well-formed remote config', () => {
    const remote = {
      version: 7,
      updated: '2026-08-25',
      platforms: {
        chatgpt: {
          streamingSelector: '.result-streaming',
          stopButtonSelectors: ['[data-testid="stop-button"]'],
          sendButtonSelectors: ['[data-testid="send-button"]'],
          thinkingSelector: null,
          modelSelectors: ['[data-testid="model-switcher-dropdown-button"]'],
          endpointPatterns: ['/backend-api/conversation'],
        },
      },
    };
    const v = validateConfig(remote);
    expect(v).not.toBeNull();
    expect(v!.version).toBe(7);
  });

  it('rejects junk shapes', () => {
    expect(validateConfig(null)).toBeNull();
    expect(validateConfig('string')).toBeNull();
    expect(validateConfig({})).toBeNull();
    expect(validateConfig({ version: 'x', platforms: {} })).toBeNull();
    expect(
      validateConfig({ version: 1, platforms: { chatgpt: { stopButtonSelectors: 'not-array' } } }),
    ).toBeNull();
  });

  it('rejects configs with uncompilable regex patterns', () => {
    const bad = {
      version: 9,
      platforms: {
        chatgpt: {
          streamingSelector: null,
          stopButtonSelectors: [],
          sendButtonSelectors: [],
          thinkingSelector: null,
          modelSelectors: [],
          endpointPatterns: ['[unclosed'],
        },
      },
    };
    expect(validateConfig(bad)).toBeNull();
  });

  it('embedded endpoint patterns match real URLs', () => {
    const cg = EMBEDDED_CONFIG.platforms.chatgpt.endpointPatterns.map((p) => new RegExp(p));
    expect(cg.some((r) => r.test('https://chatgpt.com/backend-api/conversation'))).toBe(true);
    expect(cg.some((r) => r.test('https://chatgpt.com/backend-api/f/conversation'))).toBe(true);
    expect(cg.some((r) => r.test('https://chatgpt.com/backend-alt/conversation'))).toBe(true);
    expect(cg.some((r) => r.test('https://chatgpt.com/backend-api/models'))).toBe(false);

    const cl = EMBEDDED_CONFIG.platforms.claude.endpointPatterns.map((p) => new RegExp(p));
    expect(
      cl.some((r) =>
        r.test('https://claude.ai/api/organizations/abc/chat_conversations/def/completion'),
      ),
    ).toBe(true);
    expect(cl.some((r) => r.test('https://claude.ai/api/account'))).toBe(false);
  });
});

describe('embedded config stays in sync with config/selectors.json', () => {
  // The shipped fallback (src/core/config.ts) and the remotely served copy
  // (config/selectors.json) are maintained by hand. A fresh install runs on
  // the embedded one, so drift means users get stale selectors until the
  // remote fetch succeeds. Keep them identical.
  const remote = JSON.parse(
    readFileSync(resolve(process.cwd(), 'config/selectors.json'), 'utf8'),
  ) as typeof EMBEDDED_CONFIG;

  it('declares the same version and platforms', () => {
    expect(remote.version).toBe(EMBEDDED_CONFIG.version);
    expect(Object.keys(remote.platforms).sort()).toEqual(
      Object.keys(EMBEDDED_CONFIG.platforms).sort(),
    );
  });

  it('declares identical selectors for every platform', () => {
    for (const id of Object.keys(EMBEDDED_CONFIG.platforms)) {
      expect(remote.platforms[id], `platform ${id}`).toEqual(EMBEDDED_CONFIG.platforms[id]);
    }
  });

  it('is itself a valid config', () => {
    expect(validateConfig(remote)).not.toBeNull();
  });
});

describe('selector sanity learned from live testing', () => {
  it('never uses a finished-answer container as a streaming marker', () => {
    // Gemini's .model-response-text wraps every COMPLETED answer, so using it
    // as streamingSelector reported "always generating": the provider's lane
    // never freed and a queued prompt was never sent. Verified live 2026-09-05.
    const gemini = EMBEDDED_CONFIG.platforms.gemini;
    expect(gemini?.streamingSelector).not.toBe('.model-response-text');
  });

  it('gives every broadcast provider a way to tell that it is generating', () => {
    // Without either signal a run can never be closed, so the lane jams.
    for (const [id, p] of Object.entries(EMBEDDED_CONFIG.platforms)) {
      const hasSignal = p.streamingSelector !== null || p.stopButtonSelectors.length > 0;
      expect(hasSignal, `${id} has no generating signal`).toBe(true);
    }
  });

  it('does not rely on English-only labels where a stable hook exists', () => {
    // Gemini's aria-labels are localized (this account renders Turkish), so the
    // first send selector must be the untranslated icon hook, not the word.
    const first = EMBEDDED_CONFIG.platforms.gemini?.sendButtonSelectors[0] ?? '';
    expect(first).toContain('mat-icon');
  });
});
