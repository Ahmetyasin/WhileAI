/**
 * Broadcast side panel (CLAUDE.md §12 Faz 0/2): write once, send everywhere,
 * watch the queue.
 *
 * Rendering is keyed and in-place rather than innerHTML-per-frame: the prompt
 * box must keep focus and caret position while runs update behind it.
 */
import { ext } from '../../core/browser';
import {
  getBroadcastSettings,
  updateBroadcastSettings,
  getQueue,
  getRuntime,
  hashText,
} from '../../core/broadcastStorage';
import {
  isTerminal,
  PROVIDER_IDS,
  type BroadcastSettings,
  type ProviderId,
  type PromptItem,
  type QueueState,
  type RunState,
} from '../../core/broadcastTypes';
import { makeRun } from '../../core/queue';
import { DISPLAY_NAMES } from '../../adapters/broadcastTypes';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const STATE_LABEL: Record<RunState, string> = {
  queued: 'waiting its turn',
  opening_tab: 'opening tab',
  starting_new_chat: 'starting a new chat',
  waiting_ready: 'loading',
  inserting: 'typing',
  submitted: 'sent',
  generating: 'answering',
  done: 'done',
  needs_login: 'signed out',
  blocked_challenge: 'verification needed',
  timeout: 'gave up',
  error: 'failed',
  cancelled: 'cancelled',
};

function dotClass(state: RunState): string {
  if (state === 'done') return 'dot done';
  if (state === 'error' || state === 'timeout' || state === 'needs_login' || state === 'blocked_challenge') {
    return 'dot bad';
  }
  if (isTerminal(state)) return 'dot';
  return 'dot active';
}

