/**
 * Cloudflare interstitials often clear themselves after a few seconds of
 * passive JS checks. This waits — it does NOT interact with the challenge,
 * click anything, or attempt to solve it (CLAUDE.md §5.17).
 */
import { evaluate, listTargets } from './cdp.mjs';

const id = process.argv[2] ?? 'claude';
const URLS = { claude: 'https://claude.ai/new', perplexity: 'https://www.perplexity.ai/' };
const WAIT_S = Number(process.argv[3] ?? 60);

const spare = (await listTargets())[0];
await evaluate(spare, `location.href = ${JSON.stringify(URLS[id])}; return 1;`, 20_000);

for (let i = 0; i < WAIT_S / 3; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const t = (await listTargets()).find((x) => x.id === spare.id) ?? spare;
  try {
    const r = JSON.parse(await evaluate(t, `
      const title = document.title;
      const body = (document.body?.innerText ?? '').slice(0,300);
      return JSON.stringify({
        title,
        len: (document.body?.innerText ?? '').length,
        wall: /just a moment|verifying|checking/i.test(title) || /verify you are human|checking your browser/i.test(body),
        composer: !!document.querySelector('div[contenteditable="true"], #ask-input, textarea'),
      });
    `, 20_000));
    console.log(`+${(i+1)*3}s  wall=${r.wall}  composer=${r.composer}  len=${r.len}  "${r.title.slice(0,32)}"`);
    if (!r.wall && r.composer) { console.log('\nCLEARED — page is usable'); process.exit(0); }
  } catch (e) {
    console.log(`+${(i+1)*3}s  (page navigating)`);
  }
}
console.log('\nSTILL WALLED after ' + WAIT_S + 's');
