/**
 * The popup is the product's front door: two sections, each with a master
 * switch. "Response tracker" shows today's numbers and links to the
 * dashboard; "Ask every AI" lists the five providers as icon rows to toggle
 * and links to detailed settings in the side panel. Nothing else lives here.
 * It reads only precomputed daily summaries so it opens instantly (§5.1).
 */
import { dayKey, formatDuration } from '../../core/metrics';
import { getDailySummaries, getOpenTurns, getSettings, setSettings } from '../../core/storage';
import { getBroadcastSettings, updateBroadcastSettings } from '../../core/broadcastStorage';
import { PROVIDER_IDS, type ProviderId } from '../../core/broadcastTypes';
import { DISPLAY_NAMES } from '../../adapters/broadcastTypes';
import { ext } from '../../core/browser';

// A live turn heartbeats every 10s. Anything staler than this is a leftover
// record from a closed tab, not a response you are actually waiting for.
const LIVE_HEARTBEAT_GRACE_MS = 35_000;

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

/** Ask each provider's open tab whether it is signed in. null = no tab, unknown. */
async function loginState(): Promise<Record<string, boolean | null>> {
  const out: Record<string, boolean | null> = {};
  for (const id of PROVIDER_IDS) {
    try {
      const tabs = await ext.tabs.query({ url: ORIGINS[id] });
      if (tabs.length === 0) {
        out[id] = null;
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
      out[id] = null;
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

    const ico = document.createElement('img');
    ico.src = `icons/providers/${id}.svg`;
    ico.alt = '';

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

  // One signed-out provider holds every broadcast back (see background):
  // say so here, where the user can act on it.
  $('login-note').textContent =
    needLogin.length > 0
      ? `Sign in to ${needLogin.join(' and ')} — prompts are held back until every AI is signed in.`
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

/** Clicking a section header expands it; the switch inside must not. */
function wireExpanders(): void {
  for (const head of Array.from(document.querySelectorAll<HTMLElement>('.head[data-toggle]'))) {
    head.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('.switch')) return;
      const sec = document.getElementById(head.dataset.toggle!)!;
      sec.classList.toggle('open');
    });
  }
}

async function init(): Promise<void> {
  const [settings, broadcast] = await Promise.all([getSettings(), getBroadcastSettings()]);
  wireExpanders();

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
    // Switching it on is the moment the user wants to pick providers.
    if (bc.checked) $('sec-multi').classList.add('open');
  });

  $('open-dashboard').addEventListener('click', (ev) => {
    ev.preventDefault();
    void ext.runtime.openOptionsPage();
    window.close();
  });
  $('open-settings').addEventListener('click', (ev) => {
    ev.preventDefault();
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
