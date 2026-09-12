/**
 * Build the images the website uses.
 *
 *   node scripts/make-site-images.mjs [outdir]
 *
 * Default outdir is ../ahmetaytar-site/whileai/img, the site repo. Rendered at
 * 2x and downsampled once, same as the store frames.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { SITE, page } from './shots/site.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2] ?? join(root, '..', '..', 'ahmetaytar-site', 'whileai', 'img');
const build = join(root, 'build', 'shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(out, { recursive: true });

if (!existsSync(join(build, 'pane-chatgpt.png'))) {
  execFileSync('python3', [join(root, 'scripts/shots/prep.py'), root,
    join(root, '..', 'whileai-recordings', '2026-09-09-five-ai-broadcast-2x-clean')], { stdio: 'inherit' });
}

const profile = join(build, '.chrome-site');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

for (const [name, w, h, css, body] of SITE) {
  const html = join(build, `site-${name}.html`);
  const png = join(build, `site-${name}.png`);
  writeFileSync(html, page(css, body));
  rmSync(png, { force: true });
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--force-device-scale-factor=2', `--window-size=${w},${h}`,
    '--virtual-time-budget=3000', `--screenshot=${png}`, `file://${html}`,
  ], { stdio: 'ignore', detached: true });
  const deadline = Date.now() + 60_000;
  let size = -1;
  while (Date.now() < deadline) {
    await sleep(400);
    if (!existsSync(png)) continue;
    const s = statSync(png).size;
    if (s > 0 && s === size) break;
    size = s;
  }
  try { process.kill(-child.pid); } catch {}
  try { child.kill('SIGKILL'); } catch {}
  if (!existsSync(png)) throw new Error(`${name}: no screenshot`);
  console.log('  ', name);
}

// Downsample 2x renders to their CSS size.
const PY = `
import sys, os
from PIL import Image
build, out = sys.argv[1], sys.argv[2]
for spec in sys.argv[3:]:
    name, w, h = spec.split(':')
    im = Image.open(os.path.join(build, 'site-' + name + '.png'))
    im.convert('RGB').resize((int(w), int(h)), Image.LANCZOS).save(
        os.path.join(out, name + '.png'), optimize=True)
    print('  ', name + '.png', im.size, '->', (int(w), int(h)))
`;
execFileSync('python3', ['-c', PY, build, out, ...SITE.map(([n, w, h]) => `${n}:${w}:${h}`)],
  { stdio: 'inherit' });

cpSync(join(root, 'store-assets/store-icon-128.png'), join(out, 'icon.png'));
console.log('   icon.png');
