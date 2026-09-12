/**
 * The five Chrome Web Store frames, as HTML.
 *
 * Why HTML and not an image library: the store frames are mostly typography,
 * and a real browser gives real font rendering, optical letter-spacing and
 * shadows. Rendered at 2x and downsampled once, so nothing is ever enlarged.
 *
 * Copy rule for everything here: short sentences, no dashes standing in for
 * punctuation, no claim the product cannot back up.
 */
export const BRANDS = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini', 'DeepSeek'];

const shell = (css, body) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="theme.css"><style>${css}</style>${body}`;

const head = (eyebrow, title, sub) => `
<div class="eyebrow">${eyebrow}</div>
<h1>${title}</h1>
<p class="sub">${sub}</p>`;

const mark = `<div class="wordmark"><img src="icon.png" alt=""> whileAI</div>`;

/* 1. What it does, drawn rather than screenshotted so it stays crisp.
   Geometry is computed, not eyeballed: chip pitch PITCH, first centre C0, so
   the connector lines actually land on the chips. */
const CHIP_H = 52, GAP = 12, PITCH = CHIP_H + GAP;          // 64
const STAGE_H = 470;
const COL_H = BRANDS.length * CHIP_H + (BRANDS.length - 1) * GAP;   // 308
const TOP = Math.round((STAGE_H - COL_H) / 2);                      // 81
const C0 = TOP + CHIP_H / 2;                                        // 107
const MID = Math.round(STAGE_H / 2);

export const fanout = shell(`
  .flow { display: grid; grid-template-columns: 356px 176px 404px; gap: 0;
          justify-content: center; height: ${STAGE_H}px; }
  .youwrap { display: flex; align-items: center; }
  .you { background: var(--paper); color: #14130F; border-radius: 13px; padding: 22px 24px;
         width: 100%; box-shadow: 0 20px 46px -18px rgba(0,0,0,.72); }
  .you b { display: block; font-size: 20px; font-weight: 640; letter-spacing: -.015em; }
  .you span { display: block; margin-top: 6px; font-size: 15px; color: #6E6A63; }
  .rails { position: relative; }
  .rails svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .targets { display: flex; flex-direction: column; gap: ${GAP}px; padding-top: ${TOP}px; }
  .t { height: ${CHIP_H}px; background: rgba(255,255,255,.05);
       border: 1px solid rgba(255,255,255,.11); border-radius: 11px; padding: 0 18px;
       font-size: 18px; letter-spacing: -.012em;
       display: flex; justify-content: space-between; align-items: center; }
  .t i { font-style: normal; font-size: 13px; color: #7BD69A; letter-spacing: .01em; }
  .foot { position: absolute; left: 64px; bottom: 26px; font-size: 15px; color: #85807A; }
`, `<div class="frame">
  ${head('One prompt', 'Type it once.<br>Every AI answers.', 'It runs in the tabs you are already signed in to. No API keys, no accounts, nothing leaves your browser.')}
  <div class="stagearea"><div class="flow">
    <div class="youwrap"><div class="you"><b>You type here</b><span>in any one of the five</span></div></div>
    <div class="rails"><svg viewBox="0 0 176 ${STAGE_H}" fill="none" preserveAspectRatio="none">
      ${BRANDS.map((_, i) => {
        const y = C0 + i * PITCH;
        return `<path d="M0 ${MID} H88 V${y} H168" stroke="#4C4841" stroke-width="1.6"/>`;
      }).join('')}
      ${BRANDS.map((_, i) => `<circle cx="170" cy="${C0 + i * PITCH}" r="3.6" fill="#F2700F"/>`).join('')}
    </svg></div>
    <div class="targets">${BRANDS.map((b) => `<div class="t">${b} <i>ready</i></div>`).join('')}</div>
  </div></div>
  <div class="foot">Free. Every feature, no limits.</div>
  ${mark}
</div>`);

/* 2. Proof. Five real panes from one recorded run.
   Layout note: ChatGPT answered in one word, so its pane is short and wide
   while Perplexity's is tall. A uniform grid either crops them or leaves one
   floating in space, so the row heights differ deliberately: the two short
   panes share the top row with the source, and the two tall ones sit below.
   Every pane is shown WHOLE. */
export const proof = shell(`
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 14px; row-gap: 15px; }
  .cell { display: flex; flex-direction: column; gap: 8px; }
  .shot { border-radius: 10px; background: var(--paper); display: flex;
          align-items: center; justify-content: center; padding: 12px;
          box-shadow: 0 2px 5px rgba(0,0,0,.3), 0 18px 40px -20px rgba(0,0,0,.6);
          outline: 1px solid rgba(255,255,255,.07); outline-offset: -1px; }
  .shot img { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; }
  .r1 .shot { height: 150px; }
  .r2 .shot { height: 244px; }
  .name { font-size: 13.5px; letter-spacing: .01em; color: #8A857D; display: flex; gap: 7px; align-items: center; }
  .name b { color: #E8E3DA; font-weight: 600; }
  .src { color: var(--accent); font-weight: 600; }
`, `<div class="frame">
  ${head('Not a mock-up', 'One prompt, typed once,<br>answered five times.', 'A real run, recorded. The prompt was typed only in ChatGPT. The other four received it on their own.')}
  <div class="stagearea"><div class="grid">
    <div class="cell r1"><div class="shot"><img src="pane-chatgpt.png" alt=""></div>
      <div class="name"><b>ChatGPT</b> <span class="src">you typed here</span></div></div>
    <div class="cell r1"><div class="shot"><img src="pane-deepseek.png" alt=""></div>
      <div class="name"><b>DeepSeek</b> <span>received it</span></div></div>
    <div class="cell r1"><div class="shot"><img src="pane-claude.png" alt=""></div>
      <div class="name"><b>Claude</b> <span>received it</span></div></div>
    <div class="cell r2"><div class="shot"><img src="pane-gemini.png" alt=""></div>
      <div class="name"><b>Gemini</b> <span>received it</span></div></div>
    <div class="cell r2"><div class="shot"><img src="pane-perplexity.png" alt=""></div>
      <div class="name"><b>Perplexity</b> <span>received it</span></div></div>
    <div class="cell r2" style="justify-content:center">
      <div style="font-size:17px;line-height:1.5;color:#B8B2A9">Five answers to
      compare, and you typed the question once.</div>
      <div style="font-size:15.5px;line-height:1.5;color:#7C776F;margin-top:12px">Each
      one was timed while it arrived. The dashboard adds them up by day and by AI.</div></div>
  </div></div>
  ${mark}
</div>`);

/* 3. Control: the panel, with what each part means.
   The panel is tall and narrow. Hanging it off the right edge left the frame
   lopsided, so it sits in a balanced two-column split with both columns
   vertically centred on the same axis. */
export const panel = shell(`
  .split { display: grid; grid-template-columns: 1fr 316px; gap: 64px;
           align-items: center; height: 470px; justify-content: center; }
  .points { }
  .p { display: flex; gap: 15px; padding: 16px 0; border-top: 1px solid #262421; }
  .p:first-child { border-top: 0; padding-top: 0; }
  .p b { color: var(--accent); font-size: 14px; font-weight: 700; min-width: 18px; }
  .p div { font-size: 17.5px; line-height: 1.4; color: #D5CFC6; }
  .p div span { color: #8A857D; display: block; margin-top: 4px; font-size: 15.5px; line-height: 1.45; }
  .panelshot { border-radius: 13px; overflow: hidden; background: var(--paper);
    box-shadow: 0 3px 8px rgba(0,0,0,.34), 0 28px 64px -20px rgba(0,0,0,.66);
    outline: 1px solid rgba(255,255,255,.08); outline-offset: -1px; }
  .panelshot img { display: block; width: 100%; height: auto; }
`, `<div class="frame">
  ${head('Your call', 'Choose which AIs<br>get the prompt.', 'One switch per AI. Only the ones you turn on receive anything.')}
  <div class="stagearea"><div class="split">
    <div class="points">
      <div class="p"><b>01</b><div>Turn an AI off and it is left alone<span>No prompt reaches it until you switch it back on.</span></div></div>
      <div class="p"><b>02</b><div>"ready" means that tab is signed in<span>If a site signs you out, the panel says so instead of failing quietly.</span></div></div>
      <div class="p"><b>03</b><div>Your waiting time, always visible<span>The full dashboard is one click away.</span></div></div>
    </div>
    <div class="panelshot"><img src="panel.png" alt=""></div>
  </div></div>
  ${mark}
</div>`);

/* 4. The measurement nobody else offers. */
export const dashboard = shell(`
  .surface { margin: 0 auto; width: 1010px; }
`, `<div class="frame">
  ${head('Measured, not guessed', 'See what the waiting<br>actually costs you.', 'Every answer is timed. The dashboard adds it up by day and by AI, and it exports.')}
  <div class="stagearea"><div class="surface"><img src="dash-summary.png" alt=""></div></div>
  ${mark}
</div>`);

/* 5. Per-AI numbers. */
export const metrics = shell(`
  .stack { display: flex; flex-direction: column; gap: 12px; align-items: center; }
  /* Both sections must finish above the wordmark, so the lower one is clipped
     to its useful rows rather than being allowed to run off the frame. */
  .surface { width: 1000px; }
  .surface.clip { max-height: 196px; overflow: hidden; position: relative; }
  .surface.clip::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0;
     height: 40px; background: linear-gradient(to bottom, rgba(251,250,248,0), rgba(251,250,248,.97)); }
`, `<div class="frame">
  ${head('Per AI', 'Which one is slower,<br>and by how much.', 'Averages per AI, and how often you tab away mid-answer.')}
  <div class="stagearea"><div class="stack">
    <div class="surface"><img src="dash-platforms.png" alt=""></div>
    <div class="surface clip"><img src="dash-attention.png" alt=""></div>
  </div></div>
  ${mark}
</div>`);

export const FRAMES = [
  ['screenshot-1-fanout.html', fanout],
  ['screenshot-2-proof.html', proof],
  ['screenshot-3-panel.html', panel],
  ['screenshot-4-dashboard.html', dashboard],
  ['screenshot-5-metrics.html', metrics],
];
