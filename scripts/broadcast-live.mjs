/**
 * The real thing: send ONE prompt to every signed-in provider using the
 * extension's own adapter logic, and measure each wait.
 *
 *   node scripts/broadcast-live.mjs "your prompt"
 *
 * Uses the shipped insertion ladder and submit rules (CLAUDE.md §5.8/§5.10),
 * with the §5.18 human-pacing gap between providers.
 */
import { readFileSync } from 'node:fs';
import { evaluate, targetForHost } from './cdp.mjs';

const cfg = JSON.parse(readFileSync(new URL('../config/selectors.json', import.meta.url), 'utf8'));
const HOSTS = { chatgpt: 'chatgpt.com', gemini: 'gemini.google.com', deepseek: 'deepseek.com',
                claude: 'claude.ai', perplexity: 'perplexity.ai' };
const PROMPT = process.argv[2] ?? 'In one short sentence: why is the sky blue?';
const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['chatgpt', 'gemini', 'deepseek'];

/** Runs in the page: insert via the ladder, verify, submit, confirm. */
const SEND = (p, text) => `
  const p = ${JSON.stringify(p)};
  const text = ${JSON.stringify(text)};
  const q = (sels) => { for (const s of sels ?? []) { try { const e=document.querySelector(s); if (e) return e; } catch {} } return null; };
  const sendBtn = () => q(p.sendButtonSelectors);
  const sendEnabled = () => { const b = sendBtn(); if (!b) return false;
    if (b.disabled) return false; return b.getAttribute('aria-disabled') !== 'true'; };
  const el = q(p.composerSelectors);
  if (!el) return { ok:false, why:'no composer' };

  // §5.8 ladder, verifying the SITE agrees after each step.
  const strategies = [
    ['execCommand', () => { el.focus(); return document.execCommand('insertText', false, text); }],
    ['paste', () => { el.focus(); const dt=new DataTransfer(); dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return true; }],
    ['nativeSetter', () => { if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return false;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(el, text);
        el.dispatchEvent(new InputEvent('input',{bubbles:true})); return true; }],
  ];
  let used = null;
  for (const [name, run] of strategies) {
    try { if (!run()) continue; } catch { continue; }
    await new Promise(r=>setTimeout(r,500));
    const got = (el.textContent || el.value || '').trim();
    if (got.includes(text.slice(0,25)) && sendEnabled()) { used = name; break; }
  }
  if (!used) return { ok:false, why:'insert failed / send never enabled' };

  const t0 = Date.now();
  sendBtn().click();

  // Confirm the site accepted it, then measure until generation stops (§5.11).
  let sawGen = false, firstTokenAt = null, lastLen = -1, stableSince = 0;
  for (let i = 0; i < 240; i++) {
    await new Promise(r=>setTimeout(r,500));
    const gen = (p.stopButtonSelectors ?? []).some(s => { try { return !!document.querySelector(s); } catch { return false; } })
      || (p.streamingSelector ? (()=>{ try { return !!document.querySelector(p.streamingSelector); } catch { return false; } })() : false);
    if (gen) { sawGen = true; if (firstTokenAt === null) firstTokenAt = Date.now(); stableSince = 0; continue; }
    if (!sawGen) continue;
    const len = document.body.innerText.length;
    if (len !== lastLen) { lastLen = len; stableSince = Date.now(); continue; }
    if (stableSince && Date.now() - stableSince >= 1500) break;
  }
  const lastUser = (() => { for (const s of p.userMessageSelectors ?? []) {
      try { const n = document.querySelectorAll(s); if (n.length) return n[n.length-1].textContent.trim().slice(0,60); } catch {} }
    return null; })();
  return { ok:true, strategy:used, sawGenerating:sawGen,
           ttftMs: firstTokenAt ? firstTokenAt - t0 : null,
           totalMs: Date.now() - t0, lastUser };
`;

console.log(`\nBroadcasting: "${PROMPT}"\n`);
const results = [];
for (const id of ids) {
  const target = await targetForHost(HOSTS[id]);
  if (!target) { console.log(`[skip] ${id}: no open tab`); continue; }
  process.stdout.write(`  ${id.padEnd(10)} sending... `);
  try {
    const r = await evaluate(target, SEND(cfg.platforms[id], PROMPT), 180_000);
    results.push({ id, ...r });
    console.log(r.ok
      ? `OK via ${r.strategy} · answered in ${(r.totalMs/1000).toFixed(1)}s` +
        (r.ttftMs !== null ? ` (first token ${(r.ttftMs/1000).toFixed(1)}s)` : '')
      : `FAILED — ${r.why}`);
  } catch (e) {
    results.push({ id, ok:false, why:String(e.message).slice(0,90) });
    console.log('ERROR — ' + String(e.message).slice(0,90));
  }
  // §5.18: never fire two sends back to back at human-implausible speed.
  await new Promise(r=>setTimeout(r,3000));
}

console.log('\n===== BROADCAST RESULT =====');
for (const r of results) {
  console.log(`${r.id.padEnd(10)} ${r.ok ? 'DELIVERED' : 'FAILED   '}  ${r.ok ? (r.totalMs/1000).toFixed(1)+'s' : r.why}`);
  if (r.lastUser) console.log(`           echoed back: "${r.lastUser}"`);
}
console.log('');