function durationLabel(run: PromptItem['runs'][string]): string {
  if (!run) return '';
  const start = run.submittedAt ?? run.startedAt;
  if (start === undefined) return '';
  const end = run.completedAt ?? Date.now();
  const s = Math.round((end - start) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

let settings: BroadcastSettings;

async function send(): Promise<void> {
  const box = $('prompt') as HTMLTextAreaElement;
  const text = box.value.trim();
  if (!text) return;
  const targets = (Object.keys(settings.providers) as ProviderId[]).filter(
    (id) => settings.providers[id]?.enabled,
  );
  if (targets.length === 0) {
    $('hint').textContent = 'Pick at least one provider first.';
    return;
  }
  const now = Date.now();
  const runs: PromptItem['runs'] = {};
  for (const id of targets) runs[id] = makeRun(id, now);

  const item: PromptItem = {
    id: `p-${now}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    hash: await hashText(text),
    createdAt: now,
    sourceProviderId: null,
    mode: settings.mode,
    runs,
  };
  box.value = '';
  // Answers open in a separate Compare window that is deliberately NOT
  // focused (§5.20), so without this the user sees nothing happen and
  // reasonably concludes the prompt was never sent.
  const res = (await ext.runtime.sendMessage({ kind: 'broadcast:enqueue', item })) as
    | { ok: boolean; blocked?: string[] }
    | undefined;
  if (res && res.ok === false && res.blocked && res.blocked.length > 0) {
    // Nothing was queued: say so plainly and put the prompt back in the box
    // so the user does not lose what they typed (§5.19).
    const names = res.blocked.map((b) => DISPLAY_NAMES[b] ?? b).join(' and ');
    $('hint').textContent =
      `Nothing sent — sign in to ${names} first, so the same prompt reaches every AI.`;
    box.value = text;
    await refresh();
    return;
  }
  $('hint').textContent =
    'Sent. Answers open in the whileAI tab group — your own tabs are not touched.';
  await refresh();
}

async function refresh(): Promise<void> {
  const [queue, health] = await Promise.all([getQueue(), getAdapterHealth()]);
  renderProviders(health);
  renderQueue(queue);
  renderBanners(queue, health);
  // Only offer "Show answers" once there is actually something to show.
  const anyTab = queue.items.some((i) =>
    Object.values(i.runs).some((r) => r.tabId !== undefined),
  );
  (document.getElementById('show-window') as HTMLButtonElement).hidden = !anyTab;
}

async function getAdapterHealth(): Promise<Record<string, { ok: boolean; missing: string[] }>> {
  try {
    const res = await ext.storage.local.get('adapterSelfTests');
    const raw = res.adapterSelfTests;
    return typeof raw === 'object' && raw !== null
      ? (raw as Record<string, { ok: boolean; missing: string[] }>)
      : {};
  } catch {
    return {};
  }
}

function renderProviders(health: Record<string, { ok: boolean }>): void {
  const host = $('providers');
  host.textContent = '';
  for (const id of PROVIDER_IDS) {
    const cfg = settings.providers[id];
    const label = document.createElement('label');
    label.className = health[id] && !health[id]!.ok ? 'chip broken' : 'chip';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = cfg?.enabled ?? false;
    cb.addEventListener('change', () => {
      void toggleProvider(id, cb.checked);
    });

    label.append(cb, document.createTextNode(DISPLAY_NAMES[id] ?? id));
    host.appendChild(label);
  }
}

/**
 * Enabling a provider requests its host permission on the spot (§5.23): the
 * extension never holds access to a site the user has not switched on.
 */
async function toggleProvider(id: ProviderId, enabled: boolean): Promise<void> {
  if (enabled) {
    const origins = ORIGINS[id];
    if (origins) {
      // Ask ONLY if we do not already hold it. permissions.request() throws
      // ("must be called during a user gesture") whenever it would actually
      // prompt, and re-requesting a granted origin threw for every provider
      // after the first — the toggle then bailed out and nothing was saved.
      let held = false;
      try {
        held = await ext.permissions.contains({ origins });
      } catch {
        // API unavailable in this context; treat as not held and try to ask.
      }
      if (!held) {
        let granted = false;
        try {
          granted = await ext.permissions.request({ origins });
        } catch {
          // Thrown when there is no user gesture. Say so instead of failing
          // silently — the user's click is what unlocks this (§5.19).
          $('hint').textContent =
            `${DISPLAY_NAMES[id]} needs site access. Click the checkbox directly to grant it.`;
          await refresh();
          return;
        }
        if (!granted) {
          $('hint').textContent = `${DISPLAY_NAMES[id]} needs site access to receive prompts.`;
          await refresh();
          return;
        }
      }
    }
  }
  // Re-read before writing. The permission prompt above is awaited, and a
  // 1s refresh() re-renders the chips from the in-memory copy meanwhile, so
  // building the update from a stale `settings` silently dropped a second
  // toggle made while the first was still in flight.
  settings = await updateBroadcastSettings((current) => ({
    ...current,
    providers: {
      ...current.providers,
      [id]: { ...(current.providers[id] ?? { maxWaitMs: 300_000, longMode: false }), enabled },
    },
  }));
  await refresh();
}

const ORIGINS: Record<string, string[]> = {
  chatgpt: ['https://chatgpt.com/*'],
  claude: ['https://claude.ai/*'],
  perplexity: ['https://www.perplexity.ai/*'],
  gemini: ['https://gemini.google.com/*'],
  deepseek: ['https://chat.deepseek.com/*'],
};

function renderQueue(queue: QueueState): void {
  const host = $('queue');
  host.textContent = '';
  if (queue.items.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing queued.';
    host.appendChild(p);
    return;
  }

  // Queue-level controls. Without "clear finished" the panel grows without
  // bound; without "cancel all" the only way to stop N prompts is N clicks.
  const bar = document.createElement('div');
  bar.className = 'row';
  const TERMINAL = ['done', 'error', 'timeout', 'cancelled'];
  const anyFinished = queue.items.some((i) =>
    Object.values(i.runs).every((r) => TERMINAL.includes(r.state)),
  );
  const anyActive = queue.items.some((i) =>
    Object.values(i.runs).some((r) => !TERMINAL.includes(r.state)),
  );
  if (anyFinished) {
    const clear = document.createElement('button');
    clear.textContent = 'Clear finished';
    clear.addEventListener('click', () => {
      void ext.runtime
        .sendMessage({ kind: 'broadcast:event', event: { kind: 'clear_finished' } })
        .then(refresh);
    });
    bar.appendChild(clear);
  }
  if (anyActive) {
    const stop = document.createElement('button');
    stop.textContent = 'Cancel all';
    stop.addEventListener('click', () => {
      void ext.runtime
        .sendMessage({ kind: 'broadcast:event', event: { kind: 'cancel_all' } })
        .then(refresh);
    });
    bar.appendChild(stop);
  }
  if (bar.childElementCount > 0) host.appendChild(bar);

  for (const [idx, item] of queue.items.entries()) {
    const card = document.createElement('div');
    card.className = 'item';

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = item.text;
    card.appendChild(text);

    const runs = document.createElement('div');
    runs.className = 'runs';
    for (const [providerId, run] of Object.entries(item.runs)) {
      const row = document.createElement('div');
      row.className = 'run';

      const dot = document.createElement('span');
      dot.className = dotClass(run.state);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = DISPLAY_NAMES[providerId] ?? providerId;

      const status = document.createElement('span');
      status.className = 'dim';
      status.textContent = STATE_LABEL[run.state];

      const dur = document.createElement('span');
      dur.className = 'num dim';
      dur.textContent = durationLabel(run);

      row.append(dot, name, status, dur);
      runs.appendChild(row);
    }
    card.appendChild(runs);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const anyLive = Object.values(item.runs).some((r) => !isTerminal(r.state));
    if (anyLive) {
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        void ext.runtime
          .sendMessage({ kind: 'broadcast:event', event: { kind: 'cancel', promptId: item.id } })
          .then(refresh);
      });
      actions.appendChild(cancel);
    }

    // Always offer the manual escape hatch (§5.19): if we could not deliver
    // the prompt, the user should still be one click from sending it by hand.
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(item.text);
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1200);
    });
    actions.appendChild(copy);

    // Reorder and edit: the reducer has supported these since the queue
    // landed, but nothing dispatched them, so they shipped as dead code.
    const queuedOnly = Object.values(item.runs).every((r) => r.state === 'queued');
    if (idx > 0) {
      const up = document.createElement('button');
      up.textContent = '↑';
      up.title = 'Move earlier in the queue';
      up.addEventListener('click', () => {
        void ext.runtime
          .sendMessage({ kind: 'broadcast:event', event: { kind: 'reorder', promptId: item.id, direction: 'up' } })
          .then(refresh);
      });
      actions.appendChild(up);
    }
    if (idx < queue.items.length - 1) {
      const down = document.createElement('button');
      down.textContent = '↓';
      down.title = 'Move later in the queue';
      down.addEventListener('click', () => {
        void ext.runtime
          .sendMessage({ kind: 'broadcast:event', event: { kind: 'reorder', promptId: item.id, direction: 'down' } })
          .then(refresh);
      });
      actions.appendChild(down);
    }
    if (queuedOnly) {
      const edit = document.createElement('button');
      edit.textContent = 'Edit';
      edit.title = 'Only a prompt that has not started can be edited';
      edit.addEventListener('click', () => {
        const next = window.prompt('Edit prompt', item.text);
        if (next === null || next.trim().length === 0 || next === item.text) return;
        // The reducer dedupes on hash (§5.13), so an edit must carry the new one.
        void hashText(next)
          .then((hash) =>
            ext.runtime.sendMessage({
              kind: 'broadcast:event',
              event: { kind: 'edit', promptId: item.id, text: next, hash },
            }),
          )
          .then(refresh);
      });
      actions.appendChild(edit);
    }

    const failed = Object.entries(item.runs).filter(
      ([, r]) => r.state === 'error' || r.state === 'timeout',
    );
    if (failed.length > 0) {
      const retry = document.createElement('button');
      retry.textContent = 'Retry failed';
      retry.addEventListener('click', () => {
        void Promise.all(
          failed.map(([providerId]) =>
            ext.runtime.sendMessage({
              kind: 'broadcast:event',
              event: { kind: 'retry', promptId: item.id, providerId },
            }),
          ),
        ).then(refresh);
      });
      actions.appendChild(retry);
    }

    card.appendChild(actions);
    host.appendChild(card);
  }
}

/** Surfaces the states that need the user to act (§5.16, §5.17, §4). */
function renderBanners(queue: QueueState, health: Record<string, { ok: boolean }>): void {
  const host = $('banners');
  host.textContent = '';

  const needsLogin = new Set<string>();
  const challenged = new Set<string>();
  for (const item of queue.items) {
    for (const [providerId, run] of Object.entries(item.runs)) {
      if (run.state === 'needs_login') needsLogin.add(providerId);
      if (run.state === 'blocked_challenge') challenged.add(providerId);
    }
  }

  for (const providerId of needsLogin) {
    host.appendChild(
      banner(`${DISPLAY_NAMES[providerId] ?? providerId}: you are signed out.`, 'Open tab', () => {
        void ext.runtime.sendMessage({ kind: 'broadcast:focus', providerId });
      }),
    );
  }
  for (const providerId of challenged) {
    host.appendChild(
      banner(
        `${DISPLAY_NAMES[providerId] ?? providerId} is asking for verification. Solve it there, then resume.`,
        'Open tab',
        () => {
          void ext.runtime.sendMessage({ kind: 'broadcast:focus', providerId });
        },
      ),
    );
  }
  for (const [providerId, h] of Object.entries(health)) {
    if (!h.ok && settings.providers[providerId]?.enabled) {
      host.appendChild(
        banner(`${DISPLAY_NAMES[providerId] ?? providerId} adapter needs an update.`, null, null),
      );
    }
  }
}

function banner(text: string, actionLabel: string | null, onClick: (() => void) | null): HTMLElement {
  const div = document.createElement('div');
  div.className = 'banner';
  div.appendChild(document.createTextNode(text));
  if (actionLabel && onClick) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.addEventListener('click', onClick);
    div.appendChild(document.createElement('br'));
    div.appendChild(btn);
  }
  return div;
}

/**
 * Source capture (§5.13-§5.15): the user nominates one tab, and whatever they
 * type into that site is mirrored to the other enabled providers. Exactly one
 * tab at a time, so a second window on the same site cannot double-send.
 */
async function toggleSource(): Promise<void> {
  const rt = await getRuntime();
  if (rt.sourceTabId !== undefined) {
    await ext.runtime.sendMessage({ kind: 'broadcast:set_source', tabId: null });
    await renderSource();
    return;
  }
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    $('source-state').textContent = 'No tab to capture from.';
    return;
  }
  await ext.runtime.sendMessage({ kind: 'broadcast:set_source', tabId: tab.id });
  await renderSource();
}

async function renderSource(): Promise<void> {
  const rt = await getRuntime();
  const btn = $('set-source');
  const label = $('source-state');
  if (rt.sourceTabId === undefined) {
    btn.textContent = 'Use the current tab as source';
    label.textContent = 'Off — prompts are only sent from the box above.';
    return;
  }
  btn.textContent = 'Stop capturing';
  try {
    const tab = await ext.tabs.get(rt.sourceTabId);
    const host = tab.url ? new URL(tab.url).hostname : 'that tab';
    label.textContent = `Capturing from ${host}. What you ask there goes to the other providers too.`;
  } catch {
    label.textContent = 'The source tab was closed.';
  }
}

/**
 * Wire one settings checkbox to a BroadcastSettings field. keepHistory in
 * particular MUST be reachable: PRIVACY.md promises prompt text is dropped
 * after a run, and a documented control the user cannot see or change is a
 * store-review risk.
 */
function bindOption(
  id: string,
  read: (s: BroadcastSettings) => boolean,
  write: (s: BroadcastSettings, v: boolean) => BroadcastSettings,
): void {
  const box = document.getElementById(id) as HTMLInputElement | null;
  if (!box) return;
  box.checked = read(settings);
  box.addEventListener('change', () => {
    // Re-read first, for the same reason as toggleProvider: two quick
    // changes must not clobber each other.
    void updateBroadcastSettings((current) => write(current, box.checked)).then((s) => {
      settings = s;
    });
  });
}

async function init(): Promise<void> {
  settings = await getBroadcastSettings();
  bindOption('opt-keep-history', (s) => s.keepHistory, (s, v) => ({ ...s, keepHistory: v }));
  bindOption('opt-notifications', (s) => s.notifications, (s, v) => ({ ...s, notifications: v }));
  bindOption('opt-new-chat', (s) => s.mode === 'new_chat',
    (s, v) => ({ ...s, mode: v ? 'new_chat' : 'continue' }));
  bindOption('opt-lockstep', (s) => s.lockstep, (s, v) => ({ ...s, lockstep: v }));
  // Tab grouping is an optional permission, so it needs its own handler: the
  // request must happen inside the user's click (§5.23).
  const groupBox = document.getElementById('opt-group-tabs') as HTMLInputElement | null;
  if (groupBox) {
    void ext.permissions
      .contains({ permissions: ['tabGroups'] })
      .then((held) => (groupBox.checked = held))
      .catch(() => undefined);
    groupBox.addEventListener('change', () => {
      if (groupBox.checked) {
        void ext.permissions
          .request({ permissions: ['tabGroups'] })
          .then((granted) => (groupBox.checked = granted))
          .catch(() => (groupBox.checked = false));
      } else {
        void ext.permissions.remove({ permissions: ['tabGroups'] }).catch(() => undefined);
      }
    });
  }
  $('send').addEventListener('click', () => void send());
  $('show-window').addEventListener('click', () => {
    void ext.runtime.sendMessage({ kind: 'broadcast:show_window' });
  });
  $('set-source').addEventListener('click', () => void toggleSource());
  $('prompt').addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
  });
  $('open-dashboard').addEventListener('click', (ev) => {
    ev.preventDefault();
    ext.runtime.openOptionsPage();
  });
  await refresh();
  await renderSource();
  // The queue changes from the service worker, so poll rather than guess.
  setInterval(() => void refresh(), 1000);
}

void init();
