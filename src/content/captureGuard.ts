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
  /** Relayed but not yet confirmed queued by the worker. */
  private pending = new Set<string>();
  /** Suppressed only because they were on the page at injection time. */
  private baselined = new Set<string>();
  /** Suppressed permanently: prompts this extension delivered itself. */
  private permanent = new Set<string>();
  private key: string;

  constructor(opts: CaptureGuardOptions) {
    this.key = opts.conversationKey;
  }

  /**
   * Mark a hash as already accounted for without relaying it — used to
   * baseline whatever is on the page when the script starts, and to record
   * prompts the extension itself delivered.
   */
  markSeen(hash: string, opts: { echo?: boolean } = {}): void {
    this.seen.add(hash);
    // An echo — a prompt WE delivered into this tab — must never be relayed
    // back out, no matter what happens afterwards. A baseline is weaker: it
    // only says "this was already on the page when I loaded", which stops
    // being a reason to suppress once the user asks it again.
    if (opts.echo === true) this.permanent.add(hash);
    else this.baselined.add(hash);
    this.trim();
  }

  /**
   * The transcript grew: a message arrived that was not there before.
   *
   * This releases BASELINED hashes only. Baselining exists to stop a freshly
   * injected script re-broadcasting the conversation it landed in — but it
   * recorded the hash, so asking the same question again was suppressed
   * forever. Reloading the extension and repeating your last prompt is an
   * ordinary thing to do, and it silently sent nothing (live 2026-09-07: the
   * same prompt vanished on two consecutive runs).
   */
  noteNewMessage(): void {
    for (const hash of this.baselined) this.seen.delete(hash);
    this.baselined.clear();
  }

  /**
   * Should this message be relayed? True only the first time a given prompt
   * is seen in the current conversation.
   *
   * The hash is remembered immediately so a re-render moments later cannot
   * relay it twice — but as PENDING, not settled. Until the worker confirms
   * it actually queued the prompt, `unconfirm` can hand it back.
   */
  shouldRelay(hash: string): boolean {
    if (this.seen.has(hash)) return false;
    this.seen.add(hash);
    this.pending.add(hash);
    this.trim();
    return true;
  }

  /** The worker queued this prompt: it is settled and must never go again. */
  confirm(hash: string): void {
    this.pending.delete(hash);
  }

  /**
   * The relay did NOT land — the report was dropped, or the worker restarted
   * mid-message. Forget it so the next poll can offer it again.
   *
   * Without this a lost report lost the prompt permanently: the page still
   * showed it, but the guard would never present it a second time. Observed
   * live 2026-09-07, one of five prompts vanished with no error anywhere.
   *
   * Only PENDING hashes are released. A hash recorded by markSeen (baselining
   * an existing conversation, or suppressing our own delivery) was never a
   * relay attempt, so it stays suppressed.
   */
  unconfirm(hash: string): void {
    if (!this.pending.delete(hash)) return;
    if (this.permanent.has(hash)) return;
    this.seen.delete(hash);
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
    this.pending.clear();
    this.baselined.clear();
    this.permanent.clear();
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
      this.baselined.delete(oldest);
      this.permanent.delete(oldest);
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
