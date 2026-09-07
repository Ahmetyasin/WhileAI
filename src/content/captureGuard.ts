/**
 * Decides whether a user message seen in the page is a NEW prompt to relay,
 * or something already accounted for.
 *
 * Split out of broadcast.ts because it is the part that has to be right under
 * conditions that are painful to reproduce by hand: switching models, editing
 * a message, regenerating, reloading, navigating between conversations. Those
 * are ordinary things a user does, and each one re-renders the transcript, so
 * "the newest user message changed" is NOT the same as "the user asked
 * something new".
 *
 * The rule: a prompt is relayed once per conversation. Remembering only the
 * PREVIOUS hash was not enough — switching the model re-rendered the page and
 * the same prompt went out again (reported 2026-09-07).
 */

/** How many hashes to remember per conversation. */
const MAX_REMEMBERED = 200;

export interface CaptureGuardOptions {
  /** Identifies the conversation; changing it clears the memory. */
  conversationKey: string;
}

export class CaptureGuard {
  /**
   * Insertion-ordered, so the oldest can be dropped once the set is full. A
   * Set is used rather than a single value because the transcript can present
   * ANY earlier message as "the newest" for a moment while it re-renders.
   */
  private seen = new Set<string>();
  private key: string;

  constructor(opts: CaptureGuardOptions) {
    this.key = opts.conversationKey;
  }

  /**
   * Mark a hash as already accounted for without relaying it — used to
   * baseline whatever is on the page when the script starts, and to record
   * prompts the extension itself delivered.
   */
  markSeen(hash: string): void {
    this.seen.add(hash);
    this.trim();
  }

  /**
   * Should this message be relayed? True only the first time a given prompt
   * is seen in the current conversation.
   */
  shouldRelay(hash: string): boolean {
    if (this.seen.has(hash)) return false;
    this.seen.add(hash);
    this.trim();
    return true;
  }

  /**
   * Point the guard at a conversation.
   *
   * A different conversation starts with a clean slate: the same question
   * asked in a new chat is a genuinely new prompt and must be relayed. The
   * SAME conversation must keep its memory, because SPA navigation fires this
   * on re-renders that are not really navigation at all.
   */
  setConversation(key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.seen.clear();
  }

  get conversationKey(): string {
    return this.key;
  }

  /** Test/diagnostic helper. */
  get size(): number {
    return this.seen.size;
  }

  private trim(): void {
    while (this.seen.size > MAX_REMEMBERED) {
      const oldest = this.seen.values().next().value;
      if (oldest === undefined) return;
      this.seen.delete(oldest);
    }
  }
}

/**
 * The stable identity of a conversation, derived from its URL.
 *
 * Query strings and fragments change for reasons that have nothing to do with
 * which conversation is on screen — switching the model, opening a side
 * panel, a share dialog. Only the path is used, so those do not read as a new
 * conversation and re-arm the relay.
 */
export function conversationKeyOf(href: string): string {
  try {
    const u = new URL(href);
    return u.origin + u.pathname;
  } catch {
    return href;
  }
}
