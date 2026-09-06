/**
 * Live provider test against a browser YOU launched yourself.
 *
 *   node scripts/live.mjs check                     # preflight, sends nothing
 *   node scripts/live.mjs send claude perplexity    # deliver one prompt
 *   node scripts/live.mjs send --prompt "..." claude
 *   node scripts/live.mjs check --port 9334
 *
 * Why a browser you launched: Chrome started under automation sets
 * navigator.webdriver = true, and Cloudflare walls Claude/Perplexity on that
 * flag alone (HANDOFF §3). Your own Chrome does not set it, so the wall never
 * appears. We do NOT spoof the flag — CLAUDE.md §5.18 forbids it. We just use
 * a browser where it is honestly false.
 *
 * Everything is logged to logs/ (see scripts/loglib.mjs).
 */
import { readFileSync } from 'node:fs';
import { evaluate, listTargets } from './cdp2.mjs';
import { SessionLog, promptField } from './loglib.mjs';

const argv = process.argv.slice(2);
const MODE = argv[0] === 'send' ? 'send' : argv[0] === 'dryrun' ? 'dryrun' : 'check';
const portFlag = argv.indexOf('--port');
const PORT = portFlag !== -1 ? Number(argv[portFlag + 1]) : 9334;
const promptFlag = argv.indexOf('--prompt');
const PROMPT = promptFlag !== -1 ? argv[promptFlag + 1] : 'In one short sentence: why is the sky blue?';

const HOSTS = { chatgpt: 'chatgpt.com', gemini: 'gemini.google.com', deepseek: 'deepseek.com',
                claude: 'claude.ai', perplexity: 'perplexity.ai' };
const KNOWN = Object.keys(HOSTS);
const ids = argv.slice(1).filter((a) => KNOWN.includes(a));
const TARGETS = ids.length ? ids : ['claude', 'perplexity'];

const cfg = JSON.parse(readFileSync(new URL('../config/selectors.json', import.meta.url), 'utf8'));
const log = new SessionLog(MODE === 'send' ? 'broadcast' : 'probe');

/** Read-only page inspection: does the config actually match this DOM? */
const INSPECT = (p) => `
  const p = ${JSON.stringify(p)};
  const hit = (sels) => { for (const s of sels ?? []) { try { if (document.querySelector(s)) return s; } catch { return 'INVALID:'+s; } } return null; };
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return false; const st = getComputedStyle(e);
    return st.visibility !== 'hidden' && st.display !== 'none'; };
  const title = document.title.toLowerCase();
  const body = (document.body?.innerText ?? '').slice(0, 500).toLowerCase();
  // Count rival editable regions: the exact bug that made Claude type into
  // an artifact surface instead of the composer.
  const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'))
    .filter(vis)
    .map((e) => ({ tag: e.tagName.toLowerCase(), id: e.id || null,
                   cls: (e.className || '').toString().slice(0, 60) }));
  return JSON.stringify({
    url: location.href.slice(0, 80), title: document.title.slice(0, 60),
    webdriver: navigator.webdriver === true,
    wall: /just a moment|human verification|attention required|verify you are human/.test(title)
       || /verify you are human|checking your browser|enable javascript and cookies/.test(body),
    signedOut: /sign in|log in|continue with google|create account/.test(body) && body.length < 1200,
    // A usage wall leaves the composer in place, so "ready" is not enough.
    quotaWall: (() => { const d = document.querySelector('[role="dialog"]');
      if (!d) return false; const t = (d.innerText || '').toLowerCase();
      return /free search limit|reached your free|upgrade to continue|message limit|daily limit/.test(t); })(),
    composer: hit(p.composerSelectors), send: hit(p.sendButtonSelectors),
    stop: hit(p.stopButtonSelectors), userMsg: hit(p.userMessageSelectors),
    editableCount: editables.length, editables: editables.slice(0, 6),
  });
`;

