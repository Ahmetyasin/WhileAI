import { PRODUCT_NAME } from '../../core/constants';
import { brokenProviders } from '../../core/adapterHealth';
import { getConfigStatus } from '../../core/config';
import {
  dayKey,
  formatDuration,
  turnIntervals,
  waitTotals,
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
import type { Turn } from '../../core/types';
import { barChart, stackedBarChart, type StackedDay } from './charts';

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

let allTurns: Turn[] = [];
let rangeDays = 30;
/** Matches the slider's max in dashboard.html. */
const PENALTY_MAX_MS = 60_000;
let resumePenaltyMs = 5_000;

function okTurns(): Turn[] {
  return allTurns.filter((t) => t.status === 'ok');
}

async function load(): Promise<void> {
  const settings = await getSettings();
  // The slider used to run to 10 minutes and defaulted to 3. Both are now out
  // of range, and a stored 180000 would sit past the end of the track showing
  // a number the user can no longer choose — and quietly dominate the total.
  // Clamp anything from the old range back to the new maximum.
  resumePenaltyMs = Math.min(settings.resumePenaltyMs, PENALTY_MAX_MS);
  if (resumePenaltyMs !== settings.resumePenaltyMs) {
    void setSettings({ resumePenaltyMs });
  }
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
  // Before the early return: adapter status matters most on a fresh install,
  // where "no data yet" and "the adapter is broken" look identical.
  void renderAdapterStatus();

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
  renderLongest(ok);
  renderAttention(ok);
  renderHeatmap(ok);
}

/**
 * Turns whose visibility data means something. Broadcast runs happen in
 * background tabs by design, so they are recorded as fully hidden; counting
 * them as "you left the tab" would misreport the user's actual attention
 * while still being perfectly good timing data.
 */
function watchedOnly(turns: Turn[]): Turn[] {
  return turns.filter((t) => t.origin !== 'broadcast');
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
  const deltaText =
    lw > 0
      ? `this week ${formatDuration(tw)}, ${tw >= lw ? '+' : '−'}${Math.abs(Math.round(((tw - lw) / lw) * 100))}% vs last`
      : `this week ${formatDuration(tw)}`;

  // When answers were waited for in parallel (broadcasting, or simply two
  // chats at once), the per-response total overstates real time. Show the
  // wall-clock figure too, but only when it actually differs — otherwise it
  // is noise (§5.29).
  const { unionMs } = waitTotals(turnIntervals(ok));
  const overlapped = totalRange > 0 && unionMs < totalRange * 0.95;
  $('s-total-delta').textContent = overlapped
    ? `${formatDuration(unionMs)} on the clock — AIs answer in parallel · ${deltaText}`
    : deltaText;
  $('s-total-delta').title = overlapped
    ? 'Responses overlapped, so the total above counts the same minutes more ' +
      'than once. “Real time” merges overlapping waits.'
    : '';

  $('s-turns').textContent = String(ok.length);
  const aborted = allTurns.filter((t) => t.status === 'aborted').length;
  // Each excluded status has a DIFFERENT cause, and lumping them under "too
  // quick to measure" was simply wrong — an orphaned turn is one the tab
  // closed on, which is the opposite of quick. A bare count told the user
  // nothing either (asked 2026-09-07: "again this 59 is what?"), so name the
  // reason for whichever group is largest and put the full split in the
  // tooltip.
  const invalid = allTurns.filter((t) => t.status === 'invalid').length;
  const orphaned = allTurns.filter((t) => t.status === 'orphaned').length;
  const ambiguous = allTurns.filter((t) => t.status === 'ambiguous').length;
  const parts: string[] = [];
  if (aborted > 0) parts.push(`${aborted} you stopped`);
  const skipped = invalid + orphaned + ambiguous;
  if (skipped > 0) {
    const biggest = Math.max(invalid, orphaned, ambiguous);
    const why =
      biggest === orphaned
        ? 'the tab closed mid-answer'
        : biggest === ambiguous
          ? 'two answers overlapped'
          : 'the timing looked wrong';
    parts.push(`${skipped} not counted — ${why}`);
  }
  const sub = $('s-unmeasured');
  sub.textContent = parts.length ? parts.join(' · ') : 'all counted';
  sub.title =
    `Not counted: ${orphaned} where the tab closed or reloaded before the answer finished, ` +
    `${ambiguous} where two answers overlapped so neither could be timed cleanly, and ` +
    `${invalid} where the clock did not add up. They are kept in your data, just left ` +
    `out of the averages.`;

  const waits = ok.map((t) => t.totalWaitMs).sort((a, b) => a - b);
  $('s-median').textContent = formatDuration(median(waits));
  $('s-p90').textContent = `9 in 10 finish within ${formatDuration(percentile(waits, 90))}`;

  // Broadcast runs happen in background tabs by design, so their wait is
  // recorded as fully hidden. Counting them here would drive "spent on
  // another tab" toward 100% and misreport the user's actual attention.
  const watched = watchedOnly(ok);
  const watchedTotal = watched.reduce((a, t) => a + t.totalWaitMs, 0);
  const hidden = watched.reduce((a, t) => a + t.hiddenMs, 0);
  $('s-escape').textContent =
    watchedTotal > 0 ? `${Math.round((hidden / watchedTotal) * 100)}%` : '0%';
}

/**
 * Adapter/selector status. Chat sites change their markup without warning, so
 * the extension carries a remotely-updatable selector file; this shows which
 * version is in effect and whether any provider currently needs a fix, rather
 * than letting a broken adapter fail silently (§4).
 */
async function renderAdapterStatus(): Promise<void> {
  const el = document.getElementById('adapter-status');
  if (!el) return;
  try {
    const [status, broken] = await Promise.all([getConfigStatus(), brokenProviders()]);
    // "Selector set v16 (embedded, never refreshed)" told a non-developer
    // nothing. Say something only when there IS something to say.
    if (broken.length > 0) {
      el.textContent =
        `whileAI cannot read ${broken.join(', ')} at the moment — that site ` +
        `changed. An update usually fixes it.`;
      el.classList.add('accent');
      el.hidden = false;
    } else {
      el.classList.remove('accent');
      el.hidden = true;
    }
    void status;
  } catch {
    el.textContent = '';
  }
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
  // Attention data must exclude broadcast turns: those run in tabs the
  // extension opened in the background, so they are 100% "away" by
  // construction and flattened every bar to 100%. The rest of the attention
  // UI already applies this filter; this chart was missing it.
  for (const t of watchedOnly(ok)) {
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

function renderPlatformTable(ok: Turn[]): void {
  const platforms = [...new Set(ok.map((t) => t.platform))];
  let html =
    '<table><tr><th>platform</th><th>responses</th><th>total wait</th>' +
    '<th>typical</th><th>longest</th><th>left the tab</th></tr>';
  for (const p of platforms.sort()) {
    const pt = ok.filter((t) => t.platform === p);
    const waits = pt.map((t) => t.totalWaitMs);
    const total = waits.reduce((a, b) => a + b, 0);
    // "left the tab" is attention data, so it excludes background broadcasts.
    const watchedPt = watchedOnly(pt);
    const watchedTotal = watchedPt.reduce((a, t) => a + t.totalWaitMs, 0);
    const hidden = watchedPt.reduce((a, t) => a + t.hiddenMs, 0);
    html +=
      `<tr><td>${p}</td>` +
      `<td class="num">${pt.length}</td>` +
      `<td class="num">${formatDuration(total)}</td>` +
      `<td class="num">${formatDuration(median(waits))}</td>` +
      `<td class="num">${formatDuration(Math.max(...waits))}</td>` +
      `<td class="num">${watchedTotal > 0 ? Math.round((hidden / watchedTotal) * 100) : 0}%</td></tr>`;

    // No per-session rows. "session N" was really "one browser tab", and a
    // tab the extension opened in the background ranked alongside a real
    // conversation without the attention filter the rest of the table
    // applies — so the rows implied more than a tabId can mean. One row per
    // AI is the honest summary.
  }
  $('platform-table').innerHTML = html + '</table>';
}

function renderLongest(ok: Turn[]): void {
  const top = [...ok].sort((a, b) => b.totalWaitMs - a.totalWaitMs).slice(0, 10);
  let html = '<table><tr><th>when</th><th>platform</th><th>wait</th><th>you were</th></tr>';
  for (const t of top) {
    const when = new Date(t.startedAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const away = t.totalWaitMs > 0 ? Math.round((t.hiddenMs / t.totalWaitMs) * 100) : 0;
    const stayed = away === 0
      ? 'on the tab the whole time'
      : `away ${away}% (${t.escapeCount}×)`;
    html +=
      `<tr><td>${when}</td><td>${t.platform}</td>` +
      `<td class="num">${formatDuration(t.totalWaitMs)}</td><td>${stayed}</td></tr>`;
  }
  $('longest-table').innerHTML = html + '</table>';
}

function renderAttention(all: Turn[]): void {
  const ok = watchedOnly(all);
  const switches = ok.reduce((a, t) => a + t.escapeCount, 0);
  $('attn-switches').textContent = String(switches);
  $('attn-hidden').textContent = formatDuration(ok.reduce((a, t) => a + t.hiddenMs, 0));
  // Tab visible but the browser window itself was not focused (another app).
  const unfocused = ok.reduce((a, t) => a + Math.max(0, t.visibleMs - t.focusMs), 0);
  $('attn-unfocused').textContent = formatDuration(unfocused);
  const stayed = ok.filter((t) => t.escapeCount === 0).length;
  $('attn-stayed').textContent = ok.length ? `${stayed}/${ok.length}` : '0';
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
  // Name what each number IS. "49s waiting" gave no clue that it was the
  // measured total for this period, so the sum read as arbitrary.
  $('true-cost').innerHTML =
    `${formatDuration(wait)} actually waiting + ${switches} tab switches × ` +
    `${formatDuration(resumePenaltyMs)} to refocus = ` +
    `<strong>${formatDuration(wait + switchCost)}</strong> this could really be costing you`;
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
  // Attention figures exclude background broadcast runs (see watchedOnly).
  const watched = watchedOnly(ok);
  const watchedTotal = watched.reduce((a, t) => a + t.totalWaitMs, 0);
  const hidden = watched.reduce((a, t) => a + t.hiddenMs, 0);
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
  const pct = watchedTotal > 0 ? Math.round((hidden / watchedTotal) * 100) : 0;
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
    a.download = `whileai-summary-${dayKey(Date.now())}.png`;
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
  download(`whileai-export-${dayKey(Date.now())}.json`, await exportJSON(), 'application/json');
});
$('export-csv').addEventListener('click', async () => {
  download(`whileai-export-${dayKey(Date.now())}.csv`, await exportCSV(), 'text/csv');
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
    `whileai-debug-${dayKey(Date.now())}.json`,
    JSON.stringify(log, null, 1),
    'application/json',
  );
});
$('debug-clear').addEventListener('click', async () => {
  await clearDebugLog();
  alert('Debug log cleared.');
});
$('delete-all').addEventListener('click', async () => {
  if (confirm('Delete ALL WhileAI data? This cannot be undone.')) {
    await deleteAllData();
    void load();
  }
});

void load();
