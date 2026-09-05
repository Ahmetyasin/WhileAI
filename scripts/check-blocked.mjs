/**
 * Are Claude / Perplexity reachable in this session, or still behind a
 * verification wall? Read-only: navigates an existing spare tab and reports.
 * Never attempts to solve or evade a challenge (CLAUDE.md §5.17).
 */
import { evaluate, listTargets } from './cdp.mjs';

const TESTS = [
  { id: 'claude', url: 'https://claude.ai/new' },
  { id: 'perplexity', url: 'https://www.perplexity.ai/' },
];

const targets = await listTargets();
const spare = targets[0];
if (!spare) { console.log('no tab available'); process.exit(1); }

for (const t of TESTS) {
  await evaluate(spare, `location.href = ${JSON.stringify(t.url)}; return 1;`, 20_000);
  await new Promise((r) => setTimeout(r, 9000));
  const fresh = (await listTargets()).find((x) => x.id === spare.id) ?? spare;
  try {
    const r = JSON.parse(await evaluate(fresh, `
      const t = document.title.toLowerCase();
      const body = (document.body?.innerText ?? '').slice(0,400).toLowerCase();
      return JSON.stringify({
        title: document.title,
        wall: /just a moment|human verification|attention required|security check|verify/.test(t)
           || /verify you are human|checking your browser|enable javascript and cookies/.test(body),
        signedIn: !!document.querySelector('div[contenteditable="true"], #ask-input, textarea'),
      });
    `, 30_000));
    console.log(`${t.id.padEnd(11)} ${r.wall ? 'VERIFICATION WALL' : r.signedIn ? 'reachable, composer present' : 'reachable, no composer'}  "${r.title.slice(0,40)}"`);
  } catch (e) {
    console.log(`${t.id.padEnd(11)} could not read: ${String(e.message).slice(0,60)}`);
  }
}