/**
 * Everything a real send does EXCEPT clicking. Proves the insertion ladder
 * works and the site enables its send button, then clears the composer.
 * Costs no quota, so it can be run as often as you like.
 */
const DRYRUN = (p, text) => `
  const p = ${JSON.stringify(p)};
  const text = ${JSON.stringify(text)};
  const vis = (e) => { const r = e.getBoundingClientRect(); if (!r.width && !r.height) return false;
    const st = getComputedStyle(e); return st.visibility !== 'hidden' && st.display !== 'none'; };
  const q = (sels) => { for (const s of sels ?? []) { try {
      for (const e of document.querySelectorAll(s)) if (vis(e)) return e; } catch {} } return null; };
  const which = (sels) => { for (const s of sels ?? []) { try {
      for (const e of document.querySelectorAll(s)) if (vis(e)) return s; } catch {} } return null; };
  const sendBtn = () => q(p.sendButtonSelectors);
  const sendEnabled = () => { const b = sendBtn(); if (!b) return false;
    return !b.disabled && b.getAttribute('aria-disabled') !== 'true'; };
  const el = q(p.composerSelectors);
  if (!el) return JSON.stringify({ ok:false, why:'NO_COMPOSER' });

  const clearIt = () => {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el, '');
      el.dispatchEvent(new InputEvent('input',{bubbles:true})); return;
    }
    el.focus(); const sel = window.getSelection(); const rg = document.createRange();
    rg.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(rg);
    document.execCommand('delete');
    // Lexical (Perplexity) ignores execCommand on a programmatic range but
    // does honour a beforeinput deleteContentBackward. Verified live
    // 2026-09-06: without this the composer accumulates every insert.
    if ((el.textContent || el.value || '').trim().length > 0) {
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'deleteContentBackward', bubbles: true, cancelable: true, composed: true }));
    }
  };

  // Clearing AFTER a successful insert is harder than clearing before it:
  // Lexical (Perplexity) can leave the text behind. Retry with the editor
  // focused and verify, so a dry run never leaves residue that would
  // contaminate the user's next real prompt.
  const clearHard = async () => {
    for (let i = 0; i < 2; i++) {
      el.focus(); clearIt();
      await new Promise(r => setTimeout(r, 100));
      if ((el.textContent || el.value || '').trim().length === 0) return true;
      // Lexical only honours beforeinput; execCommand on a programmatic
      // range is silently ignored (verified live on Perplexity 2026-09-06).
      el.focus();
      const s2 = window.getSelection(); const r2 = document.createRange();
      r2.selectNodeContents(el); s2.removeAllRanges(); s2.addRange(r2);
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'deleteContentBackward', bubbles: true, cancelable: true, composed: true }));
      await new Promise(r => setTimeout(r, 150));
      if ((el.textContent || el.value || '').trim().length === 0) return true;
    }
    return false;
  };

  const ladder = [
    ['execCommand', () => { el.focus(); clearIt(); return document.execCommand('insertText', false, text); }],
    ['paste', () => { el.focus(); clearIt(); const dt = new DataTransfer(); dt.setData('text/plain', text);
       el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return true; }],
    ['nativeSetter', () => { if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return false;
       const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
       Object.getOwnPropertyDescriptor(proto,'value').set.call(el, text);
       el.dispatchEvent(new InputEvent('input',{bubbles:true})); return true; }],
  ];
  const tried = []; let used = null; let observed = '';
  for (const [name, run] of ladder) {
    try { if (!run()) { tried.push(name+':noop'); continue; } } catch { tried.push(name+':threw'); continue; }
    await new Promise(r => setTimeout(r, 600));
    const got = (el.textContent || el.value || '').trim();
    const landed = got.includes(text.slice(0, 25)) && got.length <= text.length + 10;
    const enabled = sendEnabled();
    tried.push(name + ':' + (landed ? 'landed' : 'notext') + '/' + (enabled ? 'enabled' : 'disabled'));
    if (landed && enabled) { used = name; observed = got.slice(0, 40); break; }
  }
  // ALWAYS leave the page as we found it. Nothing was sent.
  await clearHard();
  const residue = (el.textContent || el.value || '').trim();
  return JSON.stringify({ ok: used !== null, strategy: used, tried, observed,
    composerSel: which(p.composerSelectors), sendSel: which(p.sendButtonSelectors),
    cleared: residue.length === 0, residue: residue.slice(0, 30) });
`;

