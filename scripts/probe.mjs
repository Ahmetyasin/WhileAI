/**
 * Selector health against the live, signed-in pages in the open session window.
 *   node scripts/probe.mjs
 *
 * Types a probe word (many providers only mount the send control once there is
 * text), records what matched, then clears the composer. Sends nothing.
 */
import { readFileSync } from 'node:fs';
import { evaluate, targetForHost } from './cdp.mjs';

const cfg = JSON.parse(readFileSync(new URL('../config/selectors.json', import.meta.url), 'utf8'));
const HOSTS = { chatgpt: 'chatgpt.com', gemini: 'gemini.google.com', deepseek: 'deepseek.com',
                claude: 'claude.ai', perplexity: 'perplexity.ai' };
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['chatgpt', 'gemini', 'deepseek'];

const results = [];
for (const id of ids) {
  const target = await targetForHost(HOSTS[id]);
  if (!target) { results.push({ id, error: 'no open tab for this provider' }); continue; }
  const p = JSON.stringify(cfg.platforms[id]);

  try {
    const r = await evaluate(target, `
      const p = ${p};
      const hit = (sels) => { for (const s of sels ?? []) { try { if (document.querySelector(s)) return s; } catch { return 'INVALID:'+s; } } return null; };
      const el  = (sels) => { for (const s of sels ?? []) { try { const e = document.querySelector(s); if (e) return e; } catch {} } return null; };
      const t = document.title.toLowerCase();
      const body = (document.body?.innerText ?? '').slice(0,500).toLowerCase();
      const res = {
        title: document.title,
        lang: document.documentElement.lang,
        wall: /just a moment|human verification|attention required|security check/.test(t)
           || /verify you are human|checking your browser/.test(body),
        composer: hit(p.composerSelectors),
        sendEmpty: hit(p.sendButtonSelectors),
        userMsg: hit(p.userMessageSelectors),
      };
      const c = el(p.composerSelectors);
      if (c) {
        c.focus();
        try { document.execCommand('insertText', false, 'probe'); } catch {}
        if (!(c.textContent || c.value || '').trim() && 'value' in c) {
          const proto = c instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(c,'probe');
          c.dispatchEvent(new InputEvent('input',{bubbles:true}));
        }
        await new Promise(r => setTimeout(r, 1300));
        res.textLanded = (c.textContent || c.value || '').trim().slice(0,20);
        res.sendTyped = hit(p.sendButtonSelectors);
        const sb = el(p.sendButtonSelectors);
        res.sendEnabled = sb ? !(sb.disabled || sb.getAttribute('aria-disabled')==='true') : false;
        // restore
        c.focus();
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);
        if ('value' in c) {
          const proto = c instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(c,'');
          c.dispatchEvent(new InputEvent('input',{bubbles:true}));
        }
      }
      return res;
    `);
    results.push({ id, ...r });
  } catch (e) {
    results.push({ id, error: String(e.message).slice(0, 120) });
  }
}

console.log('\n===== LIVE SELECTOR PROBE (signed in) =====');
for (const r of results) {
  if (r.error) { console.log(`\n[ERR ] ${r.id}: ${r.error}`); continue; }
  const ok = !r.wall && r.composer && r.sendTyped && r.sendEnabled;
  console.log(`\n[${ok ? 'PASS' : r.wall ? 'WALL' : 'FAIL'}] ${r.id}  lang=${r.lang} "${r.title.slice(0,30)}"`);
  console.log(`   composer     : ${r.composer ?? 'NO MATCH'}`);
  console.log(`   text landed  : ${JSON.stringify(r.textLanded ?? null)}`);
  console.log(`   send (empty) : ${r.sendEmpty ?? '-- absent until text'}`);
  console.log(`   send (typed) : ${r.sendTyped ?? 'NO MATCH'}  enabled=${r.sendEnabled}`);
  console.log(`   user message : ${r.userMsg ?? '-- none yet'}`);
}
console.log('');
