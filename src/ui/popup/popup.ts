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

/**
 * Show what went wrong while the user was on another tab. The badge brought
 * them here; this says which AI and why, then clears so it does not nag.
 */
async function renderProblems(): Promise<void> {
  const { getProblems, clearProblems } = await import('../../core/orchestrator');
  const problems = await getProblems();
  const host = $('problems');
  host.textContent = '';
  if (problems.length === 0) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  for (const p of problems) {
    const row = document.createElement('div');
    row.className = 'p';
    const ico = document.createElement('img');
    ico.src = `icons/providers/${p.providerId}.svg`;
    ico.alt = '';
    const msg = document.createElement('div');
    msg.textContent = p.message;
    row.append(ico, msg);
    host.appendChild(row);
  }
  const dismiss = document.createElement('a');
  dismiss.href = '#';
  dismiss.className = 'dismiss';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', (ev) => {
    ev.preventDefault();
    void clearProblems().then(() => renderProblems());
  });
  host.appendChild(dismiss);
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

  // The only setting worth a control: whether we speak up when something
  // needs the user. The rest of the old settings panel was either a privacy
  // default that should not be flipped casually, or an option for behaviour
  // that is now unconditional.
  //
  // Notifications are a REQUIRED permission, not an optional one. As an
  // optional permission the box shipped ticked while the permission had never
  // been granted: no change event ever fired, so nothing ever asked for it,
  // and every failure notification was dropped silently (reported 2026-09-07 —
  // a provider errored and the user saw nothing). Granted at install, the box
  // is now a plain on/off preference that means what it says.
  const notif = $('opt-notifications') as HTMLInputElement;
  notif.checked = broadcast.notifications !== false;
  notif.addEventListener('change', () => {
    void updateBroadcastSettings((cur) => ({ ...cur, notifications: notif.checked }));
  });

  await renderPlan();

  $('open-dashboard').addEventListener('click', (ev) => {
    ev.preventDefault();
    void ext.runtime.openOptionsPage();
    window.close();
  });

  await render();
  await renderProviders();
  await renderProblems();
  setInterval(() => void render(), 1000);
}

void init();

/** Where a purchase starts. Replaced with the real checkout at release. */
const UPGRADE_URL = 'https://whileai.app/upgrade';

/**
 * Show the plan, and only when it is useful.
 *
 * A licensed user sees nothing: they have already paid, and advertising the
 * upgrade to them is noise at best. A free user sees what is left BEFORE they
 * run out, because discovering a limit by hitting it is the worst way to
 * learn about it.
 */
async function renderPlan(): Promise<void> {
  const row = $('plan-row');
  const text = $('plan-text');
  const btn = $('plan-btn') as HTMLButtonElement;
  const box = $('licence-box');
  try {
    const { canBroadcast, FREE_BROADCASTS } = await import('../../core/entitlement');
    const { getStoredLicence, getUsedCount, activateLicence } = await import('../../core/licence');
    const licence = await getStoredLicence();
    const verdict = canBroadcast(
      {
        used: await getUsedCount(),
        licensed: licence?.valid === true,
        ...(licence?.expiresAt !== undefined ? { expiresAt: licence.expiresAt } : {}),
      },
      Date.now(),
    );

    if (verdict.allowed && verdict.remaining === null) {
      row.hidden = true; // licensed: say nothing
      box.hidden = true;
      return;
    }
    row.hidden = false;
    box.hidden = false;
    if (!verdict.allowed) {
      text.textContent =
        verdict.reason === 'expired'
          ? 'Your subscription has lapsed.'
          : `You have used all ${FREE_BROADCASTS} free broadcasts.`;
    } else {
      const left = verdict.remaining;
      text.textContent = `${left} of ${FREE_BROADCASTS} free broadcasts left. Tracking stays free.`;
    }
    btn.hidden = false;
    btn.addEventListener('click', () => {
      void ext.tabs.create({ url: UPGRADE_URL });
      window.close();
    });

    const input = $('licence-input') as HTMLInputElement;
    const msg = $('licence-msg');
    $('licence-activate').addEventListener('click', () => {
      void (async () => {
        const ok = await activateLicence(input.value);
        // Say which it was. "Something went wrong" leaves a paying customer
        // unable to tell a typo from a broken key.
        msg.textContent = ok
          ? 'Thanks — unlimited broadcasts are on.'
          : 'That key was not recognised. Check it was pasted in full.';
        if (ok) await renderPlan();
      })();
    });
  } catch {
    row.hidden = true;
    box.hidden = true;
  }
}
