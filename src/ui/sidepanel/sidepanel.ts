/**
 * Detailed settings.
 *
 * The product's controls — which AIs take part, and the two master switches —
 * live in the toolbar popup. This panel is only for the settings that do not
 * belong in a small popup, and is opened deliberately from there.
 */
import { ext } from '../../core/browser';
import {
  getBroadcastSettings,
  updateBroadcastSettings,
} from '../../core/broadcastStorage';
import type { BroadcastSettings } from '../../core/broadcastTypes';

let settings: BroadcastSettings;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/**
 * Wire one checkbox to a settings field. Reads current settings inside the
 * handler so two quick changes cannot clobber each other.
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
    void updateBroadcastSettings((cur) => write(cur, box.checked)).then((s) => {
      settings = s;
    });
  });
}

async function init(): Promise<void> {
  settings = await getBroadcastSettings();

  bindOption('opt-keep-history', (s) => s.keepHistory, (s, v) => ({ ...s, keepHistory: v }));
  bindOption('opt-notifications', (s) => s.notifications, (s, v) => ({ ...s, notifications: v }));
  bindOption(
    'opt-new-chat',
    (s) => s.mode === 'new_chat',
    (s, v) => ({ ...s, mode: v ? 'new_chat' : 'continue' }),
  );

  // Tab grouping needs an optional permission, so it must be requested from
  // inside the user's own click (§5.23).
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

  $('open-dashboard').addEventListener('click', (ev) => {
    ev.preventDefault();
    void ext.runtime.openOptionsPage();
  });
}

void init();
