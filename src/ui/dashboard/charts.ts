/** Hand-rolled SVG charts (spec §5.3): thin grids, line over fill, no deps. */

const W = 900;
// Each AI keeps its own colour across every chart and the legend, drawn from
// its brand so a stack is readable at a glance. Greys made five platforms
// indistinguishable. Unknown platforms fall back to the neutral shades.
const PLATFORM_COLORS: Record<string, string> = {
  chatgpt: '#10a37f',
  claude: '#d97757',
  perplexity: '#20808d',
  gemini: '#4285f4',
  // Brand blue for both Gemini (#4285f4) and DeepSeek (#4d6bfe) put two
  // near-identical blues side by side in the legend and the stack — with five
  // platforms, telling them apart matters more than matching DeepSeek's
  // exact blue, so it takes the violet end of its own palette.
  deepseek: '#7c3aed',
};
const PLATFORM_SHADES = ['#8a8a84', '#4d4d48', '#b5b5af', '#66665f'];

export function platformShade(index: number): string {
  return PLATFORM_SHADES[index % PLATFORM_SHADES.length];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export interface StackedDay {
  label: string;
  segments: { name: string; value: number }[];
}

export function stackedBarChart(days: StackedDay[], formatValue: (v: number) => string): string {
  const H = 200;
  // Wide enough for a real value AND the rotated axis title beside it. At 46
  // the two collided: "34m 13s" ran under "time spent waiting" and neither
  // could be read (seen 2026-09-07). The title sits at x=14, the values are
  // right-aligned at padL-8, so they no longer share space.
  const padL = 86;
  const padB = 34; // room for the axis title under the dates
  const padT = 16; // the legend sits above the plot, not on top of it
  const innerW = W - padL - 8;
  const innerH = H - padT - padB;
  const max = Math.max(1, ...days.map((d) => d.segments.reduce((a, s) => a + s.value, 0)));
  const names = [...new Set(days.flatMap((d) => d.segments.map((s) => s.name)))];
  const barW = Math.min(28, (innerW / Math.max(1, days.length)) * 0.7);
  const step = innerW / Math.max(1, days.length);

  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">`;
  for (let i = 0; i <= 3; i++) {
    const y = padT + (innerH * i) / 3;
    out += `<line class="gridline" x1="${padL}" y1="${y}" x2="${W - 8}" y2="${y}"/>`;
    out += `<text x="${padL - 8}" y="${y + 3}" text-anchor="end">${esc(formatValue(max * (1 - i / 3)))}</text>`;
  }
  days.forEach((d, i) => {
    const x = padL + i * step + (step - barW) / 2;
    let y = H - padB;
    for (const seg of d.segments) {
      const h = (seg.value / max) * innerH;
      const shade = PLATFORM_COLORS[seg.name] ?? platformShade(names.indexOf(seg.name));
      y -= h;
      out += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${shade}"/>`;
    }
    const every = Math.ceil(days.length / 15);
    if (i % every === 0) {
      out += `<text x="${x + barW / 2}" y="${H - 18}" text-anchor="middle">${esc(d.label)}</text>`;
    }
  });
  // Axis titles: without them the reader has to guess what the numbers mean.
  out += `<text x="${padL + innerW / 2}" y="${H - 4}" text-anchor="middle" opacity="0.65">date</text>`;
  out += `<text transform="translate(14 ${padT + innerH / 2}) rotate(-90)" text-anchor="middle" opacity="0.65">time spent waiting</text>`;
  let lx = padL;
  names.forEach((n, i) => {
    out += `<rect x="${lx}" y="1" width="8" height="8" fill="${PLATFORM_COLORS[n] ?? platformShade(i)}"/>`;
    out += `<text x="${lx + 12}" y="9">${esc(n)}</text>`;
    lx += 12 + n.length * 6.5 + 16;
  });
  return out + '</svg>';
}

export interface Bucket {
  label: string;
  value: number;
  accent?: boolean;
}

export function barChart(buckets: Bucket[], formatValue: (v: number) => string, unitMax?: number): string {
  const H = 180;
  const padL = 46;
  const padB = 22;
  const padT = 10;
  const innerW = W - padL - 8;
  const innerH = H - padT - padB;
  const max = unitMax ?? Math.max(1, ...buckets.map((b) => b.value));
  const step = innerW / Math.max(1, buckets.length);
  const barW = step * 0.62;

  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">`;
  for (let i = 0; i <= 3; i++) {
    const y = padT + (innerH * i) / 3;
    out += `<line class="gridline" x1="${padL}" y1="${y}" x2="${W - 8}" y2="${y}"/>`;
    out += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end">${esc(formatValue(max * (1 - i / 3)))}</text>`;
  }
  buckets.forEach((b, i) => {
    const h = Math.min(innerH, (b.value / max) * innerH);
    const x = padL + i * step + (step - barW) / 2;
    const fill = b.accent ? 'var(--accent)' : '#8a8a84';
    out += `<rect x="${x}" y="${H - padB - h}" width="${barW}" height="${h}" fill="${fill}"/>`;
    out += `<text x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return out + '</svg>';
}
