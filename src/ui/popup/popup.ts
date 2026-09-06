/**
 * The popup is the product's front door (§3): two switches — the response
 * tracker, and broadcasting to the AIs you pick — with everything detailed
 * behind "Detailed settings". It reads only precomputed daily summaries so it
 * opens instantly (§5.1).
 */
import { dayKey, formatDuration } from '../../core/metrics';
import { getDailySummaries, getOpenTurns, getSettings, setSettings } from '../../core/storage';
import {
  getBroadcastSettings,
  updateBroadcastSettings,
} from '../../core/broadcastStorage';
import { PROVIDER_IDS, type ProviderId } from '../../core/broadcastTypes';
import { hashText } from '../../core/broadcastStorage';
import { makeRun } from '../../core/queue';
import { DISPLAY_NAMES } from '../../adapters/broadcastTypes';
import { ext } from '../../core/browser';

// A live turn heartbeats every 10s. Anything staler than this is a leftover
// record from a closed tab, not a response you are actually waiting for.
const LIVE_HEARTBEAT_GRACE_MS = 35_000;

/** Brand marks: a letter and colour is enough to recognise a row at a glance. */
const BRAND: Record<ProviderId, { mark: string; bg: string }> = {
  chatgpt: { mark: 'G', bg: '#10a37f' },
  claude: { mark: 'C', bg: '#d97757' },
  perplexity: { mark: 'P', bg: '#20808d' },
  gemini: { mark: '✦', bg: '#4285f4' },
  deepseek: { mark: 'D', bg: '#4d6bfe' },
};

const ORIGINS: Record<ProviderId, string> = {
  chatgpt: 'https://chatgpt.com/*',
  claude: 'https://claude.ai/*',
  perplexity: 'https://www.perplexity.ai/*',
  gemini: 'https://gemini.google.com/*',
  deepseek: 'https://chat.deepseek.com/*',
};

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/** Ask each provider's open tab whether it is signed in. */
async function loginState(): Promise<Record<string, boolean | null>> {
  const out: Record<string, boolean | null> = {};
  for (const id of PROVIDER_IDS) {
    try {
      const tabs = await ext.tabs.query({ url: ORIGINS[id] });
      if (tabs.length === 0) {
        out[id] = null; // no tab open — unknown, not a problem
        continue;
      }
      const res = await ext.tabs.sendMessage(tabs[0]!.id as number, {
        v: 1,
        type: 'GET_STATE',
        providerId: id,
        ts: Date.now(),
      });
      out[id] = res?.type === 'STATE' ? res.composerReady === true : null;
    } catch {
      out[id] = null; // content script not there yet
    }
  }
  return out;
}

async function renderProviders(): Promise<void> {
  const settings = await getBroadcastSettings();
  const logins = await loginState();
  const host = $('providers');
  host.textContent = '';

  const needLogin: string[] = [];

  for (const id of PROVIDER_IDS) {
    const on = settings.providers[id]?.enabled ?? false;
    const signedIn = logins[id];

    const row = document.createElement('div');
    row.className = 'prov';

    const ico = document.createElement('div');
    ico.className = 'ico';
    ico.style.background = BRAND[id].bg;
    ico.textContent = BRAND[id].mark;

    const who = document.createElement('div');
    who.className = 'who';
    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = DISPLAY_NAMES[id] ?? id;
    const st = document.createElement('div');
    st.className = 's';
    if (!on) {
      st.textContent = 'off';
    } else if (signedIn === false) {
      st.textContent = 'not signed in — click to open';
      st.classList.add('warn');
      needLogin.push(DISPLAY_NAMES[id] ?? id);
    } else {
      st.textContent = 'ready';
    }
    who.append(n, st);

    const sw = document.createElement('label');
    sw.className = 'switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = on;
    cb.addEventListener('change', () => {
      void toggleProvider(id, cb.checked);
    });
    const track = document.createElement('span');
    track.className = 'track';
    sw.append(cb, track);

    // Clicking a provider that needs signing in opens its site.
    if (on && signedIn === false) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('.switch')) return;
        void ext.tabs.create({ url: ORIGINS[id].replace('/*', '/') });
      });
    }

    row.append(ico, who, sw);
    host.appendChild(row);
  }

  // One provider signed out means the others must not run either: the same
  // prompt landing in some conversations but not others leaves the user's
  // histories out of step, which is worse than not sending at all.
  const note = $('login-note');
  note.textContent =
    needLogin.length > 0
      ? `Sign in to ${needLogin.join(' and ')} before sending — prompts are held back so your chat histories stay in step.`
      : '';
}

