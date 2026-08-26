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
