/**
 * Live selector health against the real provider sites, using the signed-in
 * .pw-profile (CLAUDE.md §13).
 *
 *   npm run health:live            # read-only: does every selector still match?
 *   npm run health:live -- --send  # also send one throwaway prompt per provider
 *
 * Read-only by default on purpose: it costs no quota, sends nothing to a real
 * account, and is the check that actually catches a site redesign.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = join(root, '.pw-profile');
const dist = join(root, 'dist');
const doSend = process.argv.includes('--send');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

const cfg = JSON.parse(readFileSync(join(root, 'config/selectors.json'), 'utf8'));

const SITES = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  perplexity: 'https://www.perplexity.ai/',
  gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com/',
};

const PROBE = `probe: reply with the single word OK`;

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  viewport: null,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

const results = [];

for (const [id, url] of Object.entries(SITES)) {
  if (only && id !== only) continue;
  const platform = cfg.platforms[id];
  if (!platform) {
    results.push({ id, error: 'no selector config' });
    continue;
  }

  const page = await ctx.newPage();
  const row = { id, url };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // SPAs need time; chat UIs mount the composer late.
    await page.waitForTimeout(8000);

    const probe = await page.evaluate((p) => {
      const first = (sels) => {
        for (const s of sels ?? []) {
          try {
            const el = document.querySelector(s);
            if (el) {
              const r = el.getBoundingClientRect();
              const vis = r.width > 0 || r.height > 0;
              return { sel: s, visible: vis };
            }
          } catch {
            return { sel: s, invalid: true };
          }
        }
        return null;
      };
      const text = document.body.innerText.slice(0, 400).toLowerCase();
      return {
        href: location.href,
        lang: document.documentElement.lang || null,
        title: document.title,
        composer: first(p.composerSelectors),
        send: first(p.sendButtonSelectors),
        stop: first(p.stopButtonSelectors),
        userMsg: first(p.userMessageSelectors),
        streaming: p.streamingSelector ? first([p.streamingSelector]) : null,
        challengeHit: first(p.challengeSelectors),
        looksLikeChallenge:
          /just a moment|verify you are human|unusual activity|checking your browser|are you a robot/.test(text) ||
          /just a moment|attention required/.test(document.title.toLowerCase()),
        looksSignedOut:
          /log in|sign in|giriş yap|create account/.test(text) &&
          !document.querySelector(p.composerSelectors?.[0] ?? '#____none'),
      };
    }, platform);

    Object.assign(row, probe);
    row.signedOut =
      probe.looksSignedOut ||
      (platform.loginUrlPatterns ?? []).some((x) => probe.href.includes(x));
    row.challenge = probe.looksLikeChallenge || probe.challengeHit !== null;
    row.healthy = !!probe.composer && !!probe.send && !row.challenge && !row.signedOut;

    if (doSend && row.healthy) {
      const sendResult = await page.evaluate(
        async ({ p, text }) => {
          const q = (sels) => {
            for (const s of sels ?? []) {
              try {
                const el = document.querySelector(s);
                if (el) return el;
              } catch { /* bad selector */ }
            }
            return null;
          };
          const el = q(p.composerSelectors);
          if (!el) return { ok: false, why: 'composer vanished' };
          const sendEnabled = () => {
            const b = q(p.sendButtonSelectors);
            if (!b) return false;
            if (b.disabled) return false;
            return b.getAttribute('aria-disabled') !== 'true';
          };
          // Same ladder the extension uses.
          const strategies = [
            () => { el.focus(); return document.execCommand('insertText', false, text); },
            () => {
              el.focus();
              const dt = new DataTransfer();
              dt.setData('text/plain', text);
              el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
              return true;
            },
            () => {
              if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return false;
              const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
              el.dispatchEvent(new InputEvent('input', { bubbles: true }));
              return true;
            },
          ];
          const names = ['execCommand', 'paste', 'nativeSetter'];
          for (let i = 0; i < strategies.length; i++) {
            try { strategies[i](); } catch { continue; }
            await new Promise((r) => setTimeout(r, 400));
            if (sendEnabled()) return { ok: true, strategy: names[i] };
          }
          return { ok: false, why: 'send never enabled' };
        },
        { p: platform, text: PROBE },
      );
      row.insert = sendResult;

      if (sendResult.ok) {
        await page.evaluate((p) => {
          const q = (sels) => { for (const s of sels ?? []) { try { const e = document.querySelector(s); if (e) return e; } catch {} } return null; };
          q(p.sendButtonSelectors)?.click();
        }, platform);
        // Watch for generation to start and then finish.
        const started = Date.now();
        let sawGen = false;
        for (let i = 0; i < 60; i++) {
          await page.waitForTimeout(1000);
          const gen = await page.evaluate((p) => {
            const q = (sels) => { for (const s of sels ?? []) { try { if (document.querySelector(s)) return true; } catch {} } return false; };
            return q(p.stopButtonSelectors) || (p.streamingSelector ? q([p.streamingSelector]) : false);
          }, platform);
          if (gen) sawGen = true;
          else if (sawGen) break;
        }
        row.send = { ...row.send, sawGenerating: sawGen, elapsedMs: Date.now() - started };
        row.userMsgAfter = await page.evaluate((p) => {
          const q = (sels) => { for (const s of sels ?? []) { try { const n = document.querySelectorAll(s); if (n.length) return n[n.length-1].textContent.trim().slice(0,60); } catch {} } return null; };
          return q(p.userMessageSelectors);
        }, platform);
      }
    }
  } catch (e) {
    row.error = String(e).split('\n')[0].slice(0, 160);
  }
  results.push(row);
  await page.close().catch(() => {});
}

writeFileSync(join(root, 'health-report.json'), JSON.stringify(results, null, 2));
console.log('\n=========== LIVE SELECTOR HEALTH ===========');
for (const r of results) {
  const mark = r.error ? 'ERR ' : r.challenge ? 'CHAL' : r.signedOut ? 'OUT ' : r.healthy ? 'OK  ' : 'FAIL';
  console.log(`\n[${mark}] ${r.id}  lang=${r.lang ?? '?'}`);
  if (r.error) { console.log(`      error: ${r.error}`); continue; }
  console.log(`      composer : ${r.composer ? r.composer.sel : 'NO MATCH'}`);
  console.log(`      send     : ${r.send ? r.send.sel : 'NO MATCH'}`);
  console.log(`      stop     : ${r.stop ? r.stop.sel : '(absent - only shows while generating)'}`);
  console.log(`      userMsg  : ${r.userMsg ? r.userMsg.sel : '(absent - empty conversation)'}`);
  if (r.challenge) console.log('      ** verification wall shown **');
  if (r.signedOut) console.log('      ** signed out **');
  if (r.insert) console.log(`      insert   : ${JSON.stringify(r.insert)}`);
  if (r.userMsgAfter) console.log(`      sent as  : "${r.userMsgAfter}"`);
}
console.log('\nreport → health-report.json\n');
await ctx.close();
