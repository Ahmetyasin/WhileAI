/**
 * Getting text into a chat composer (CLAUDE.md §5.8) — the most breakage-prone
 * operation in the extension.
 *
 * Rich editors (ProseMirror on ChatGPT/Claude, Quill on Gemini, Lexical on
 * Perplexity) keep their own document model. Assigning `.value` or
 * `.innerText` mutates the DOM without telling the framework, so the editor
 * state stays empty and the send button stays disabled — the text looks
 * present but cannot be sent.
 *
 * So: try the strategies that go through real input events, in order, and
 * verify after each one. Never report success without evidence, and never
 * fail silently (§4).
 */
import { sleep, textOf } from './domHelpers';

export type InsertStrategy = 'execCommand' | 'paste' | 'nativeSetter' | 'none';

export interface InsertResult {
  ok: boolean;
  strategy: InsertStrategy;
  /** What the composer contained afterwards, for diagnostics. */
  observed: string;
  /**
   * Why a strategy was rejected, when text appeared in the DOM but the editor
   * never accepted it. Distinguishes "nothing happened" from the more
   * dangerous "it looks inserted but the site disagrees".
   */
  reason?: 'send-still-disabled' | 'text-not-present';
}

function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/ /g, ' ').trim();
}

/**
 * Did the text actually land? Compared loosely: editors reflow whitespace and
 * may render newlines as separate blocks.
 */
function contains(el: Element, text: string): boolean {
  const got = normalize(textOf(el));
  const want = normalize(text);
  if (want.length === 0) return got.length === 0;
  if (got === want) return true;
  // A composer holding markedly MORE than the prompt is not a success: it is
  // the prompt on top of something else. Observed live 2026-09-06 — a clear
  // silently failed, the insert appended, and a prefix match happily approved
  // "Name one animal.Name one animal." for sending. Allow a little slack for
  // editors that add trailing structure, but never a second copy.
  // Scale the slack with the prompt: a fixed +20 let a short prompt's DOUBLE
  // through ("Name one animal." is 16 chars, so 32 fit under the limit).
  if (got.length > want.length + Math.min(20, Math.floor(want.length / 2))) return false;
  // Long prompts: a prefix match is enough evidence the insert took.
  const probe = want.slice(0, Math.min(80, want.length));
  return got.includes(probe);
}

function clearExisting(el: Element): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    setNativeValue(el, '');
    return;
  }
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  sel?.removeAllRanges();
  sel?.addRange(range);
  // Selecting is not deleting. ProseMirror replaces a selection on the next
  // insert, but Lexical (Perplexity) does not — it ignores execCommand on a
  // programmatic range, so the old text survives and every insert APPENDS.
  // Observed live 2026-09-06 with the same prompt stacked seven times, and
  // again 2026-09-07 with 892 characters of stacked drafts.
  if (textOf(el).trim().length === 0) return;
  try {
    document.execCommand('delete');
  } catch {
    // ignored: the fallbacks below are the real path
  }
  if (textOf(el).trim().length === 0) return;

  // beforeinput deletes come first because they are the well-specified way to
  // ask an editor to remove a selection. Measured on Perplexity 2026-09-07:
  // it honours NEITHER, so the Backspace key below is what actually works —
  // but other editors do honour these, and they are cheap to try.
  for (const inputType of ['deleteContentBackward', 'deleteContent']) {
    el.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
    if (textOf(el).trim().length === 0) return;
  }

  // Last resort, and the one that works on Lexical: a real Backspace over the
  // selection. Measured live 2026-09-07 — it took a composer holding 892
  // characters straight to 0 when nothing else moved it. The selection is
  // re-applied because the events above may have collapsed it.
  const sel2 = window.getSelection();
  const range2 = document.createRange();
  range2.selectNodeContents(el);
  sel2?.removeAllRanges();
  sel2?.addRange(range2);
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(
      new KeyboardEvent(type, {
        key: 'Backspace',
        code: 'Backspace',
        keyCode: 8,
        which: 8,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }
}

/** React/Vue track the value via the prototype setter; bypass their patched one. */
function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc?.set?.call(el, value);
}

function tryExecCommand(el: HTMLElement, text: string): boolean {
  try {
    el.focus();
    clearExisting(el);
    // Deprecated but still the only API that drives a rich editor's own
    // input pipeline the way real typing does.
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

function tryPaste(el: HTMLElement, text: string): boolean {
  try {
    el.focus();
    clearExisting(el);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return true;
  } catch {
    return false;
  }
}

function tryNativeSetter(el: HTMLElement, text: string): boolean {
  if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return false;
  try {
    el.focus();
    setNativeValue(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Insert `text` into `el`, verifying after each strategy.
 *
 * Verification is deliberately two-sided (§5.8): the text must be present AND
 * the site must agree the composer holds a sendable message. Rich editors keep
 * their own model, so a DOM write can leave the text visible while the editor
 * — and therefore the send button — still considers the composer empty. Only
 * checking the text would report success for a prompt that can never be sent.
 *
 * `isReady` is supplied by the adapter (typically "send button is present and
 * not disabled"). When it is omitted, the text check alone is used.
 *
 * `settleMs` gives the editor a beat to update its model and re-enable the
 * send button before we check.
 */
/** Poll `fn` until it is true or the budget runs out (§5.10 allows 3s). */
async function waitForReady(fn: () => boolean, budgetMs: number): Promise<boolean> {
  const step = 100;
  for (let waited = 0; waited < budgetMs; waited += step) {
    if (fn()) return true;
    await sleep(step);
  }
  return fn();
}

export async function insertTextInto(
  el: HTMLElement,
  text: string,
  settleMs = 120,
  isReady?: () => boolean,
): Promise<InsertResult> {
  const attempts: [InsertStrategy, (e: HTMLElement, t: string) => boolean][] = [
    ['execCommand', tryExecCommand],
    ['paste', tryPaste],
    ['nativeSetter', tryNativeSetter],
  ];

  let lastReason: InsertResult['reason'] = 'text-not-present';

  for (const [strategy, run] of attempts) {
    let dispatched = false;
    try {
      dispatched = run(el, text);
    } catch {
      dispatched = false;
    }
    if (!dispatched) continue;
    await sleep(settleMs);

    if (!contains(el, text)) {
      // Either nothing landed, or something landed ON TOP of existing content
      // (a clear that silently failed). Reset before the next strategy so it
      // cannot append to the mess — otherwise the composer accumulates and a
      // doubled prompt eventually gets sent.
      clearExisting(el);
      lastReason = 'text-not-present';
      continue;
    }
    if (isReady && !isReady()) {
      // The text IS in the DOM, so this strategy reached the editor. Give the
      // site a moment to enable its send button before writing the attempt
      // off: Gemini's takes noticeably longer than settleMs, and moving on
      // meant the next strategy inserted the prompt a SECOND time on top of
      // the first. Observed live 2026-09-06 — Gemini received
      // "Say the word banana. Say the word banana."
      const ready = await waitForReady(isReady, 2000);
      if (!ready) {
        // Genuinely not accepted. Clear what we typed so the next strategy
        // starts from an empty composer rather than appending to it.
        clearExisting(el);
        lastReason = 'send-still-disabled';
        continue;
      }
    }
    return { ok: true, strategy, observed: textOf(el) };
  }

  return { ok: false, strategy: 'none', observed: textOf(el), reason: lastReason };
}
