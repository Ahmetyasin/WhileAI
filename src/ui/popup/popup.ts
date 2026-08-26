import { dayKey, formatDuration } from '../../core/metrics';
import { getDailySummaries, getOpenTurns } from '../../core/storage';
import { ext } from '../../core/browser';

/** Popup reads only precomputed daily summaries — must open fast (spec §5.1). */

// A live turn heartbeats every 10s. Anything staler than this is a leftover
// record from a closed tab, not a response you are actually waiting for.
const LIVE_HEARTBEAT_GRACE_MS = 35_000;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

async function render(): Promise<void> {
  const summaries = await getDailySummaries();
  const today = summaries[dayKey(Date.now())];

  if (today && today.turnCount > 0) {
    $('total-wait').textContent = formatDuration(today.totalWaitMs);
    $('turn-count').textContent = String(today.turnCount);
    $('avg-wait').textContent = formatDuration(today.totalWaitMs / today.turnCount);
    const escapePct =
      today.totalWaitMs > 0 ? Math.round((today.hiddenMs / today.totalWaitMs) * 100) : 0;
    const line = $('escape-line');
    line.innerHTML = `You left the tab for <span class="accent num">${escapePct}%</span> of today's waiting.`;
  } else {
    $('total-wait').textContent = '0s';
    $('turn-count').textContent = '0';
    $('avg-wait').textContent = '–';
    $('escape-line').textContent = 'No data yet today. Ask something on a supported AI site.';
  }
}

async function tickLive(): Promise<void> {
  const open = await getOpenTurns();
  const now = Date.now();
  const live = Object.values(open).filter((o) => now - o.updatedAt < LIVE_HEARTBEAT_GRACE_MS);
  const box = $('live');
  if (live.length === 0) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  const sorted = live.sort((a, b) => a.startedAt - b.startedAt);
  $('live-timer').textContent = sorted
    .map((o) => `${o.platform} ${formatDuration(now - o.startedAt)}`)
    .join(' · ');
}

$('open-dashboard').addEventListener('click', () => {
  void ext.runtime.openOptionsPage();
});

void render();
void tickLive();
setInterval(() => void tickLive(), 1000);
