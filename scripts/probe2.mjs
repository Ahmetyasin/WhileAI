/**
 * Selector probe against the NORMAL (non-automated) Chrome on port 9334.
 * Same checks as probe.mjs; separate entry point because that browser is the
 * only place Cloudflare-protected providers are reachable.
 */
import { readFileSync } from 'node:fs';
import { evaluate, listTargets } from './cdp2.mjs';

const PORT = 9334;
const cfg = JSON.parse(readFileSync(new URL('../config/selectors.json', import.meta.url), 'utf8'));
const HOSTS = { chatgpt:'chatgpt.com', gemini:'gemini.google.com', deepseek:'deepseek.com',
                claude:'claude.ai', perplexity:'perplexity.ai' };
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['claude', 'perplexity'];

const targets = await listTargets(PORT);
for (const id of ids) {
  const t = targets.find((x) => { try { return new URL(x.url).hostname.includes(HOSTS[id]); } catch { return false; } });
  if (!t) { console.log(`\n[none] ${id}: no open tab`); continue; }

  const r = JSON.parse(await evaluate(t, `
    const p = ${JSON.stringify(cfg.platforms[id])};
    const hit = (s) => { for (const x of s ?? []) { try { if (document.querySelector(x)) return x; } catch { return 'INVALID:'+x; } } return null; };
    const el  = (s) => { for (const x of s ?? []) { try { const e=document.querySelector(x); if (e) return e; } catch {} } return null; };
    const title = document.title.toLowerCase();
    const body = (document.body?.innerText ?? '').slice(0,400).toLowerCase();
    const res = {
      title: document.title, url: location.href.slice(0,60),
      webdriver: navigator.webdriver,
      wall: /just a moment|human verification|attention required/.test(title) || /verify you are human|checking your browser/.test(body),
      signedOut: /sign in|log in|continue with google/.test(body),
      composer: hit(p.composerSelectors), send: hit(p.sendButtonSelectors), userMsg: hit(p.userMessageSelectors),
    };
    const c = el(p.composerSelectors);
    if (c) {
      c.focus();
      try { document.execCommand('insertText', false, 'probe'); } catch {}
      if (!(c.textContent || c.value || '').trim() && 'value' in c) {
        const proto = c instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(c,'probe');
        c.dispatchEvent(new InputEvent('input',{bubbles:true}));
      }
      await new Promise(r=>setTimeout(r,1300));
      res.textLanded = (c.textContent || c.value || '').trim().slice(0,20);
      res.sendTyped = hit(p.sendButtonSelectors);
      const sb = el(p.sendButtonSelectors);
      res.sendEnabled = sb ? !(sb.disabled || sb.getAttribute('aria-disabled')==='true') : false;
      c.focus(); document.execCommand('selectAll', false); document.execCommand('delete', false);
      if ('value' in c) {
        const proto = c instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(c,'');
        c.dispatchEvent(new InputEvent('input',{bubbles:true}));
      }
    }
    return JSON.stringify(res);
  `, 60_000));

  const ok = !r.wall && !r.signedOut && r.composer && r.sendTyped && r.sendEnabled;
  console.log(`\n[${ok ? 'PASS' : r.wall ? 'WALL' : r.signedOut ? 'OUT ' : 'FAIL'}] ${id}  webdriver=${r.webdriver}`);
  console.log(`   page         : ${r.title.slice(0,40)} | ${r.url}`);
  console.log(`   composer     : ${r.composer ?? 'NO MATCH'}`);
  console.log(`   text landed  : ${JSON.stringify(r.textLanded ?? null)}`);
  console.log(`   send (typed) : ${r.sendTyped ?? 'NO MATCH'}  enabled=${r.sendEnabled}`);
  console.log(`   user message : ${r.userMsg ?? '-- none yet'}`);
}
console.log('');
