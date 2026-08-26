import { PRODUCT_NAME } from '../../core/constants';
import {
  dayKey,
  formatDuration,
  median,
  percentile,
} from '../../core/metrics';
import {
  clearDebugLog,
  countTurns,
  deleteAllData,
  exportCSV,
  exportJSON,
  getDebugLog,
  getPlatformActivity,
  getSelfTests,
  getSettings,
  getTurnsSince,
  importJSON,
  setSettings,
} from '../../core/storage';
import type { Turn, TurnMode } from '../../core/types';
import { barChart, stackedBarChart, type StackedDay } from './charts';

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

let allTurns: Turn[] = [];
let rangeDays = 30;
let resumePenaltyMs = 180_000;

function okTurns(): Turn[] {
  return allTurns.filter((t) => t.status === 'ok');
}

async function load(): Promise<void> {
  const settings = await getSettings();
  resumePenaltyMs = settings.resumePenaltyMs;
  (document.getElementById('retention-select') as HTMLSelectElement).value = String(settings.retentionDays);
  (document.getElementById('penalty-slider') as HTMLInputElement).value = String(resumePenaltyMs);
  (document.getElementById('debug-toggle') as HTMLInputElement).checked = settings.debugLogging;

  allTurns = await getTurnsSince(Date.now() - rangeDays * 86_400_000);
  allTurns.sort((a, b) => a.startedAt - b.startedAt);
  render();
  await renderWarning();
  await renderDataStats();
}

function render(): void {
  const ok = okTurns();
  const empty = ok.length === 0;
  $('empty-state').style.display = empty ? 'block' : 'none';
  $('content').style.display = empty ? 'none' : 'block';
  if (empty) return;

  renderStrip(ok);
  renderDaily(ok);
  renderEscape(ok);
  renderHistogram(ok);
  renderPlatformTable(ok);
  renderAttention(ok);
  renderHeatmap(ok);
}

function renderStrip(ok: Turn[]): void {
  const now = Date.now();
  const weekMs = 7 * 86_400_000;
  const thisWeek = ok.filter((t) => t.startedAt > now - weekMs);
  const lastWeek = ok.filter((t) => t.startedAt > now - 2 * weekMs && t.startedAt <= now - weekMs);
  const sum = (ts: Turn[]) => ts.reduce((a, t) => a + t.totalWaitMs, 0);

  const totalRange = sum(ok);
  $('s-total').textContent = formatDuration(totalRange);
  const tw = sum(thisWeek);
  const lw = sum(lastWeek);
  $('s-total-delta').textContent =
    lw > 0
      ? `this week ${formatDuration(tw)}, ${tw >= lw ? '+' : '−'}${Math.abs(Math.round(((tw - lw) / lw) * 100))}% vs last`
      : `this week ${formatDuration(tw)}`;

  $('s-turns').textContent = String(ok.length);
  const aborted = allTurns.filter((t) => t.status === 'aborted').length;
  const unmeasured = allTurns.length - ok.length - aborted;
  const parts: string[] = [];
  if (aborted > 0) parts.push(`${aborted} stopped by you`);
  if (unmeasured > 0) parts.push(`${unmeasured} not measured`);
  const sub = $('s-unmeasured');
  sub.textContent = parts.length ? parts.join(' · ') : 'all measured';
  sub.title =
    '“Not measured” = the tab closed or reloaded mid-response, or two responses overlapped, ' +
    'so the timing could not be trusted. These are kept but excluded from the stats.';

  const waits = ok.map((t) => t.totalWaitMs).sort((a, b) => a - b);
  $('s-median').textContent = formatDuration(median(waits));
  $('s-p90').textContent = `9 in 10 finish within ${formatDuration(percentile(waits, 90))}`;

  const hidden = ok.reduce((a, t) => a + t.hiddenMs, 0);
  $('s-escape').textContent = totalRange > 0 ? `${Math.round((hidden / totalRange) * 100)}%` : '0%';
}

function renderDaily(ok: Turn[]): void {
  const byDay = new Map<string, Map<string, number>>();
  for (let i = rangeDays - 1; i >= 0; i--) {
    byDay.set(dayKey(Date.now() - i * 86_400_000), new Map());
  }
  for (const t of ok) {
    const day = byDay.get(dayKey(t.startedAt));
    if (day) day.set(t.platform, (day.get(t.platform) ?? 0) + t.totalWaitMs);
  }
  const days: StackedDay[] = [...byDay.entries()].map(([key, platforms]) => ({
    label: key.slice(5),
    segments: [...platforms.entries()].map(([name, value]) => ({ name, value })),
  }));
  $('chart-daily').innerHTML = stackedBarChart(days, (v) => formatDuration(v));
}

