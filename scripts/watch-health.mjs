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
 * legitimately has neither user messages nor answers.
 */
const SELECTOR_KEYS_IF_CONVERSATION = ['userMessageSelectors', 'answerSelectors'];
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
  // Ask the page WHICH configured selector still matches — not merely whether
  // one of them does. A list whose first entry is dead but whose fallback
  // still works reports "ok" under a some() check, and you find out only when
  // the fallback dies too. Live 2026-09-12: DeepSeek's composer had lost
  // `textarea#chat-input` and its user-message rule had lost the key that made
  // it safe, while this script said ok for both.
  const keys = [...SELECTOR_KEYS, ...SELECTOR_KEYS_IF_CONVERSATION];
  const probe = keys
    .map(
      (k) =>
        `${JSON.stringify(k)}: (${JSON.stringify(platform[k] ?? [])}).findIndex(s => { try { return !!document.querySelector(s); } catch { return false; } })`,
    )
    .join(',');
  try {
    const raw = await evaluate(
      target,
      `return JSON.stringify({ ${probe}, __hasConversation: document.body.innerText.length > 1500 });`,
    );
    const found = JSON.parse(raw);
    const hasConversation = found.__hasConversation === true;
    // Only judge a list when this page can legitimately contain it.
    const applicable = Object.entries(found).filter(
      ([k]) =>
        k !== '__hasConversation' &&
        (hasConversation || !SELECTOR_KEYS_IF_CONVERSATION.includes(k)) &&
        (platform[k] ?? []).length > 0,
    );
    const missing = applicable.filter(([, idx]) => idx < 0).map(([k]) => k);
    // idx > 0: the primary is gone and a fallback is carrying the feature.
    const degraded = applicable
      .filter(([, idx]) => idx > 0)
      .map(([k, idx]) => `${k}→${platform[k][idx]}`);
    report[id] = {
      status: missing.length > 0 ? 'broken' : degraded.length > 0 ? 'degraded' : 'ok',
      missing,
      degraded,
    };
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
const degradedAny = Object.entries(report).filter(([, r]) => r.status === 'degraded');
if (!quiet || broken.length > 0 || degradedAny.length > 0) {
  console.log(`whileAI selector health — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  for (const [id, r] of Object.entries(report)) {
    const detail = r.missing?.length
      ? `  (missing: ${r.missing.join(', ')})`
      : r.degraded?.length
        ? `  (primary gone, running on: ${r.degraded.join(', ')})`
        : '';
    console.log(`  ${id.padEnd(11)} ${r.status}${detail}`);
  }
}
if (degradedAny.length > 0) {
  console.log(
    '\nA fallback is carrying the feature. Fix the primary BEFORE it is the only one left.',
  );
}
if (regressions.length > 0) {
  console.log(`\nNEW breakage since the last run: ${regressions.map(([id]) => id).join(', ')}`);
  console.log('Fix config/selectors.json, push it, and every install picks it up within 6 hours.');
}
process.exit(broken.length > 0 ? 1 : 0);
