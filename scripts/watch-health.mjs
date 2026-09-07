/**
 * Daily selector health check, run on YOUR machine.
 *
 *   npm run health:watch          # check once, print a report, exit non-zero if broken
 *   npm run health:watch -- --quiet   # only print when something is wrong
 *
 * This is the answer to "how do we find out when a site changes?" without
 * collecting anything from users. The extension is installed in your own
 * browser anyway, so the signal is already here — it just needed to be
 * checked on a schedule rather than when a user complains.
 *
 * Exits 1 when any provider is broken, so cron/launchd can mail you the
 * output, or you can pipe it anywhere you like.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const quiet = process.argv.includes('--quiet');
const statePath = join(root, '.health-state.json');
const PORT = 9334;

/**
 * Only selectors that must match on an IDLE page.
 *
 * sendButtonSelectors is deliberately excluded: ChatGPT and Gemini do not
 * render a send button until the composer has text, so checking it on a
 * resting page reports a breakage every single day and trains you to ignore
 * the alarm. The composer is the load-bearing one — if that moves, nothing
 * works — and it IS always present.
 */
const SELECTOR_KEYS = ['composerSelectors'];

/**
 * Checked only when the page has a conversation on it, because an empty chat
 * legitimately has no user messages.
 */
const SELECTOR_KEYS_IF_CONVERSATION = ['userMessageSelectors'];
const SITES = {
  chatgpt: 'chatgpt.com',
  claude: 'claude.ai',
  perplexity: 'perplexity.ai',
  gemini: 'gemini.google.com',
  deepseek: 'chat.deepseek.com',
};

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return (await res.json()).filter((t) => t.type === 'page');
}

function evaluate(target, expression, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('timeout'));
    }, timeoutMs);
    ws.addEventListener('open', () =>
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true },
      })),
    );
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (m.error || m.result?.exceptionDetails) return reject(new Error('eval failed'));
      resolve(m.result?.result?.value);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('socket error')); });
  });
}

const cfg = JSON.parse(readFileSync(join(root, 'config/selectors.json'), 'utf8'));

let targets;
try {
  targets = await listTargets();
} catch {
  console.error(
    'No debug browser on port 9334.\n' +
      'Start it with:  npm run browser\n' +
      'then sign in to each AI once; the profile persists.',
  );
  process.exit(2);
}

const report = {};
for (const [id, host] of Object.entries(SITES)) {
  const target = targets.find((t) => t.url.includes(host));
  if (!target) {
    report[id] = { status: 'no-tab' };
    continue;
  }
  const platform = cfg.platforms[id];
  if (!platform) {
    report[id] = { status: 'no-config' };
    continue;
  }
  // Ask the page which of the configured selectors still match anything.
  const keys = [...SELECTOR_KEYS, ...SELECTOR_KEYS_IF_CONVERSATION];
  const probe = keys
    .map(
      (k) =>
        `${JSON.stringify(k)}: (${JSON.stringify(platform[k] ?? [])}).some(s => { try { return !!document.querySelector(s); } catch { return false; } })`,
    )
    .join(',');
  try {
    const raw = await evaluate(
      target,
      `return JSON.stringify({ ${probe}, __hasConversation: document.body.innerText.length > 1500 });`,
    );
    const found = JSON.parse(raw);
    const hasConversation = found.__hasConversation === true;
    const missing = Object.entries(found)
      .filter(([k]) => k !== '__hasConversation')
      .filter(([k, ok]) => {
        if (ok) return false;
        // An empty chat has no user messages; that is not a broken selector.
        return hasConversation || !SELECTOR_KEYS_IF_CONVERSATION.includes(k);
      })
      .map(([k]) => k);
    report[id] = { status: missing.length === 0 ? 'ok' : 'broken', missing };
  } catch {
    report[id] = { status: 'unreachable' };
  }
}

// Compare with last run so a NEW breakage stands out from a known one.
const prev = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const regressions = Object.entries(report).filter(
  ([id, r]) => r.status === 'broken' && prev[id]?.status !== 'broken',
);
writeFileSync(statePath, JSON.stringify(report, null, 1));

const broken = Object.entries(report).filter(([, r]) => r.status === 'broken');
if (!quiet || broken.length > 0) {
  console.log(`whileAI selector health — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  for (const [id, r] of Object.entries(report)) {
    const detail = r.missing?.length ? `  (${r.missing.join(', ')})` : '';
    console.log(`  ${id.padEnd(11)} ${r.status}${detail}`);
  }
}
if (regressions.length > 0) {
  console.log(`\nNEW breakage since the last run: ${regressions.map(([id]) => id).join(', ')}`);
  console.log('Fix config/selectors.json, push it, and every install picks it up within 6 hours.');
}
process.exit(broken.length > 0 ? 1 : 0);
