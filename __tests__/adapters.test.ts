import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { adapterForHost } from '../src/adapters/registry';
import { EMBEDDED_CONFIG } from '../src/core/config';

// process.cwd() is the project root under vitest; happy-dom patches URL, so
// import.meta.url-based resolution is unreliable here.
function loadFixture(name: string): void {
  document.body.innerHTML = readFileSync(
    join(process.cwd(), '__tests__', 'fixtures', `${name}.html`),
    'utf8',
  );
}

function adapter(host: string) {
  const a = adapterForHost(host, EMBEDDED_CONFIG);
  if (!a) throw new Error(`no adapter for ${host}`);
  return a;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('registry', () => {
  it('maps hosts to adapters', () => {
    expect(adapter('chatgpt.com').id).toBe('chatgpt');
    expect(adapter('claude.ai').id).toBe('claude');
    expect(adapter('www.perplexity.ai').id).toBe('perplexity');
    expect(adapter('chat.deepseek.com').id).toBe('deepseek');
    expect(adapter('localhost').id).toBe('chatgpt'); // dev harness
    expect(adapterForHost('example.com', EMBEDDED_CONFIG)).toBeNull();
  });
});

describe('perplexity adapter against DOM fixtures (captured live 2026-08-26)', () => {
  it('idle: finds composer and submit button, not generating', () => {
    loadFixture('perplexity-idle');
    const a = adapter('www.perplexity.ai');
    expect(a.findSubmitButton()).not.toBeNull();
    expect(a.isGenerating()).toBe(false);
    expect(a.selfTest().ok).toBe(true);
    expect(a.detectModel()).toBeNull(); // no reliable model element
  });

  it('generating: detects the stop button', () => {
    loadFixture('perplexity-generating');
    const a = adapter('www.perplexity.ai');
    expect(a.isGenerating()).toBe(true);
  });

  it('endpoint pattern matches the ask SSE URL', () => {
    const patterns = EMBEDDED_CONFIG.platforms.perplexity.endpointPatterns.map((p) => new RegExp(p));
    expect(patterns.some((r) => r.test('https://www.perplexity.ai/rest/sse/perplexity_ask'))).toBe(true);
    expect(patterns.some((r) => r.test('https://www.perplexity.ai/rest/sse/recent_thread_updates'))).toBe(false);
  });
});

describe('deepseek adapter (best-effort — login-walled, verify in the field)', () => {
  it('idle: composer satisfies self-test even if the send selector drifts', () => {
    loadFixture('deepseek-idle');
    const a = adapter('chat.deepseek.com');
    expect(a.selfTest().ok).toBe(true);
    expect(a.isGenerating()).toBe(false);
  });

  it('endpoint pattern matches the completion URL only', () => {
    const patterns = EMBEDDED_CONFIG.platforms.deepseek.endpointPatterns.map((p) => new RegExp(p));
    expect(patterns.some((r) => r.test('https://chat.deepseek.com/api/v0/chat/completion'))).toBe(true);
    expect(patterns.some((r) => r.test('https://chat.deepseek.com/api/v0/chat/history_messages'))).toBe(false);
  });
});

// Fixture tests (spec §8.1): these BREAK when the real UI changes — intended.
describe('chatgpt adapter against DOM fixtures', () => {
  it('idle: finds send button and model, not generating', () => {
    loadFixture('chatgpt-idle');
    const a = adapter('chatgpt.com');
    expect(a.findSubmitButton()).not.toBeNull();
    expect(a.isGenerating()).toBe(false);
    expect(a.detectModel()).toBe('GPT-5');
    expect(a.selfTest().ok).toBe(true);
  });

  it('generating: detects stop button and streaming marker', () => {
    loadFixture('chatgpt-generating');
    const a = adapter('chatgpt.com');
    expect(a.isGenerating()).toBe(true);
    expect(document.querySelector(a.streamingSelector!)).not.toBeNull();
  });
});

describe('claude adapter against DOM fixtures', () => {
  it('idle: finds send button and model, not generating', () => {
    loadFixture('claude-idle');
    const a = adapter('claude.ai');
    expect(a.findSubmitButton()).not.toBeNull();
    expect(a.isGenerating()).toBe(false);
    expect(a.detectModel()).toBe('Fable 5');
    expect(a.selfTest().ok).toBe(true);
  });

  it('generating: detects stop button and streaming marker', () => {
    loadFixture('claude-generating');
    const a = adapter('claude.ai');
    expect(a.isGenerating()).toBe(true);
    expect(document.querySelector(a.streamingSelector!)).not.toBeNull();
  });

  it('idle streaming selector does not match data-is-streaming="false"', () => {
    loadFixture('claude-idle');
    const a = adapter('claude.ai');
    expect(document.querySelector(a.streamingSelector!)).toBeNull();
  });
});

describe('selfTest failure reporting', () => {
  it('reports failure when neither send button nor composer exists', () => {
    document.body.innerHTML = '<div>totally different page</div>';
    const a = adapter('chatgpt.com');
    const res = a.selfTest();
    expect(res.ok).toBe(false);
    expect(res.missing).toContain('sendButton/composer');
  });

  it('passes when the send button moved but a composer is present', () => {
    document.body.innerHTML = '<form><div contenteditable="true"></div></form>';
    const a = adapter('chatgpt.com');
    expect(a.selfTest().ok).toBe(true);
  });
});
