import type { PlatformSelectorConfig } from '../core/types';

/** Platform adapter contract (spec §3.4). */
export interface PlatformAdapter {
  id: string;
  hosts: string[];
  config: PlatformSelectorConfig;

  /** Signal B: submit/stop button */
  findSubmitButton(): Element | null;
  findStopButton(): Element | null;
  isGenerating(): boolean;

  /** Signal C: DOM streaming marker */
  streamingSelector: string | null;

  /** Classification */
  detectModel(): string | null;
  hasThinkingIndicator(): boolean;

  /** Health */
  selfTest(): { ok: boolean; missing: string[] };
}

export function queryFirst(selectors: string[], root: ParentNode = document): Element | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // invalid selector from remote config — skip
    }
  }
  return null;
}
