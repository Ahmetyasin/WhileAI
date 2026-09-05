// Sample Gemini's DOM through a real generation to find a marker that is
// present ONLY while it is answering.
import { evaluate, targetForHost } from './cdp.mjs';
const t = await targetForHost('gemini.google.com');
const r = await evaluate(t, `
  const snap = () => ({
    stopIcon:    !!document.querySelector('button:has(mat-icon[fonticon="stop"])'),
    sendIcon:    !!document.querySelector('button:has(mat-icon[fonticon="arrow_upward"])'),
    respText:    document.querySelectorAll('.model-response-text').length,
    pending:     document.querySelectorAll('[class*=pending],[class*=loading],[class*=progress]').length,
    spinner:     document.querySelectorAll('mat-spinner,.mat-mdc-progress-spinner,[role=progressbar]').length,
    blinkCursor: document.querySelectorAll('[class*=cursor],[class*=blink],[class*=typing]').length,
    ariaBusy:    document.querySelectorAll('[aria-busy="true"]').length,
    len:         document.body.innerText.length,
  });
  const ed = document.querySelector('rich-textarea .ql-editor');
  ed.focus();
  document.execCommand('insertText', false, 'count from 1 to 25, one per line');
  await new Promise(r=>setTimeout(r,900));
  const idle = snap();
  document.querySelector('button:has(mat-icon[fonticon="arrow_upward"])')?.click();
  const during = [];
  for (let i=0;i<26;i++){ await new Promise(r=>setTimeout(r,600)); during.push({ t:(i*0.6).toFixed(1), ...snap() }); }
  return JSON.stringify({ idle, during });
`, 90_000);

const d = JSON.parse(r);
const keys = ['stopIcon','sendIcon','respText','pending','spinner','blinkCursor','ariaBusy'];
console.log('idle    ', keys.map(k => k+'='+d.idle[k]).join(' '));
let prev = '';
for (const s of d.during) {
  const line = keys.map(k => k+'='+s[k]).join(' ');
  if (line !== prev) { console.log('t=' + s.t + 's  ' + line + '  len=' + s.len); prev = line; }
}
