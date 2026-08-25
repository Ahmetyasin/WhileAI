import { dayKey, formatDuration } from '../../core/metrics';
import { getDailySummaries, getOpenTurns } from '../../core/storage';
import { ext } from '../../core/browser';

/** Popup reads only precomputed daily summaries — must open fast (spec §5.1). */

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
    line.innerHTML = `You were elsewhere for <span class="accent num">${escapePct}%</span> of today's waiting.`;
  } else {
    $('total-wait').textContent = '0s';
    $('turn-count').textContent = '0';
    $('avg-wait').textContent = '–';
    $('escape-line').textContent = 'No data yet today. Ask something on ChatGPT or Claude.';
  }
}

async function tickLive(): Promise<void> {
  const open = await getOpenTurns();
  const entries = Object.values(open);
  const live = $('live');
  if (entries.length === 0) {
    live.style.display = 'none';
    return;
  }
  const oldest = entries.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
  live.style.display = 'block';
  $('live-timer').textContent = formatDuration(Date.now() - oldest.startedAt);
}

$('open-dashboard').addEventListener('click', () => {
  void ext.runtime.openOptionsPage();
});

void render();
void tickLive();
setInterval(() => void tickLive(), 1000);
