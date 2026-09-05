/**
 * Loads the REAL shipped MAIN-world bundle into a live provider tab and
 * reports the signals it emits for one send. This is the check that proves
 * done-detection works on that provider.
 *
 *   node scripts/verify-signals.mjs deepseek "prompt"
 */
import { readFileSync } from 'node:fs';
import { evaluate, targetForHost } from './cdp.mjs';

const id = process.argv[2] ?? 'deepseek';
const prompt = process.argv[3] ?? 'reply with the single word: ready';
const HOSTS = { chatgpt:'chatgpt.com', gemini:'gemini.google.com', deepseek:'deepseek.com',
                claude:'claude.ai', perplexity:'perplexity.ai' };
const cfg = JSON.parse(readFileSync(new URL('../config/selectors.json', import.meta.url), 'utf8'));
const bundle = readFileSync(new URL(`../dist/main-world-${id}.js`, import.meta.url), 'utf8');

const target = await targetForHost(HOSTS[id]);
if (!target) { console.log('no open tab for ' + id); process.exit(1); }

const expr = `
  const p = ${JSON.stringify(cfg.platforms[id])};
  const text = ${JSON.stringify(prompt)};
  window.__events = [];
  if (!window.__whileaiProbeHooked) {
    window.__whileaiProbeHooked = true;
    window.addEventListener('message', ev => {
      if (ev.source === window && ev.data && ev.data.__whileai === true) {
        window.__events.push({ type: ev.data.type, bytes: ev.data.bytes, at: Date.now() });
      }
    });
  }
  delete window.__whileaiInstalled;
  (0, eval)(${JSON.stringify(bundle)});

  const q = (sels) => { for (const s of sels ?? []) { try { const e=document.querySelector(s); if (e) return e; } catch {} } return null; };
  const el = q(p.composerSelectors);
  if (!el) return JSON.stringify({ error: 'no composer' });
  el.focus();
  try { document.execCommand('insertText', false, text); } catch {}
  if (!(el.textContent || el.value || '').trim() && 'value' in el) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el, text);
    el.dispatchEvent(new InputEvent('input',{bubbles:true}));
  }
  await new Promise(r=>setTimeout(r,900));
  window.__events.length = 0;
  const t0 = Date.now();
  q(p.sendButtonSelectors)?.click();
  for (let i=0;i<80;i++){
    await new Promise(r=>setTimeout(r,500));
    if (window.__events.some(e=>e.type==='stream:end')) break;
  }
  return JSON.stringify({ events: window.__events.map(e=>({ type:e.type, bytes:e.bytes, t:((e.at-t0)/1000).toFixed(1) })) });
`;

const raw = await evaluate(target, expr, 120_000);
const d = JSON.parse(raw);
if (d.error) { console.log('ERROR:', d.error); process.exit(1); }
console.log(`\nsignals emitted by the shipped interceptor on ${id}:`);
for (const e of d.events) {
  console.log(`  +${e.t}s  ${e.type}${e.bytes !== undefined ? '  bytes=' + e.bytes : ''}`);
}
const ok = d.events.some(e => e.type === 'stream:submit') && d.events.some(e => e.type === 'stream:end');
console.log(ok ? '\nRESULT: submit + end both seen — done-detection works\n'
              : '\nRESULT: incomplete signals — done-detection would rely on DOM only\n');