async function toggleProvider(id: ProviderId, enabled: boolean): Promise<void> {
  await updateBroadcastSettings((cur) => ({
    ...cur,
    providers: {
      ...cur.providers,
      [id]: { ...(cur.providers[id] ?? { maxWaitMs: 300_000, longMode: false }), enabled },
    },
  }));
  await renderProviders();
}

async function sendPrompt(): Promise<void> {
  const box = $('prompt') as HTMLTextAreaElement;
  const text = box.value.trim();
  if (text.length === 0) return;
  const settings = await getBroadcastSettings();
  const targets = PROVIDER_IDS.filter((id) => settings.providers[id]?.enabled);
  if (targets.length === 0) {
    $('send-hint').textContent = 'Pick at least one AI above first.';
    return;
  }
  const now = Date.now();
  const runs: Record<string, unknown> = {};
  for (const id of targets) runs[id] = makeRun(id, now);
  const item = {
    id: `p-${now}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    hash: await hashText(text),
    createdAt: now,
    sourceProviderId: null,
    mode: settings.mode,
    runs,
  };
  const res = (await ext.runtime.sendMessage({ kind: 'broadcast:enqueue', item })) as
    | { ok: boolean; blocked?: string[] }
    | undefined;
  if (res && res.ok === false && res.blocked && res.blocked.length > 0) {
    // Nothing was sent: say which provider held it back and keep the text.
    const names = res.blocked.map((b) => DISPLAY_NAMES[b] ?? b).join(' and ');
    $('send-hint').textContent = `Nothing sent — sign in to ${names} first.`;
    return;
  }
  box.value = '';
  $('send-hint').textContent = 'Sent. Answers open in your whileAI tabs.';
}

async function render(): Promise<void> {
  const summaries = await getDailySummaries();
  const today = summaries[dayKey(Date.now())];

  if (today && today.turnCount > 0) {
    $('total-wait').textContent = formatDuration(today.totalWaitMs);
    $('turn-count').textContent = String(today.turnCount);
    $('avg-wait').textContent = formatDuration(today.totalWaitMs / today.turnCount);
  } else {
    $('total-wait').textContent = '–';
    $('turn-count').textContent = '0';
    $('avg-wait').textContent = '–';
  }

  const open = await getOpenTurns();
  const live = Object.values(open).find(
    (t) => Date.now() - (t.updatedAt ?? t.startedAt) < LIVE_HEARTBEAT_GRACE_MS,
  );
  const liveEl = $('live');
  if (live) {
    liveEl.style.display = 'block';
    $('live-timer').textContent = formatDuration(Date.now() - live.startedAt);
  } else {
    liveEl.style.display = 'none';
  }
}

async function init(): Promise<void> {
  const [settings, broadcast] = await Promise.all([getSettings(), getBroadcastSettings()]);

  const tracker = $('tracker-toggle') as HTMLInputElement;
  tracker.checked = settings.trackingEnabled !== false;
  $('tracker-body').classList.toggle('disabled', !tracker.checked);
  tracker.addEventListener('change', () => {
    void setSettings({ trackingEnabled: tracker.checked });
    $('tracker-body').classList.toggle('disabled', !tracker.checked);
  });

  const bc = $('broadcast-toggle') as HTMLInputElement;
  bc.checked = broadcast.broadcastEnabled !== false;
  $('broadcast-body').classList.toggle('disabled', !bc.checked);
  bc.addEventListener('change', () => {
    void updateBroadcastSettings((cur) => ({ ...cur, broadcastEnabled: bc.checked }));
    $('broadcast-body').classList.toggle('disabled', !bc.checked);
  });

  // Sending from the popup: the same path the panel used, minus the queue.
  $('send').addEventListener('click', () => {
    void sendPrompt();
  });
  ($('prompt') as HTMLTextAreaElement).addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendPrompt();
  });

  $('open-dashboard').addEventListener('click', () => {
    void ext.runtime.openOptionsPage();
  });
  $('open-settings').addEventListener('click', (ev) => {
    ev.preventDefault();
    // Detailed settings live in the side panel, opened on demand only.
    void ext.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const winId = tabs[0]?.windowId;
      if (winId !== undefined) void ext.sidePanel?.open?.({ windowId: winId });
      window.close();
    });
  });

  await render();
  await renderProviders();
  setInterval(() => void render(), 1000);
}

void init();
