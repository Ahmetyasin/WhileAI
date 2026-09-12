/**
 * Build the five Chrome Web Store screenshots.
 *
 *   node scripts/make-store-shots.mjs [path-to-recordings]
 *
 * The store takes a MAXIMUM OF 5 images at 1280x800, 24-bit PNG, no alpha.
 *
 * How this stays sharp: every frame is an HTML page rendered by Chrome at
 * deviceScaleFactor 2 (so 2560x1600) and downsampled ONCE to 1280x800. The
 * pieces embedded in it were captured at 2x or 4x and are only ever cropped,
 * never enlarged, so a source pixel maps to an output pixel. An earlier
 * version drew these frames with an image library; real font rendering is the
 * difference between "a tool made this" and "a designer made this".
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAMES } from './shots/frames.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const recordings = process.argv[2] ?? join(root, '..', 'whileai-recordings', '2026-09-09-five-ai-broadcast-2x-clean');
const build = join(root, 'build', 'shots');
const out = join(root, 'store-assets');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

console.log('cropping sources');
execFileSync('python3', [join(root, 'scripts/shots/prep.py'), root, recordings], { stdio: 'inherit' });

// Assets the frames reference by bare filename.
cpSync(join(root, 'scripts/shots/theme.css'), join(build, 'theme.css'));
cpSync(join(root, 'store-assets/store-icon-128.png'), join(build, 'icon.png'));

console.log('rendering frames');
const profile = join(build, '.chrome');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

for (const [name, html] of FRAMES) {
  writeFileSync(join(build, name), html);
  const png = join(build, name.replace('.html', '.png'));
  // A separate headless instance with its own profile: the signed-in debug
  // browser (CLAUDE.md §0.3.5) is never touched by this.
  //
  // Chrome writes the PNG and then lingers instead of exiting, so waiting on
  // the PROCESS hangs while waiting on the FILE does not. Spawn detached and
  // poll for the file, bounded by wall clock (CLAUDE.md §5.31).
  rmSync(png, { force: true });
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--force-device-scale-factor=2', '--window-size=1280,800',
    '--virtual-time-budget=3000',
    `--screenshot=${png}`, `file://${join(build, name)}`,
  ], { stdio: 'ignore', detached: true });
  const deadline = Date.now() + 60_000;
  let size = -1;
  while (Date.now() < deadline) {
    await sleep(400);
    if (!existsSync(png)) continue;
    const s = statSync(png).size;
    if (s > 0 && s === size) break;   // written and no longer growing
    size = s;
  }
  try { process.kill(-child.pid); } catch {}
  try { child.kill('SIGKILL'); } catch {}
  if (!existsSync(png)) throw new Error(`${name}: Chrome wrote no screenshot`);
  console.log('  ', name);
}

console.log('downsampling to 1280x800');
const PY = `
import sys, os
from PIL import Image, ImageFilter
build, out = sys.argv[1], sys.argv[2]
for name in sys.argv[3:]:
    src = os.path.join(build, name + '.png')
    im = Image.open(src)
    assert im.size == (2560, 1600), f'{name}: expected 2560x1600, got {im.size}'
    im = im.convert('RGB').resize((1280, 800), Image.LANCZOS)
    # Halving a render softens fine detail slightly, which is most visible on
    # the small text inside the embedded product panes. A light unsharp mask
    # puts that edge contrast back. Kept gentle on purpose: a heavy one puts
    # halos around the headline type, which looks worse than the softness.
    im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=62, threshold=3))
    im.save(os.path.join(out, name + '.png'), optimize=True)
    print('  ', name + '.png')
`;
execFileSync('python3', ['-c', PY, build, out, ...FRAMES.map(([n]) => n.replace('.html', ''))],
  { stdio: 'inherit' });
