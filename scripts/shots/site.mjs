/**
 * Site images. Same pieces as the store frames, WITHOUT the marketing frame.
 *
 * The store gets 1280x800 frames that have to carry a headline, because that
 * is all a store listing shows. A web page already has headlines in HTML, so
 * reusing those frames would print every claim twice and look like a slide
 * deck pasted into a site. These are the bare product surfaces.
 */
export const SITE = [
  ['proof', 1200, 660, `
    .wrap { padding: 26px; background: #131211; height: 660px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 13px; }
    .cell { display: flex; flex-direction: column; gap: 7px; }
    .shot { position: relative; border-radius: 10px; overflow: hidden; background: #FBFAF8;
            box-shadow: 0 2px 5px rgba(0,0,0,.3), 0 18px 40px -20px rgba(0,0,0,.6); }
    .shot::after { content:""; position:absolute; left:0; right:0; bottom:0; height:44px;
            background: linear-gradient(to bottom, rgba(251,250,248,0), rgba(251,250,248,.96)); }
    .shot img { display:block; width:100%; height:240px; object-fit:cover; object-position:top left; }
    .name { font-size: 14px; color:#8A857D; display:flex; gap:7px; }
    .name b { color:#E8E3DA; font-weight:600; }
    .src { color:#F2700F; font-weight:600; }
    /* Not a screenshot, so no surface and no fade. */
    .cell.note { padding: 6px 6px 0 10px; font-size: 15.5px; line-height: 1.55; color: #8A857D; }
  `, `<div class="wrap"><div class="grid">
    <div class="cell"><div class="shot"><img src="pane-chatgpt.png"></div>
      <div class="name"><b>ChatGPT</b> <span class="src">you typed here</span></div></div>
    <div class="cell"><div class="shot"><img src="pane-claude.png"></div>
      <div class="name"><b>Claude</b> <span>received it</span></div></div>
    <div class="cell"><div class="shot"><img src="pane-perplexity.png"></div>
      <div class="name"><b>Perplexity</b> <span>received it</span></div></div>
    <div class="cell"><div class="shot"><img src="pane-gemini.png"></div>
      <div class="name"><b>Gemini</b> <span>received it</span></div></div>
    <div class="cell"><div class="shot"><img src="pane-deepseek.png"></div>
      <div class="name"><b>DeepSeek</b> <span>received it</span></div></div>
    <div class="cell note">
      <div>One prompt, typed once, in the tab you were using anyway.</div>
      <div style="margin-top:14px">The other four answered on their own, in your
      own accounts, with no API key involved.</div></div>
  </div></div>`],

  ['panel', 760, 1180, `
    .wrap { padding: 0; background: #FBFAF8; }
    img { display: block; width: 100%; }
  `, `<div class="wrap"><img src="panel.png"></div>`],

  ['dashboard', 1200, 560, `
    .wrap { padding: 24px; background: #131211; }
    .surface { border-radius: 10px; overflow: hidden; background: #FBFAF8;
               box-shadow: 0 20px 44px -22px rgba(0,0,0,.6); }
    img { display: block; width: 100%; }
  `, `<div class="wrap"><div class="surface"><img src="dash-summary.png"></div></div>`],

  ['metrics', 1200, 430, `
    .wrap { padding: 24px; background: #131211; }
    .surface { border-radius: 10px; overflow: hidden; background: #FBFAF8;
               box-shadow: 0 20px 44px -22px rgba(0,0,0,.6); }
    img { display: block; width: 100%; }
  `, `<div class="wrap"><div class="surface"><img src="dash-platforms.png"></div></div>`],

  ['attention', 1200, 470, `
    .wrap { padding: 24px; background: #131211; }
    .surface { border-radius: 10px; overflow: hidden; background: #FBFAF8;
               box-shadow: 0 20px 44px -22px rgba(0,0,0,.6); }
    img { display: block; width: 100%; }
  `, `<div class="wrap"><div class="surface"><img src="dash-attention.png"></div></div>`],
];

export const page = (css, body) => `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#131211;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  ${css}</style>${body}`;
