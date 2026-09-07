import { describe, expect, it } from 'vitest';

/**
 * The feedback mail is the only channel this extension has. It reports
 * nothing about itself by design, so unless the user is handed something
 * worth sending, the only signal that ever arrives is a one-star review.
 *
 * The rule it has to obey: everything in the mail must be something the user
 * can already see on their own screen. The popup composes it, the user reads
 * it, and nothing is sent until they press send in their own mail client.
 */
function composeBody(ctx: {
  version: string;
  userAgent: string;
  enabled: string[];
  problems: { providerId: string; level: string }[];
}): string {
  const lines = ['', '', '---', 'Sent from the whileAI popup. Feel free to delete anything below.'];
  lines.push(`Version: ${ctx.version}`);
  lines.push(`Browser: ${ctx.userAgent}`);
  lines.push(`AIs switched on: ${ctx.enabled.length > 0 ? ctx.enabled.join(', ') : 'none'}`);
  if (ctx.problems.length > 0) {
    lines.push(
      `Currently reported: ${ctx.problems.map((p) => `${p.providerId} (${p.level})`).join(', ')}`,
    );
  }
  return lines.join('\n');
}

const base = {
  version: '0.8.0',
  userAgent: 'Mozilla/5.0 Chrome/152',
  enabled: ['chatgpt', 'claude'],
  problems: [] as { providerId: string; level: string }[],
};

describe('feedback mail contents', () => {
  it('includes what makes a report actionable', () => {
    const body = composeBody(base);
    expect(body).toContain('0.8.0');
    expect(body).toContain('Chrome/152');
    expect(body).toContain('chatgpt, claude');
  });

  it('names a current problem so the report starts from the symptom', () => {
    const body = composeBody({
      ...base,
      problems: [{ providerId: 'claude', level: 'needs_login' }],
    });
    expect(body).toContain('claude (needs_login)');
  });

  it('says "none" rather than leaving a blank when nothing is switched on', () => {
    expect(composeBody({ ...base, enabled: [] })).toContain('AIs switched on: none');
  });

  it('starts with empty lines so the user writes above the details', () => {
    // Their words first; the machine detail is a footer they can delete.
    expect(composeBody(base).startsWith('\n\n---')).toBe(true);
  });

  it('tells the user the details are theirs to delete', () => {
    expect(composeBody(base)).toContain('Feel free to delete');
  });

  it('carries no prompt, answer, or identifier', () => {
    // The privacy promise is the product's strongest claim. A feedback link
    // that quietly attached the last prompt would break it more thoroughly
    // than any analytics endpoint, because the user would never expect it.
    const body = composeBody({
      ...base,
      problems: [{ providerId: 'claude', level: 'error' }],
    });
    for (const forbidden of ['prompt', 'answer', 'token', 'email', 'userId', 'hash']) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });
});
