import { beforeEach, describe, expect, it } from 'vitest';
import { insertTextInto } from '../src/adapters/insertText';

/**
 * happy-dom does not implement document.execCommand, so each test installs a
 * stub that behaves like the editor under test. That is the point: the ladder
 * must fall through to a strategy the editor actually honours (§5.8).
 */
function stubExecCommand(impl: ((cmd: string, ui: boolean, val?: string) => boolean) | null): void {
  if (impl === null) {
    // Editor ignores execCommand entirely (returns false, changes nothing).
    (document as unknown as { execCommand: unknown }).execCommand = () => false;
    return;
  }
  (document as unknown as { execCommand: unknown }).execCommand = impl;
}

beforeEach(() => {
  document.body.innerHTML = '';
  stubExecCommand(null);
});

describe('insertTextInto (§5.8 strategy ladder)', () => {
  it('uses execCommand when the editor honours it', async () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    stubExecCommand((cmd, _ui, val) => {
      if (cmd !== 'insertText') return false;
      el.textContent = val ?? '';
      return true;
    });

    const res = await insertTextInto(el, 'hello world', 0);
    expect(res.ok).toBe(true);
    expect(res.strategy).toBe('execCommand');
    expect(el.textContent).toBe('hello world');
  });

  it('falls back to a paste event for a ProseMirror-style editor', async () => {
    // Mimics ProseMirror: ignores execCommand, but handles a real paste event.
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    el.addEventListener('paste', (ev) => {
      const text = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      el.textContent = text;
      ev.preventDefault();
    });

    const res = await insertTextInto(el, 'prompt for prosemirror', 0);
    expect(res.ok).toBe(true);
    expect(res.strategy).toBe('paste');
    expect(el.textContent).toBe('prompt for prosemirror');
  });

  it('falls back to the native setter for a React-controlled textarea', async () => {
    const el = document.createElement('textarea');
    document.body.appendChild(el);
    // No execCommand, no paste handler: only the value setter + input event works.
    let sawInput = false;
    el.addEventListener('input', () => { sawInput = true; });

    const res = await insertTextInto(el, 'react textarea prompt', 0);
    expect(res.ok).toBe(true);
    expect(res.strategy).toBe('nativeSetter');
    expect(el.value).toBe('react textarea prompt');
    expect(sawInput).toBe(true);
  });

  it('reports failure rather than claiming success when nothing works', async () => {
    // A contenteditable that swallows every strategy — the §5.8 step-4 case.
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.addEventListener('paste', (ev) => ev.preventDefault()); // accepts but ignores
    document.body.appendChild(el);

    const res = await insertTextInto(el, 'this will not land', 0);
    expect(res.ok).toBe(false);
    expect(res.strategy).toBe('none');
  });

  it('does not report success when the editor keeps only part of a long prompt', async () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    el.addEventListener('paste', (ev) => {
      const text = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      el.textContent = text.slice(0, 5); // truncating editor
      ev.preventDefault();
    });

    const res = await insertTextInto(el, 'a'.repeat(200), 0);
    expect(res.ok).toBe(false);
  });

  it('preserves multi-line prompts with code blocks (§5.9)', async () => {
    const el = document.createElement('textarea');
    document.body.appendChild(el);
    const prompt = 'explain this:\n\n```ts\nconst a = 1;\n```\n\nthanks';

    const res = await insertTextInto(el, prompt, 0);
    expect(res.ok).toBe(true);
    expect(el.value).toBe(prompt);
  });

  it('replaces any draft already in the composer instead of appending', async () => {
    const el = document.createElement('textarea');
    el.value = 'leftover draft';
    document.body.appendChild(el);

    const res = await insertTextInto(el, 'the real prompt', 0);
    expect(res.ok).toBe(true);
    expect(el.value).toBe('the real prompt');
  });

  it('rejects a strategy that fills the DOM but leaves send disabled', async () => {
    // The real-world ProseMirror/Quill trap: execCommand writes visible text
    // but the editor model stays empty, so the site keeps send disabled.
    // Verified against a live model-backed editor before this test was written.
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);

    let model = '';
    stubExecCommand((cmd, _ui, val) => {
      if (cmd !== 'insertText') return false;
      el.textContent = val ?? '';   // DOM updated...
      return true;                   // ...but the model is untouched
    });
    el.addEventListener('paste', (ev) => {
      const text = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      model = text;                  // paste is the pathway this editor honours
      el.textContent = text;
      ev.preventDefault();
    });

    const res = await insertTextInto(el, 'needs the model', 0, () => model.trim().length > 0);
    expect(res.ok).toBe(true);
    expect(res.strategy).toBe('paste');   // NOT execCommand
    expect(model).toBe('needs the model');
  });

  it('fails with send-still-disabled when no strategy convinces the editor', async () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    stubExecCommand((cmd, _ui, val) => {
      if (cmd !== 'insertText') return false;
      el.textContent = val ?? '';
      return true;
    });

    // Send never becomes enabled: the editor model never accepted anything.
    const res = await insertTextInto(el, 'no editor will take this', 0, () => false);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('send-still-disabled');
  });

  it('handles a 5k-character prompt', async () => {
    const el = document.createElement('textarea');
    document.body.appendChild(el);
    const big = 'x'.repeat(5000);
    const res = await insertTextInto(el, big, 0);
    expect(res.ok).toBe(true);
    expect(el.value).toHaveLength(5000);
  });
});