const ESCAPE_BUCKETS = [
  { label: '<5s', max: 5000 },
  { label: '5–15s', max: 15_000 },
  { label: '15–30s', max: 30_000 },
  { label: '30–60s', max: 60_000 },
  { label: '1–2m', max: 120_000 },
  { label: '2–5m', max: 300_000 },
  { label: '>5m', max: Infinity },
];

function renderEscape(ok: Turn[]): void {
  const buckets = ESCAPE_BUCKETS.map((b) => ({ ...b, hidden: 0, total: 0 }));
  for (const t of ok) {
    const b = buckets.find((x) => t.totalWaitMs < x.max)!;
    b.hidden += t.hiddenMs;
    b.total += t.totalWaitMs;
  }
  $('chart-escape').innerHTML = barChart(
    buckets.map((b) => ({
      label: b.label,
      value: b.total > 0 ? (b.hidden / b.total) * 100 : 0,
      accent: true,
    })),
    (v) => `${Math.round(v)}%`,
    100,
  );
}

function renderHistogram(ok: Turn[]): void {
  const buckets = ESCAPE_BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const t of ok) buckets.find((x) => t.totalWaitMs < x.max)!.count++;
  $('chart-hist').innerHTML = barChart(
    buckets.map((b) => ({ label: b.label, value: b.count })),
    (v) => String(Math.round(v)),
  );
}

const MODES: TurnMode[] = ['standard', 'thinking', 'research', 'unknown'];

function renderPlatformTable(ok: Turn[]): void {
  const platforms = [...new Set(ok.map((t) => t.platform))];
  let html = '<table><tr><th>platform</th>';
  for (const m of MODES) html += `<th>${m}</th>`;
  html += '<th>all</th></tr>';
  for (const p of platforms) {
    html += `<tr><td>${p}</td>`;
    const pTurns = ok.filter((t) => t.platform === p);
    for (const m of MODES) {
      const waits = pTurns.filter((t) => t.mode === m).map((t) => t.totalWaitMs);
      html += `<td class="num">${waits.length ? formatDuration(median(waits)) : '–'}</td>`;
    }
    html += `<td class="num">${formatDuration(median(pTurns.map((t) => t.totalWaitMs)))}</td></tr>`;
  }
  $('platform-table').innerHTML = html + '</table>';
}

function renderAttention(ok: Turn[]): void {
  const switches = ok.reduce((a, t) => a + t.escapeCount, 0);
  $('attn-switches').textContent = String(switches);
  $('attn-per-turn').textContent = ok.length ? (switches / ok.length).toFixed(1) : '0';
  const focusedWaits = ok.filter((t) => t.escapeCount === 0).map((t) => t.totalWaitMs);
  $('attn-longest').textContent = focusedWaits.length
    ? formatDuration(Math.max(...focusedWaits))
    : '–';
  renderRefocusEstimate(ok);
}

function renderRefocusEstimate(ok: Turn[]): void {
  $('penalty-label').textContent = formatDuration(resumePenaltyMs);
  const wait = ok.reduce((a, t) => a + t.totalWaitMs, 0);
  const switches = ok.reduce((a, t) => a + t.escapeCount, 0);
  if (resumePenaltyMs === 0) {
    $('true-cost').textContent = '';
    return;
  }
  const switchCost = switches * resumePenaltyMs;
  $('true-cost').innerHTML =
    `${formatDuration(wait)} waiting + ${switches} switches × ${formatDuration(resumePenaltyMs)} refocus ` +
    `= <strong>${formatDuration(wait + switchCost)}</strong> estimated total`;
}

function renderHeatmap(ok: Turn[]): void {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of ok) {
    const d = new Date(t.startedAt);
    grid[(d.getDay() + 6) % 7][d.getHours()] += t.totalWaitMs;
  }
  const max = Math.max(1, ...grid.flat());
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = '<div class="lbl"></div>';
  for (let h = 0; h < 24; h++) html += `<div class="lbl" style="text-align:center">${h % 6 === 0 ? h : ''}</div>`;
  grid.forEach((row, d) => {
    html += `<div class="lbl">${dayLabels[d]}</div>`;
    row.forEach((v) => {
      const alpha = v > 0 ? 0.15 + 0.85 * (v / max) : 0;
      const style = v > 0 ? `background:color-mix(in srgb, var(--text) ${Math.round(alpha * 70)}%, var(--grid))` : '';
      html += `<div class="cell" style="${style}" title="${formatDuration(v)}"></div>`;
    });
  });
  $('heatmap').innerHTML = html;
}

