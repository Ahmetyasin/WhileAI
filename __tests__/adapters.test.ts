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

  it('generating: detects the stop button', () => {
    loadFixture('chatgpt-generating');
    const a = adapter('chatgpt.com');
    expect(a.isGenerating()).toBe(true);
  });

  /**
   * ChatGPT has no usable streaming marker. Verified live 2026-09-06:
   * .result-streaming stays on a FINISHED answer (no stop button, answer
   * complete), so trusting it pins isGenerating() true forever and the run
   * only ends via the stalled-generating guard — a 5s answer reported as
   * 21s. Same trap as Gemini's .model-response-text (§2.2). If a future
   * config re-adds one, this test fails and the reasoning is right here.
   */
  it('has no streaming selector: the stale class must not be trusted', () => {
    expect(adapter('chatgpt.com').streamingSelector).toBeNull();
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
