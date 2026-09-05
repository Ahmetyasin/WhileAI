/** Small DOM utilities shared by broadcast adapters (CLAUDE.md §11). */

/** Resolve once fn() returns truthy, or null at timeout. Polls on rAF-ish cadence. */
export async function waitFor<T>(
  fn: () => T | null | false | undefined,
  timeoutMs: number,
  intervalMs = 100,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs);
  }
}

/** True once fn() has held the same value for ms (§5.11 done-detection debounce). */
export async function stableFor(
  fn: () => string | number,
  ms: number,
  intervalMs = 250,
): Promise<boolean> {
  let last = fn();
  let stableSince = Date.now();
  for (;;) {
    await sleep(intervalMs);
    const v = fn();
    if (v !== last) {
      last = v;
      stableSince = Date.now();
      continue;
    }
    if (Date.now() - stableSince >= ms) return true;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function queryFirstIn(selectors: string[], root: ParentNode = document): Element | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // invalid selector from remote config — skip it
    }
  }
  return null;
}

/** Visible = actually laid out. Chat sites keep hidden duplicate composers around. */
export function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

export function textOf(el: Element | null): string {
  if (!el) return '';
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return (el as HTMLElement).innerText ?? el.textContent ?? '';
}
