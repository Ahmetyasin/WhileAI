import { REMOTE_CONFIG_URL } from './constants';
import type { PlatformSelectorConfig, SelectorConfig } from './types';
import { ext } from './browser';

/**
 * Embedded fallback selector config (spec §3.5). The remote copy is DATA ONLY
 * (strings); it is validated before use and never executed.
 */
export const EMBEDDED_CONFIG: SelectorConfig = {
  version: 13,
  updated: '2026-09-06',
  platforms: {
    // Verified live 2026-08-26 (anonymous session): #ask-input composer,
    // Submit / "Stop response (Esc)" buttons, POST /rest/sse/perplexity_ask.
    // No stable streaming DOM marker — network + button fusion carries it.
    perplexity: {
      streamingSelector: null,
      // Localization-safe first (see the Claude note): aria-labels translate.
      stopButtonSelectors: [
        'button[data-testid="stop-button"]',
        'button[aria-label^="Stop response"]',
        'button[aria-label="Stop generating response"]',
        'button[aria-label*="Stop"]',
      ],
      sendButtonSelectors: [
        'button[aria-label="Submit"]',
        'button[data-testid="submit-button"]',
        'button[aria-label*="Submit"]',
      ],
      composerSelectors: ['#ask-input', 'main div[contenteditable="true"]'],
      thinkingSelector: null,
      modelSelectors: [],
      endpointPatterns: ['/rest/sse/perplexity_ask'],
      userMessageSelectors: ['[data-testid="user-query"]', '.whitespace-pre-line'],
      loginUrlPatterns: ['/sign-in', '/login'],
      challengeSelectors: ['#challenge-running', '.cf-turnstile', '#cf-challenge-running'],
      newChatUrl: 'https://www.perplexity.ai/',
      // Measured live 2026-09-06: body.innerText shrinks mid-answer on this
      // virtualised page while .prose grows monotonically.
      answerSelectors: ['.prose', '[id^="markdown-content"]'],
    },
    chatgpt: {
      // NOT '.result-streaming': verified live 2026-09-06 that ChatGPT leaves
      // that class on a FINISHED answer — streaming=true with no stop button
      // and the answer complete — so it pins isGenerating() true forever and
      // the run only ends via the stalled-generating guard, reporting a 5s
      // answer as 21s. Same trap as Gemini's .model-response-text (§2.2).
      // The stop button is the honest signal; completion falls back to text
      // stability when it is missed.
      streamingSelector: null,
      stopButtonSelectors: [
        '[data-testid="stop-button"]',
        '#composer-submit-button[aria-label*="Stop"]',
        'button[aria-label="Stop streaming"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label="Stop response"]',
        'button[aria-label*="Stop"]',
      ],
      sendButtonSelectors: [
        '[data-testid="send-button"]',
        '[data-testid="composer-send-button"]',
        '#composer-submit-button',
        'button[data-testid="composer-speech-button"]',
        'button[aria-label="Send prompt"]',
        // 2026-09-05: the current composer labels the send control
        // "Send message" and renders a plain <textarea name="prompt">.
        'button[aria-label="Send message"]',
        'main form button[type="submit"]',
      ],
      composerSelectors: [
        '#prompt-textarea',
        'form [contenteditable="true"]',
        'main textarea',
        'textarea[name="prompt"]',
      ],
      thinkingSelector: '[data-testid="thinking-indicator"]',
      modelSelectors: [
        '[data-testid="model-switcher-dropdown-button"]',
        'button[aria-label*="Model selector"]',
      ],
      // ChatGPT posts the prompt to a conversation endpoint whose prefix has
      // changed several times (backend-api, backend-api/f, backend-alt).
      // Match the family, still excluding /conversation/<id>/... subpaths.
      endpointPatterns: ['/backend-(api|alt)/(f/)?conversation(\\?|$)'],
      userMessageSelectors: ['[data-message-author-role="user"]'],
      loginUrlPatterns: ['auth.openai.com', '/auth/login', '/login'],
      challengeSelectors: ['#challenge-running', '.cf-turnstile', '#cf-challenge-running'],
      newChatUrl: 'https://chatgpt.com/',
      answerSelectors: ['[data-message-author-role="assistant"]', '.markdown'],
    },
    claude: {
      streamingSelector: '[data-is-streaming="true"]',
      // aria-labels are LOCALIZED (this user's Gemini renders Turkish), so a
      // language-independent hook must come first. Verified live 2026-09-06:
      // an English-only stop selector matches nothing on a translated UI, no
      // turn is ever opened, and tracking records absolutely nothing.
      stopButtonSelectors: [
        '[data-testid="stop-button"]',
        'button[data-state="open"][aria-label*="top"]',
        'fieldset button[type="submit"][aria-busy="true"]',
        'button[aria-label="Stop response"]',
        'button[aria-label="Stop Response"]',
      ],
      sendButtonSelectors: [
        // aria-labels are localized (this user's Gemini renders Turkish), so
        // the untranslated test id comes first. Verified live 2026-09-06: the
        // composer's send control is data-testid="chat-input-send"; the older
        // generic "send-button" testid is no longer present on claude.ai.
        '[data-testid="chat-input-send"]',
        '[data-testid="send-button"]',
        'fieldset button[type="submit"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send Message"]',
        'button[aria-label*="Send"]',
      ],
      // MUST stay anchored to the ProseMirror root. claude.ai renders other
      // contenteditable regions (artifact surfaces, renamable titles); a bare
      // div[contenteditable="true"] first matches whichever comes first in
      // document order and types the prompt into the wrong box.
      composerSelectors: [
        'div.ProseMirror[contenteditable="true"]',
        'fieldset div[contenteditable="true"]',
        '[enterkeyhint] div[contenteditable="true"]',
        'div[contenteditable="true"]',
      ],
      thinkingSelector: '[data-testid="thinking-indicator"]',
      modelSelectors: [
        '[data-testid="model-selector-dropdown"]',
        'button[data-testid="model-selector"]',
      ],
      endpointPatterns: ['/completion(\\?|$)', '/retry_completion(\\?|$)'],
      userMessageSelectors: ['[data-testid="user-message"]'],
      loginUrlPatterns: ['/login', '/magic-link'],
      challengeSelectors: ['#challenge-running', '.cf-turnstile', '#cf-challenge-running'],
      newChatUrl: 'https://claude.ai/new',
      // Verified live 2026-09-06 on a real conversation: [data-is-streaming]
      // wraps the whole assistant turn; .font-claude-response is the body.
      // (Neither matches on an empty /new page, which is correct — there is
      // no answer yet, and answerLength() falls back to the page.)
      answerSelectors: ['[data-is-streaming]', '.font-claude-response', '.standard-markdown'],
    },
    // Broadcast-only targets. NOT yet verified against the live sites — the
    // adapter health check reports them as broken rather than failing
    // silently, and the side panel shows "needs an update" (§4).
    // Verified live 2026-09-05 on a signed-in account. Gemini renders the send
    // control only once the composer has text, and its aria-label is
    // localized, so the icon name (which is not translated) is listed first.
    gemini: {
      // NOT .model-response-text: that is the container for every finished
      // answer (three of them present on an idle page), so using it as a
      // streaming marker reports "always generating" and the provider's lane
      // never frees. The stop icon is the honest signal — verified live
      // 2026-09-05 by sampling a full generation.
      streamingSelector: null,
      stopButtonSelectors: [
        'button:has(mat-icon[fonticon="stop"])',
        'button[aria-label*="Stop"]',
        'button.stop-icon',
      ],
      sendButtonSelectors: [
        'button:has(mat-icon[fonticon="arrow_upward"])',
        'button[aria-label="Send message"]',
        'button[aria-label*="Send"]',
        'button.send-button',
      ],
      composerSelectors: ['rich-textarea .ql-editor', 'div[contenteditable="true"]'],
      thinkingSelector: null,
      modelSelectors: [],
      endpointPatterns: ['/StreamGenerate', '/BardChatUi'],
      // The precise line FIRST: Gemini also renders a visually-hidden
      // screen-reader copy ("Siz şunu dediniz: <prompt>") inside the same
      // node, so reading user-query/.query-text returns the prompt twice and
      // looks like a double-send. Verified live 2026-09-06 — one click, one
      // prompt; only the accessibility markup is duplicated.
      userMessageSelectors: ['.query-text-line', 'user-query', '.query-text'],
      loginUrlPatterns: ['accounts.google.com', '/ServiceLogin'],
      challengeSelectors: ['#challenge-running', '.cf-turnstile'],
      newChatUrl: 'https://gemini.google.com/app',
      // .side-by-side FIRST: Gemini sometimes returns an A/B preference card
      // ("Hangi yanıtı daha faydalı buldunuz?") whose two candidate answers
      // live OUTSIDE model-response. Verified live 2026-09-06 — model-response
      // held 24 chars while the real card held 293, so growth was measured
      // against the wrong node. Completion still settled correctly either way;
      // this makes the measurement honest rather than lucky.
      answerSelectors: ['.side-by-side', 'model-response', '.model-response-text'],
    },
    // Verified live 2026-09-05 on a signed-in account. DeepSeek renders its
    // controls as unlabelled div[role="button"] elements — there is no
    // aria-label and no data-testid to key on — so the send control is
    // identified by its own component class instead.
    deepseek: {
      streamingSelector: null,
      // While DeepSeek is generating, the composer button turns into a stop
      // control: it drops the .ds-button--disabled class and its icon becomes
      // a square (an <svg><rect>). Verified live 2026-09-05 by sampling the
      // button through a real generation.
      stopButtonSelectors: [
        'div[role="button"].ds-button--primary:not(.ds-button--disabled):has(svg rect)',
        'div[role="button"][aria-label*="Stop"]',
        'button[aria-label*="Stop"]',
      ],
      sendButtonSelectors: [
        'div[role="button"].ds-button--primary',
        'div[role="button"][aria-label*="Send"]',
        'button[type="submit"]',
      ],
      composerSelectors: ['textarea#chat-input', 'textarea'],
      thinkingSelector: null,
      modelSelectors: [],
      endpointPatterns: ['/api/v0/chat/completion'],
      userMessageSelectors: ['.fbb737a4'],
      loginUrlPatterns: ['/sign_in', '/login'],
      challengeSelectors: ['#challenge-running', '.cf-turnstile'],
      newChatUrl: 'https://chat.deepseek.com/',
      answerSelectors: ['.ds-markdown'],
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
    // Broadcast fields are optional (absent is fine), but a present-and-wrong
    // value rejects the whole config, exactly as the required fields do.
    const optStrArr = (v: unknown): string[] | null | undefined =>
      v === undefined ? undefined : strArr(v);
    const userMsg = optStrArr(pc.userMessageSelectors);
    const loginUrls = optStrArr(pc.loginUrlPatterns);
    const challenge = optStrArr(pc.challengeSelectors);
    const answerSel =
      pc.answerSelectors === undefined ? [] : strArr(pc.answerSelectors);
    const newChatUrl =
      pc.newChatUrl === undefined
        ? undefined
        : typeof pc.newChatUrl === 'string'
          ? pc.newChatUrl
          : null;
    if (
      !stop || !send || !composer || !models || !endpoints ||
      streaming === undefined || thinking === undefined ||
      userMsg === null || loginUrls === null || challenge === null || newChatUrl === null
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
      ...(userMsg ? { userMessageSelectors: userMsg } : {}),
      ...(loginUrls ? { loginUrlPatterns: loginUrls } : {}),
      ...(challenge ? { challengeSelectors: challenge } : {}),
      ...(newChatUrl ? { newChatUrl } : {}),
      ...(answerSel && answerSel.length > 0 ? { answerSelectors: answerSel } : {}),
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
/**
 * Pull the newest selector config. This is the whole reason a site redesign
 * does not require a store submission: selectors are data, fetched and
 * validated at runtime. No code is ever fetched or executed (MV3 forbids it).
 *
 * Refuses anything that would make the install worse:
 *  - malformed or unparseable JSON
 *  - a version older than what is already in effect (replay / rollback)
 *  - a config missing platforms the embedded one covers
 */
export async function refreshRemoteConfig(): Promise<boolean> {
  try {
    const res = await fetch(REMOTE_CONFIG_URL, { cache: 'no-cache' });
    if (!res.ok) return false;
    const raw: unknown = await res.json();
    const valid = validateConfig(raw);
    if (!valid) return false;

    // Never go backwards: a stale or replayed file must not undo a newer fix.
    const current = await getEffectiveConfig();
    if (valid.version < current.version) return false;

    // A config that dropped platforms would silently disable them.
    const missing = Object.keys(EMBEDDED_CONFIG.platforms).filter(
      (id) => !(id in valid.platforms),
    );
    if (missing.length > 0) return false;

    await ext.storage.local.set({ [CONFIG_KEY]: valid, remoteConfigFetchedAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/** When the remote config was last successfully applied (for the dashboard). */
export async function getConfigStatus(): Promise<{
  version: number;
  source: 'remote' | 'embedded';
  fetchedAt: number | null;
}> {
  try {
    const res = await ext.storage.local.get([CONFIG_KEY, 'remoteConfigFetchedAt']);
    const cached = validateConfig(res[CONFIG_KEY]);
    const fetchedAt = typeof res.remoteConfigFetchedAt === 'number' ? res.remoteConfigFetchedAt : null;
    if (cached && cached.version > EMBEDDED_CONFIG.version) {
      return { version: cached.version, source: 'remote', fetchedAt };
    }
  } catch {
    // fall through
  }
  return { version: EMBEDDED_CONFIG.version, source: 'embedded', fetchedAt: null };
}