/**
 * Lexical (Perplexity) ignores execCommand on a programmatic range, so
 * clearExisting() silently did nothing and each insert APPENDED. Observed
 * live 2026-09-06: the composer held the same prompt seven times over.
 * Lexical does honour a beforeinput deleteContentBackward.
 */
it('clears a Lexical-style editor that ignores execCommand', async () => {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  el.textContent = 'stale text from a previous prompt';
  document.body.appendChild(el);

  // Mimic Lexical: execCommand does nothing; beforeinput deletes.
  document.execCommand = () => false;
  el.addEventListener('beforeinput', (e) => {
    if ((e as InputEvent).inputType.startsWith('deleteContent')) el.textContent = '';
  });
  // A real paste replaces whatever remains.
  el.addEventListener('paste', (e) => {
    const t = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    el.textContent += t;
  });

  const res = await insertTextInto(el, 'the new prompt', 0);
  expect(res.ok).toBe(true);
  // The critical assertion: the old text must be GONE, not prefixed.
  expect(el.textContent).toBe('the new prompt');
  expect(el.textContent).not.toContain('stale text');
});

/**
 * Gemini's send button enables noticeably later than the text lands. The
 * ladder judged the strategy failed and moved on, and the NEXT strategy
 * inserted the prompt a second time on top of the first. Observed live
 * 2026-09-06: Gemini received "Say the word banana. Say the word banana."
 */
it('does not insert twice when the send button is merely slow to enable', async () => {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  document.body.appendChild(el);

  let enabled = false;
  // execCommand appends (like a real editor); the button enables late.
  document.execCommand = (cmd: string, _s?: boolean, val?: string) => {
    if (cmd === 'insertText') { el.textContent += val ?? ''; setTimeout(() => { enabled = true; }, 300); return true; }
    if (cmd === 'delete') { el.textContent = ''; return true; }
    return false;
  };
  el.addEventListener('paste', (e) => {
    el.textContent += (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
  });

  const res = await insertTextInto(el, 'banana', 50, () => enabled);
  expect(res.ok).toBe(true);
  // The critical assertion: exactly once, not "bananabanana".
  expect(el.textContent).toBe('banana');
});

/**
 * A composer holding the prompt TWICE must never be approved for sending.
 * Observed live 2026-09-06: a clear silently failed, the insert appended, and
 * the prefix match in contains() approved "Name one animal.Name one animal."
 */
it('rejects a composer that holds the prompt twice', async () => {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  el.textContent = 'Name one animal.';
  document.body.appendChild(el);

  // Every strategy appends and clearing does nothing — the failure mode.
  document.execCommand = (cmd: string, _s?: boolean, val?: string) => {
    if (cmd === 'insertText') { el.textContent += val ?? ''; return true; }
    return false; // 'delete' fails, as it did on the live page
  };

  const res = await insertTextInto(el, 'Name one animal.', 10, () => true);
  // Either it cleared and inserted once, or it failed loudly. What must NEVER
  // happen is ok:true with a doubled composer.
  if (res.ok) {
    expect(el.textContent).toBe('Name one animal.');
  } else {
    expect(res.ok).toBe(false);
  }
});

describe('clearing a Lexical composer (Perplexity)', () => {
  /**
   * Perplexity's editor honours neither execCommand('delete') nor a
   * `beforeinput` delete on a programmatic range — measured live 2026-09-07:
   * 892 characters of stacked drafts survived both, and every subsequent
   * insert appended to them until the send failed. It DOES honour a real
   * Backspace key event over a selection, which took the same composer to 0.
   *
   * This models that editor: only a Backspace keydown clears it.
   */
  function lexicalComposer(initial: string): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.textContent = initial;
    el.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Backspace') el.textContent = '';
    });
    // Deliberately ignores beforeinput deletes, like the real editor.
    el.addEventListener('beforeinput', (ev) => {
      const t = (ev as InputEvent).inputType;
      if (t.startsWith('delete')) ev.preventDefault();
    });
    document.body.appendChild(el);
    return el;
  }

  it('clears a stacked draft before inserting, instead of appending to it', async () => {
    const el = lexicalComposer('an old draft that was never cleared');
    // The editor accepts new text only via execCommand insertText.
    stubExecCommand((cmd, _ui, val) => {
      if (cmd === 'insertText') { el.textContent += val ?? ''; return true; }
      return false; // delete is ignored, as on the real site
    });

    const res = await insertTextInto(el, 'the new prompt', 50, () => true);
    expect(res.ok).toBe(true);
    expect(el.textContent).toBe('the new prompt');
  });

  it('does not leave two prompts stacked when called twice', async () => {
    const el = lexicalComposer('');
    stubExecCommand((cmd, _ui, val) => {
      if (cmd === 'insertText') { el.textContent += val ?? ''; return true; }
      return false;
    });
    await insertTextInto(el, 'first prompt', 50, () => true);
    await insertTextInto(el, 'second prompt', 50, () => true);
    expect(el.textContent).toBe('second prompt');
  });
});
