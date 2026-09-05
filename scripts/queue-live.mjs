/**
 * The behaviour the product promises: fire a second prompt without waiting for
 * the first to finish, and have each provider run its own queue.
 *
 *   node scripts/queue-live.mjs
 *
 * Prompt 1 goes to every provider; while they are still answering, prompt 2 is
 * queued. Each provider takes prompt 2 only once its own answer completes
 * (CLAUDE.md §7 lane rule), with the §5.18 pacing gap.
 */
import { readFileSync } from 'node:fs';
import { evaluate, targetForHost } from './cdp.mjs';

const cfg = JSON.parse(readFileSync(new URL('../config/selectors.json', import.meta.url), 'utf8'));
const HOSTS = { chatgpt:'chatgpt.com', gemini:'gemini.google.com', deepseek:'deepseek.com' };
const ids = ['chatgpt', 'gemini', 'deepseek'];

const P1 = 'Name one country in Europe. Answer with just the name.';
const P2 = 'Name one fruit. Answer with just the name.';

/** Insert + click, returning immediately (does NOT wait for the answer). */
const fire = (p, text) => `
  const p = ${JSON.stringify(p)};
  const text = ${JSON.stringify(text)};
  const q = (s) => { for (const x of s ?? []) { try { const e=document.querySelector(x); if (e) return e; } catch {} } return null; };
  const el = q(p.composerSelectors);
  if (!el) return JSON.stringify({ ok:false, why:'no composer' });
  el.focus();
  try { document.execCommand('insertText', false, text); } catch {}
  if (!(el.textContent || el.value || '').trim() && 'value' in el) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el, text);
    el.dispatchEvent(new InputEvent('input',{bubbles:true}));
  }
  await new Promise(r=>setTimeout(r,600));
  const btn = q(p.sendButtonSelectors);
  if (!btn) return JSON.stringify({ ok:false, why:'no send button' });
  btn.click();
  return JSON.stringify({ ok:true, at: Date.now() });
`;

/** Is this provider still generating right now? */
const busy = (p) => `
  const p = ${JSON.stringify(p)};
  const hit = (s) => (s ?? []).some(x => { try { return !!document.querySelector(x); } catch { return false; } });
  const gen = hit(p.stopButtonSelectors) || (p.streamingSelector ? hit([p.streamingSelector]) : false);
  return JSON.stringify({ generating: gen, msgs: (() => {
    for (const s of p.userMessageSelectors ?? []) {
      try { const n = document.querySelectorAll(s); if (n.length) return n.length; } catch {}
    } return 0; })() });
`;

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);

console.log('\n--- PROMPT 1 to every provider ---');
const targets = {};
for (const id of ids) {
  targets[id] = await targetForHost(HOSTS[id]);
  if (!targets[id]) { console.log(`${el()}s  ${id}: no tab, skipping`); continue; }
  const r = JSON.parse(await evaluate(targets[id], fire(cfg.platforms[id], P1), 40_000));
  console.log(`${el()}s  ${id.padEnd(9)} prompt 1 ${r.ok ? 'sent' : 'FAILED: ' + r.why}`);
  await new Promise(r => setTimeout(r, 3000)); // §5.18 pacing
}

// Immediately queue prompt 2 — do not wait for prompt 1 to finish.
console.log('\n--- PROMPT 2 queued while prompt 1 is still running ---');
const queued = new Set(ids.filter((i) => targets[i]));
const sent2 = {};
let guard = 0;

while (queued.size && guard++ < 150) {
  for (const id of [...queued]) {
    const st = JSON.parse(await evaluate(targets[id], busy(cfg.platforms[id]), 20_000));
    if (st.generating) continue;               // lane still busy — wait
    const r = JSON.parse(await evaluate(targets[id], fire(cfg.platforms[id], P2), 40_000));
    sent2[id] = { at: el(), ok: r.ok };
    console.log(`${el()}s  ${id.padEnd(9)} lane free -> prompt 2 ${r.ok ? 'sent' : 'FAILED: ' + r.why}`);
    queued.delete(id);
    await new Promise(r => setTimeout(r, 3000));
  }
  if (queued.size) await new Promise(r => setTimeout(r, 1500));
}

console.log('\n--- final message counts ---');
for (const id of ids) {
  if (!targets[id]) continue;
  await new Promise(r => setTimeout(r, 500));
  const st = JSON.parse(await evaluate(targets[id], busy(cfg.platforms[id]), 20_000));
  console.log(`${id.padEnd(9)} user messages in conversation: ${st.msgs}  (2 = both prompts landed)`);
}
console.log('');