async function renderWarning(): Promise<void> {
  const banner = $('warning-banner');
  const problems: string[] = [];
  const now = Date.now();
  const dayMs = 86_400_000;

  const activity = await getPlatformActivity();
  const selfTests = await getSelfTests();
  for (const [platform, a] of Object.entries(activity)) {
    // Only warn when measurement is actually failing: recent activity on the
    // host but no turn recorded in 24h (spec §3.6). A failed selector
    // self-test alone is not proof — the network signal measures regardless.
    const recentlyActive = a.lastActiveAt > now - dayMs;
    const noRecentTurns = a.lastTurnAt === 0 || a.lastTurnAt < now - dayMs;
    if (recentlyActive && noRecentTurns) {
      const st = selfTests[platform];
      const hint = st && !st.ok ? ` (self-test: ${st.missing.join(', ')})` : '';
      problems.push(
        `${platform}: no responses measured in the last 24h despite activity${hint}. ` +
        'Measurement may be broken — check for an extension update.',
      );
    }
  }
  if (problems.length) {
    banner.style.display = 'block';
    banner.textContent = problems.join(' ');
  } else {
    banner.style.display = 'none';
  }
}

async function renderDataStats(): Promise<void> {
  const count = await countTurns();
  $('data-stats').textContent = `${count} raw turn records stored locally.`;
}

// ---- Share card (spec §13.2): user-triggered PNG, no identifiers ----
function shareCard(): void {
  const ok = okTurns();
  const canvas = document.getElementById('share-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#141412';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#2c2c29';
  ctx.strokeRect(24.5, 24.5, W - 49, H - 49);

  const total = ok.reduce((a, t) => a + t.totalWaitMs, 0);
  const hidden = ok.reduce((a, t) => a + t.hiddenMs, 0);
  const waits = ok.map((t) => t.totalWaitMs).sort((a, b) => a - b);

  ctx.fillStyle = '#8f8f88';
  ctx.font = '20px ui-monospace, monospace';
  ctx.fillText(`Last ${rangeDays} days waiting for AI`, 60, 90);

  ctx.fillStyle = '#e8e8e4';
  ctx.font = 'bold 84px ui-monospace, monospace';
  ctx.fillText(formatDuration(total), 60, 190);

  ctx.font = '26px ui-monospace, monospace';
  ctx.fillStyle = '#e8e8e4';
  ctx.fillText(`${ok.length} turns · median ${formatDuration(median(waits))} · p90 ${formatDuration(percentile(waits, 90))}`, 60, 260);
  ctx.fillStyle = '#f97316';
  const pct = total > 0 ? Math.round((hidden / total) * 100) : 0;
  ctx.fillText(`${pct}% of that wait spent off-tab`, 60, 310);

  ctx.fillStyle = '#8f8f88';
  ctx.font = '22px ui-monospace, monospace';
  let y = 380;
  const platforms = [...new Set(ok.map((t) => t.platform))];
  for (const p of platforms.slice(0, 4)) {
    const pt = ok.filter((t) => t.platform === p);
    ctx.fillText(
      `${p.padEnd(10)} ${formatDuration(pt.reduce((a, t) => a + t.totalWaitMs, 0)).padStart(8)}  (${pt.length} turns)`,
      60,
      y,
    );
    y += 36;
  }

  ctx.fillStyle = '#6f6f6a';
  ctx.font = '18px ui-monospace, monospace';
  ctx.fillText(PRODUCT_NAME.toLowerCase(), W - 130, H - 44);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dwell-summary-${dayKey(Date.now())}.png`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Wiring ----
$('range-select').addEventListener('change', (e) => {
  rangeDays = Number((e.target as HTMLSelectElement).value);
  void load();
});
$('penalty-slider').addEventListener('input', (e) => {
  resumePenaltyMs = Number((e.target as HTMLInputElement).value);
  renderRefocusEstimate(okTurns());
});
$('penalty-slider').addEventListener('change', () => {
  void setSettings({ resumePenaltyMs });
});
$('retention-select').addEventListener('change', (e) => {
  void setSettings({ retentionDays: Number((e.target as HTMLSelectElement).value) });
});
$('share-btn').addEventListener('click', shareCard);
$('export-json').addEventListener('click', async () => {
  download(`dwell-export-${dayKey(Date.now())}.json`, await exportJSON(), 'application/json');
});
$('export-csv').addEventListener('click', async () => {
  download(`dwell-export-${dayKey(Date.now())}.csv`, await exportCSV(), 'text/csv');
});
$('import-btn').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const res = await importJSON(await file.text());
    alert(`Imported ${res.imported} turns (${res.skipped} skipped).`);
    void load();
  } catch (err) {
    alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});
$('debug-toggle').addEventListener('change', (e) => {
  void setSettings({ debugLogging: (e.target as HTMLInputElement).checked });
});
$('debug-download').addEventListener('click', async () => {
  const log = await getDebugLog();
  download(
    `dwell-debug-${dayKey(Date.now())}.json`,
    JSON.stringify(log, null, 1),
    'application/json',
  );
});
$('debug-clear').addEventListener('click', async () => {
  await clearDebugLog();
  alert('Debug log cleared.');
});
$('delete-all').addEventListener('click', async () => {
  if (confirm('Delete ALL Dwell data? This cannot be undone.')) {
    await deleteAllData();
    void load();
  }
});

void load();
