import { describe, expect, it } from 'vitest';
import { VisibilityTracker } from '../src/core/VisibilityTracker';

/** Fake doc/win with controllable visibility, focus, and clock. */
function makeFake() {
  let now = 0;
  const listeners = new Map<string, Set<() => void>>();
  const state = { visibility: 'visible' as DocumentVisibilityState, focused: true };

  const add = (target: string) => (type: string, fn: EventListenerOrEventListenerObject) => {
    const key = `${target}:${type}`;
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn as () => void);
  };
  const remove = (target: string) => (type: string, fn: EventListenerOrEventListenerObject) => {
    listeners.get(`${target}:${type}`)?.delete(fn as () => void);
  };
  const fire = (key: string) => listeners.get(key)?.forEach((fn) => fn());

  const doc = {
    addEventListener: add('doc'),
    removeEventListener: remove('doc'),
    get visibilityState() {
      return state.visibility;
    },
    hasFocus: () => state.focused,
  };
  const win = { addEventListener: add('win'), removeEventListener: remove('win') };

  return {
    doc,
    win,
    now: () => now,
    advance: (ms: number) => (now += ms),
    hide() {
      state.visibility = 'hidden';
      state.focused = false;
      fire('doc:visibilitychange');
    },
    show() {
      state.visibility = 'visible';
      state.focused = true;
      fire('doc:visibilitychange');
    },
    blur() {
      state.focused = false;
      fire('win:blur');
    },
    focus() {
      state.focused = true;
      fire('win:focus');
    },
  };
}

describe('VisibilityTracker', () => {
  it('accumulates fully visible time', () => {
    const f = makeFake();
    const v = new VisibilityTracker({ doc: f.doc as never, win: f.win as never, now: f.now });
    v.start();
    f.advance(5000);
    const r = v.stop();
    expect(r.visibleMs).toBe(5000);
    expect(r.focusMs).toBe(5000);
    expect(r.escapeCount).toBe(0);
  });

  it('counts hidden periods and escapes', () => {
    const f = makeFake();
    const v = new VisibilityTracker({ doc: f.doc as never, win: f.win as never, now: f.now });
    v.start();
    f.advance(2000); // visible 2s
    f.hide();
    f.advance(3000); // hidden 3s
    f.show();
    f.advance(1000); // visible 1s
    const r = v.stop();
    expect(r.visibleMs).toBe(3000);
    expect(r.escapeCount).toBe(1);
  });

  it('separates focus from visibility (visible but unfocused window)', () => {
    const f = makeFake();
    const v = new VisibilityTracker({ doc: f.doc as never, win: f.win as never, now: f.now });
    v.start();
    f.advance(2000);
    f.blur(); // still visible, not focused (side-by-side window)
    f.advance(3000);
    f.focus();
    f.advance(1000);
    const r = v.stop();
    expect(r.visibleMs).toBe(6000);
    expect(r.focusMs).toBe(3000);
    expect(r.escapeCount).toBe(0); // blur is not an escape
  });

  it('counts multiple escapes', () => {
    const f = makeFake();
    const v = new VisibilityTracker({ doc: f.doc as never, win: f.win as never, now: f.now });
    v.start();
    for (let i = 0; i < 3; i++) {
      f.advance(1000);
      f.hide();
      f.advance(1000);
      f.show();
    }
    const r = v.stop();
    expect(r.escapeCount).toBe(3);
    expect(r.visibleMs).toBe(3000);
  });

  it('starting hidden counts no visible time until shown', () => {
    const f = makeFake();
    f.hide();
    const v = new VisibilityTracker({ doc: f.doc as never, win: f.win as never, now: f.now });
    v.start();
    f.advance(4000);
    f.show();
    f.advance(1000);
    const r = v.stop();
    expect(r.visibleMs).toBe(1000);
    expect(r.escapeCount).toBe(0);
  });
});
