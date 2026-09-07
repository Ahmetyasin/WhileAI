import { describe, expect, it } from 'vitest';
import {
  TabRegistry,
  providerForUrl,
  shouldDisableProvider,
} from '../src/background/tabRegistry';

describe('providerForUrl', () => {
  it('recognises each supported provider', () => {
    expect(providerForUrl('https://chatgpt.com/c/1')).toBe('chatgpt');
    expect(providerForUrl('https://claude.ai/new')).toBe('claude');
    expect(providerForUrl('https://www.perplexity.ai/search/x')).toBe('perplexity');
    expect(providerForUrl('https://gemini.google.com/app')).toBe('gemini');
    expect(providerForUrl('https://chat.deepseek.com/a/chat/s/1')).toBe('deepseek');
  });

  it('recognises perplexity with and without www', () => {
    expect(providerForUrl('https://perplexity.ai/')).toBe('perplexity');
    expect(providerForUrl('https://www.perplexity.ai/')).toBe('perplexity');
  });

  it('returns null for an unrelated site', () => {
    expect(providerForUrl('https://google.com/search?q=x')).toBeNull();
  });

  it('returns null for a missing or malformed url', () => {
    expect(providerForUrl(undefined)).toBeNull();
    expect(providerForUrl('')).toBeNull();
    expect(providerForUrl('not a url')).toBeNull();
  });

  it('is not fooled by a provider name inside another domain', () => {
    // A phishing-shaped or unrelated host must not be treated as a provider.
    expect(providerForUrl('https://claude.ai.evil.com/')).toBeNull();
    expect(providerForUrl('https://notchatgpt.com/')).toBeNull();
  });
});

describe('TabRegistry', () => {
  it('remembers which provider a tab is on', () => {
    const r = new TabRegistry();
    r.note(1, 'https://claude.ai/new');
    expect(r.get(1)).toBe('claude');
  });

  it('forgets a tab that navigated away from the provider', () => {
    // The bug this exists for: the map was add-only, so a tab that had once
    // been on claude.ai stayed marked as Claude's. Navigating it elsewhere
    // and later closing it switched Claude off — an AI the user never closed.
    const r = new TabRegistry();
    r.note(1, 'https://claude.ai/new');
    r.note(1, 'https://google.com/');
    expect(r.get(1)).toBeUndefined();
  });

  it('follows a tab that moves from one provider to another', () => {
    const r = new TabRegistry();
    r.note(1, 'https://claude.ai/new');
    r.note(1, 'https://chatgpt.com/');
    expect(r.get(1)).toBe('chatgpt');
    expect(r.tabsFor('claude')).toEqual([]);
  });

  it('keeps the tab when onUpdated fires without a url', () => {
    // onUpdated also fires for title, favicon and audible changes. Treating
    // those as "navigated away" would drop a tab that never moved.
    const r = new TabRegistry();
    r.note(1, 'https://claude.ai/new');
    r.note(1, undefined);
    expect(r.get(1)).toBe('claude');
  });

  it('tracks several tabs on the same provider', () => {
    const r = new TabRegistry();
    r.note(1, 'https://chatgpt.com/c/1');
    r.note(2, 'https://chatgpt.com/c/2');
    expect(r.tabsFor('chatgpt').sort()).toEqual([1, 2]);
  });

  it('keeps providers separate', () => {
    const r = new TabRegistry();
    r.note(1, 'https://chatgpt.com/');
    r.note(2, 'https://claude.ai/');
    expect(r.tabsFor('chatgpt')).toEqual([1]);
    expect(r.tabsFor('claude')).toEqual([2]);
  });

  it('forgets a closed tab', () => {
    const r = new TabRegistry();
    r.note(1, 'https://claude.ai/');
    r.forget(1);
    expect(r.get(1)).toBeUndefined();
    expect(r.size).toBe(0);
  });

  it('ignores tabs on unrelated sites entirely', () => {
    const r = new TabRegistry();
    r.note(1, 'https://news.example.com/');
    expect(r.size).toBe(0);
  });

  it('survives an SPA navigating within the same provider', () => {
    const r = new TabRegistry();
    r.note(1, 'https://gemini.google.com/app');
    r.note(1, 'https://gemini.google.com/app/abc123');
    expect(r.get(1)).toBe('gemini');
  });
});

describe('shouldDisableProvider', () => {
  it('disables when the last tab for that provider closes', () => {
    expect(shouldDisableProvider(1, [1])).toBe(true);
  });

  it('does NOT disable when another tab for that provider is still open', () => {
    // The user may keep several ChatGPT tabs and close one without meaning
    // to switch ChatGPT off.
    expect(shouldDisableProvider(1, [1, 2])).toBe(false);
  });

  it('disables when the query already reflects the removal', () => {
    // onRemoved can fire after the tab has left the query results.
    expect(shouldDisableProvider(1, [])).toBe(true);
  });

  it('does not disable when unrelated tabs remain', () => {
    expect(shouldDisableProvider(1, [2, 3])).toBe(false);
  });
});
