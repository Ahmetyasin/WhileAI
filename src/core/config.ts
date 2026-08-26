import { REMOTE_CONFIG_URL } from './constants';
import type { PlatformSelectorConfig, SelectorConfig } from './types';
import { ext } from './browser';

/**
 * Embedded fallback selector config (spec §3.5). The remote copy is DATA ONLY
 * (strings); it is validated before use and never executed.
 */
export const EMBEDDED_CONFIG: SelectorConfig = {
  version: 3,
  updated: '2026-08-26',
  platforms: {
    // Verified live 2026-08-26 (anonymous session): #ask-input composer,
    // Submit / "Stop response (Esc)" buttons, POST /rest/sse/perplexity_ask.
    // No stable streaming DOM marker — network + button fusion carries it.
    perplexity: {
      streamingSelector: null,
      stopButtonSelectors: [
        'button[aria-label^="Stop response"]',
        'button[aria-label="Stop generating response"]',
      ],
      sendButtonSelectors: ['button[aria-label="Submit"]'],
      composerSelectors: ['#ask-input', 'main div[contenteditable="true"]'],
      thinkingSelector: null,
      modelSelectors: [],
      endpointPatterns: ['/rest/sse/perplexity_ask'],
    },
    // Login-walled; selectors are best-known, measurement leans on the
    // network signal (OpenAI-compatible SSE). Field-verify before release.
    deepseek: {
      streamingSelector: null,
      stopButtonSelectors: [
        'button[aria-label*="Stop"]',
        '[role="button"][aria-label*="Stop"]',
      ],
      sendButtonSelectors: ['[data-testid="send-button"]', 'button[aria-label*="Send"]'],
      composerSelectors: ['#chat-input', 'textarea'],
      thinkingSelector: null,
      modelSelectors: [],
      endpointPatterns: ['/api/v0/chat/completion(\\?|$)'],
    },
    chatgpt: {
      streamingSelector: '.result-streaming',
      stopButtonSelectors: [
        '[data-testid="stop-button"]',
        '#composer-submit-button[aria-label*="Stop"]',
        'button[aria-label="Stop streaming"]',
        'button[aria-label="Stop generating"]',
      ],
      sendButtonSelectors: [
        '[data-testid="send-button"]',
        '[data-testid="composer-send-button"]',
        '#composer-submit-button',
        'button[data-testid="composer-speech-button"]',
        'button[aria-label="Send prompt"]',
      ],
      composerSelectors: ['#prompt-textarea', 'form [contenteditable="true"]', 'main textarea'],
      thinkingSelector: '[data-testid="thinking-indicator"]',
      modelSelectors: [
        '[data-testid="model-switcher-dropdown-button"]',
        'button[aria-label*="Model selector"]',
      ],
      // Anchored: POST .../conversation only, not /conversation/<id>/... subpaths.
      endpointPatterns: ['/backend-api/(f/)?conversation(\\?|$)'],
    },
    claude: {
      streamingSelector: '[data-is-streaming="true"]',
      stopButtonSelectors: [
        'button[aria-label="Stop response"]',
        'button[aria-label="Stop Response"]',
        '[data-testid="stop-button"]',
      ],
      sendButtonSelectors: [
        'button[aria-label="Send message"]',
        'button[aria-label="Send Message"]',
        '[data-testid="send-button"]',
      ],
      composerSelectors: ['div[contenteditable="true"]', 'fieldset [contenteditable]'],
      thinkingSelector: '[data-testid="thinking-indicator"]',
      modelSelectors: [
        '[data-testid="model-selector-dropdown"]',
        'button[data-testid="model-selector"]',
      ],
      endpointPatterns: ['/completion(\\?|$)', '/retry_completion(\\?|$)'],
    },
  },
};

const CONFIG_KEY = 'remoteSelectorConfig';

export function validateConfig(raw: unknown): SelectorConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.version !== 'number' || typeof c.platforms !== 'object' || c.platforms === null) {
    return null;
  }
  const platforms: Record<string, PlatformSelectorConfig> = {};
  for (const [id, p] of Object.entries(c.platforms as Record<string, unknown>)) {
    if (typeof p !== 'object' || p === null) return null;
    const pc = p as Record<string, unknown>;
    const strArr = (v: unknown): string[] | null =>
      Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
    const strOrNull = (v: unknown): string | null | undefined =>
      v === null || typeof v === 'string' ? (v as string | null) : undefined;

    const stop = strArr(pc.stopButtonSelectors);
    const send = strArr(pc.sendButtonSelectors);
    const composer = pc.composerSelectors === undefined ? [] : strArr(pc.composerSelectors);
    const models = strArr(pc.modelSelectors);
    const endpoints = strArr(pc.endpointPatterns);
    const streaming = strOrNull(pc.streamingSelector);
    const thinking = strOrNull(pc.thinkingSelector);
    if (
      !stop || !send || !composer || !models || !endpoints ||
      streaming === undefined || thinking === undefined
    ) {
      return null;
    }
    // Regex sources must compile; a broken pattern rejects the whole config.
    try {
      endpoints.forEach((e) => new RegExp(e));
    } catch {
      return null;
    }
    platforms[id] = {
      streamingSelector: streaming,
      stopButtonSelectors: stop,
      sendButtonSelectors: send,
      composerSelectors: composer,
      thinkingSelector: thinking,
      modelSelectors: models,
      endpointPatterns: endpoints,
    };
  }
  return {
    version: c.version,
    updated: typeof c.updated === 'string' ? c.updated : '',
    platforms,
  };
}

/** Remote (validated, cached) config if newer, otherwise embedded fallback. */
export async function getEffectiveConfig(): Promise<SelectorConfig> {
  try {
    const res = await ext.storage.local.get(CONFIG_KEY);
    const cached = validateConfig(res[CONFIG_KEY]);
    if (cached && cached.version > EMBEDDED_CONFIG.version) return cached;
  } catch {
    // fall through to embedded
  }
  return EMBEDDED_CONFIG;
}

export function getPlatformConfig(config: SelectorConfig, platformId: string): PlatformSelectorConfig {
  return config.platforms[platformId] ?? EMBEDDED_CONFIG.platforms[platformId];
}

/** Fetch remote config; on any failure the embedded/cached config stays in effect. */
export async function refreshRemoteConfig(): Promise<boolean> {
  try {
    const res = await fetch(REMOTE_CONFIG_URL, { cache: 'no-cache' });
    if (!res.ok) return false;
    const raw: unknown = await res.json();
    const valid = validateConfig(raw);
    if (!valid) return false;
    await ext.storage.local.set({ [CONFIG_KEY]: valid });
    return true;
  } catch {
    return false;
  }
}