/** Insertion ladder + submit + wait, mirroring the shipped adapter. */
const SEND = (p, text) => `
  const p = ${JSON.stringify(p)};
  const text = ${JSON.stringify(text)};
  const vis = (e) => { const r = e.getBoundingClientRect(); if (!r.width && !r.height) return false;
    const st = getComputedStyle(e); return st.visibility !== 'hidden' && st.display !== 'none'; };
  const q = (sels) => { for (const s of sels ?? []) { try {
      for (const e of document.querySelectorAll(s)) if (vis(e)) return e; } catch {} } return null; };
  const which = (sels) => { for (const s of sels ?? []) { try {
      for (const e of document.querySelectorAll(s)) if (vis(e)) return s; } catch {} } return null; };
  const sendBtn = () => q(p.sendButtonSelectors);
  const sendEnabled = () => { const b = sendBtn(); if (!b) return false;
    return !b.disabled && b.getAttribute('aria-disabled') !== 'true'; };
  const el = q(p.composerSelectors);
  if (!el) return JSON.stringify({ ok:false, why:'NO_COMPOSER' });
  const composerSel = which(p.composerSelectors);

  // Clear before EVERY attempt, exactly as src/adapters/insertText.ts does.
  // Without this a failed first strategy leaves its text behind and the next
  // one appends, so the provider receives the prompt twice. That is a harness
  // bug the shipped adapter does not have — keep the two in step.
  const clearExisting = () => {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el, '');
      el.dispatchEvent(new InputEvent('input',{bubbles:true}));
      return;
    }
    el.focus();
    const sel = window.getSelection(); const range = document.createRange();
    range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('delete');
  };

  const ladder = [
    ['execCommand', () => { el.focus(); clearExisting(); return document.execCommand('insertText', false, text); }],
    ['paste', () => { el.focus(); clearExisting(); const dt = new DataTransfer(); dt.setData('text/plain', text);
       el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return true; }],
    ['nativeSetter', () => { if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return false;
       const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
       Object.getOwnPropertyDescriptor(proto,'value').set.call(el, text);
       el.dispatchEvent(new InputEvent('input',{bubbles:true})); return true; }],
  ];
  const tried = [];
  let used = null;
  for (const [name, run] of ladder) {
    try { if (!run()) { tried.push(name+':noop'); continue; } } catch (e) { tried.push(name+':threw'); continue; }
    await new Promise(r => setTimeout(r, 500));
    const got = (el.textContent || el.value || '').trim();
    // Not just "contains": leftover text ahead of the prompt means the
    // composer would send something other than what was asked for.
    const landed = got.includes(text.slice(0, 25)) && got.length <= text.length + 10;
    const enabled = sendEnabled();
    tried.push(name + ':' + (landed ? 'landed' : 'notext') + '/' + (enabled ? 'enabled' : 'disabled'));
    if (landed && enabled) { used = name; break; }
  }
  if (!used) return JSON.stringify({ ok:false, why:'INSERT_FAILED', tried, composerSel });

  const t0 = Date.now();
  sendBtn().click();
  // Two independent completion signals (§5.11). The stop button alone is NOT
  // enough: Perplexity answers fast enough that it can flash by between polls,
  // and a loop that waits for a signal it already missed hangs until timeout.
  // Growing page text is the second, slower-moving witness.
  const baselineLen = document.body.innerText.length;
  let sawGen = false, sawGrowth = false, firstTokenAt = null, lastLen = -1, stableSince = 0;
  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 250));
    const gen = (p.stopButtonSelectors ?? []).some(s => { try { return !!document.querySelector(s); } catch { return false; } })
      || (p.streamingSelector ? (() => { try { return !!document.querySelector(p.streamingSelector); } catch { return false; } })() : false);
    const len = document.body.innerText.length;
    if (!sawGrowth && len > baselineLen + 40) { sawGrowth = true; }
    if (gen) { sawGen = true; if (firstTokenAt === null) firstTokenAt = Date.now(); stableSince = 0; lastLen = len; continue; }
    // Fall through on EITHER witness, so a missed stop button cannot hang us.
    if (!sawGen && !sawGrowth) continue;
    if (firstTokenAt === null) firstTokenAt = Date.now();
    if (len !== lastLen) { lastLen = len; stableSince = Date.now(); continue; }
    if (stableSince && Date.now() - stableSince >= 1500) break;
  }
  const lastUser = (() => { for (const s of p.userMessageSelectors ?? []) { try {
      const n = document.querySelectorAll(s); if (n.length) return n[n.length-1].textContent.trim().slice(0,80);
    } catch {} } return null; })();
  return JSON.stringify({ ok:true, strategy:used, tried, composerSel, sawGenerating:sawGen, sawGrowth,
    ttftMs: firstTokenAt ? firstTokenAt - t0 : null, totalMs: Date.now() - t0, lastUser });
`;

// ---- connect -------------------------------------------------------------
let targets;
try {
  targets = await listTargets(PORT);
} catch (e) {
  log.fail(`No browser answering on port ${PORT}.`, 'connect_failed', { port: PORT, error: e.message });
  console.log(`
  Start your own Chrome with debugging enabled, then re-run:

    /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\
      --remote-debugging-port=${PORT} --user-data-dir="$HOME/.whileai-chrome"

  Sign in to the providers in that window first.
`);
  log.finish({ connected: false });
  process.exit(1);
}
log.ok(`Connected on port ${PORT} — ${targets.length} open tab(s).`, 'connected',
  { port: PORT, tabs: targets.length });

const results = [];
for (const id of TARGETS) {
  const host = HOSTS[id];
  const t = targets.find((x) => { try { return new URL(x.url).hostname.includes(host); } catch { return false; } });
  console.log(`\n— ${id} —`);
  if (!t) {
    log.warn(`no open tab on ${host}; open one and re-run`, 'tab_missing', { provider: id, host });
    results.push({ id, verdict: 'NO TAB' });
    continue;
  }

  let info;
  try {
    info = JSON.parse(await evaluate(t, INSPECT(cfg.platforms[id]), 30_000));
  } catch (e) {
    log.fail(`could not inspect the page: ${e.message}`, 'inspect_failed', { provider: id, error: e.message });
    results.push({ id, verdict: 'ERROR' });
    continue;
  }
  log.write('inspected', { provider: id, ...info });
  log.info(`page: ${info.title} · webdriver=${info.webdriver}`, 'page', { provider: id });

  if (info.wall) {
    log.fail('verification wall on screen — not sending. Solve it in the browser, then re-run.',
      'wall', { provider: id, webdriver: info.webdriver });
    if (info.webdriver) {
      log.warn('navigator.webdriver is TRUE: this browser was launched under automation, which is what triggers the wall. Launch Chrome yourself instead.', 'wall_cause', { provider: id });
    }
    results.push({ id, verdict: 'WALL' });
    continue;
  }
  if (info.quotaWall) {
    log.fail('usage limit reached on this account — not sending. Wait for the reset or upgrade.',
      'quota_wall', { provider: id });
    results.push({ id, verdict: 'QUOTA' });
    continue;
  }
  if (info.signedOut) {
    log.warn('signed out — sign in in the browser, then re-run.', 'signed_out', { provider: id });
    results.push({ id, verdict: 'SIGNED OUT' });
    continue;
  }

  log.info(`composer selector : ${info.composer ?? 'NO MATCH'}`, 'selector', { provider: id, kind: 'composer', match: info.composer });
  log.info(`send selector     : ${info.send ?? 'NO MATCH'}`, 'selector', { provider: id, kind: 'send', match: info.send });
  if (info.editableCount > 1) {
    log.warn(`${info.editableCount} visible contenteditable regions on this page — composer anchoring matters here`,
      'rival_editables', { provider: id, editables: info.editables });
  }
  if (!info.composer) {
    log.fail('composer selector does not match this page — config needs updating.',
      'selector_miss', { provider: id, composer: null });
    results.push({ id, verdict: 'SELECTOR FAIL' });
    continue;
  }
  if (!info.send) {
    // Gemini and Perplexity render the send control only once the composer
    // holds text, so its absence on an empty page is EXPECTED, not a failure.
    // Only a dry run (which types first) can judge it.
    log.info('send button absent on an empty composer — normal for this provider; run live:dryrun to confirm',
      'send_deferred', { provider: id });
  }
  log.ok('selectors match and the page is usable', 'preflight_pass', { provider: id });

  if (MODE === 'dryrun') {
    log.step('dry run: inserting without sending (no quota spent)', 'dryrun_start', { provider: id });
    let d;
    try {
      d = JSON.parse(await evaluate(t, DRYRUN(cfg.platforms[id], PROMPT), 60_000));
    } catch (e) {
      log.fail(`dry run threw: ${e.message}`, 'dryrun_error', { provider: id, error: e.message });
      results.push({ id, verdict: 'ERROR' });
      continue;
    }
    log.write('dryrun_result', { provider: id, ...d });
    if (!d.ok) {
      log.fail(`insertion would FAIL — ${d.why ?? 'send never enabled'} [${(d.tried ?? []).join(', ')}]`,
        'dryrun_failed', { provider: id });
      results.push({ id, verdict: 'INSERT FAIL' });
      continue;
    }
    log.ok(`would send via ${d.strategy} (send button enabled)`, 'dryrun_pass', { provider: id });
    if (!d.cleared) {
      log.warn(`composer not fully cleared, residue: ${JSON.stringify(d.residue)}`,
        'dryrun_residue', { provider: id });
    }
    results.push({ id, verdict: 'WOULD SEND' });
    continue;
  }
  if (MODE !== 'send') { results.push({ id, verdict: 'READY' }); continue; }

  log.step(`sending prompt (this costs real quota)`, 'send_start',
    { provider: id, ...promptField(PROMPT) });
  let r;
  try {
    r = JSON.parse(await evaluate(t, SEND(cfg.platforms[id], PROMPT), 180_000));
  } catch (e) {
    log.fail(`send threw: ${e.message}`, 'send_error', { provider: id, error: e.message });
    results.push({ id, verdict: 'ERROR' });
    continue;
  }
  log.write('send_result', { provider: id, ...r });
  if (!r.ok) {
    log.fail(`delivery failed — ${r.why}`, 'send_failed', { provider: id, why: r.why, tried: r.tried });
    results.push({ id, verdict: 'FAILED', why: r.why });
    continue;
  }
  log.ok(`delivered via ${r.strategy} · answered in ${(r.totalMs / 1000).toFixed(1)}s` +
    (r.ttftMs !== null ? ` (first token ${(r.ttftMs / 1000).toFixed(1)}s)` : ''),
    'delivered', { provider: id });
  if (r.lastUser) log.info(`page echoed back: "${r.lastUser}"`, 'echo', { provider: id });
  results.push({ id, verdict: 'DELIVERED', totalMs: r.totalMs });

  // §5.18: human pacing between providers, never two sends back to back.
  await new Promise((res) => setTimeout(res, 3000));
}

console.log('\n===== RESULT =====');
for (const r of results) {
  console.log(`  ${r.id.padEnd(11)} ${r.verdict}${r.totalMs ? '  ' + (r.totalMs / 1000).toFixed(1) + 's' : ''}${r.why ? '  ' + r.why : ''}`);
}
log.finish({ mode: MODE, results });
