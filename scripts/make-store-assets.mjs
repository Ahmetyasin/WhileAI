/**
 * Turn raw captures into the exact assets the Chrome Web Store accepts.
 *
 *   node scripts/make-store-assets.mjs
 *
 * The store is strict in ways that reject an upload rather than warn: exactly
 * 1280x800 for screenshots, 440x280 and 1400x560 for the promo tiles, and
 * NO alpha channel. A retina capture is 2560x1600, which is rejected despite
 * looking correct — so everything is resampled here rather than by hand.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'store-assets');
mkdirSync(dir, { recursive: true });

// Pillow does the work; it is already present and needs no install.
const PY = `
import sys
from PIL import Image, ImageDraw

def flatten(im, bg=(250, 250, 249)):
    """Drop alpha. The store rejects 24-bit PNGs that carry a channel."""
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        base = Image.new('RGB', im.size, bg)
        base.paste(im, mask=im.split()[-1])
        return base
    return im.convert('RGB')

def fit_top(src, w, h, bg=(250, 250, 249)):
    """
    Scale to the target WIDTH and keep the top of the page.

    Cropping the top rather than squashing the whole page: a dashboard
    scaled to fit vertically is unreadable at 1280 wide, and the top is
    where the headline numbers are.
    """
    im = flatten(Image.open(src))
    scale = w / im.width
    im = im.resize((w, max(1, round(im.height * scale))), Image.LANCZOS)
    out = Image.new('RGB', (w, h), bg)
    out.paste(im, (0, 0))
    return out

def center_on(src, w, h, bg=(250, 250, 249), pad=48):
    """
    Put a narrow capture on a canvas of the required size.

    The popup is ~380px wide; stretching it to 1280 would look absurd, so it
    is centred at its own scale with a soft edge instead.
    """
    im = flatten(Image.open(src))
    # Trim the empty right-hand side a full-page capture leaves behind.
    bbox = im.convert('L').point(lambda p: 0 if p > 245 else 255).getbbox()
    if bbox:
        im = im.crop((bbox[0], bbox[1], min(bbox[2] + 40, im.width), im.height))
    max_h = h - pad * 2
    if im.height > max_h:
        im = im.resize((round(im.width * max_h / im.height), max_h), Image.LANCZOS)
    out = Image.new('RGB', (w, h), bg)
    out.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return out

def tile(w, h, title, subtitle, icon=None):
    """A promo tile. Plain and typographic — the store shows it small."""
    im = Image.new('RGB', (w, h), (26, 26, 24))
    d = ImageDraw.Draw(im)
    from PIL import ImageFont
    def font(size, bold=False):
        for p in ('/System/Library/Fonts/Helvetica.ttc',
                  '/System/Library/Fonts/Supplemental/Arial.ttf'):
            try:
                return ImageFont.truetype(p, size, index=1 if bold else 0)
            except Exception:
                continue
        return ImageFont.load_default()
    big = font(round(h * 0.15), bold=True)
    small = font(round(h * 0.075))
    d.text((round(w * 0.07), round(h * 0.30)), title, font=big, fill=(255, 255, 255))
    d.text((round(w * 0.07), round(h * 0.52)), subtitle, font=small, fill=(180, 178, 172))
    d.rectangle([0, h - 6, w, h], fill=(194, 65, 12))
    return im

which = sys.argv[1]
if which == 'shots':
    fit_top('${dir}/raw-dashboard.png', 1280, 800).save('${dir}/screenshot-1-dashboard.png')
    center_on('${dir}/raw-popup.png', 1280, 800).save('${dir}/screenshot-2-popup.png')
elif which == 'tiles':
    tile(440, 280, 'whileAI', 'Ask every AI at once').save('${dir}/promo-small-440x280.png')
    tile(1400, 560, 'whileAI', 'Ask every AI at once, and see what waiting costs you').save('${dir}/promo-marquee-1400x560.png')
`;

execFileSync('python3', ['-c', PY, 'shots'], { stdio: 'inherit' });
execFileSync('python3', ['-c', PY, 'tiles'], { stdio: 'inherit' });

// Verify rather than assume: a wrong size is rejected at upload, not warned.
const check = `
from PIL import Image
import glob, sys
want = {
  'screenshot-1-dashboard.png': (1280, 800),
  'screenshot-2-popup.png': (1280, 800),
  'promo-small-440x280.png': (440, 280),
  'promo-marquee-1400x560.png': (1400, 560),
}
bad = 0
for name, size in want.items():
    im = Image.open('${dir}/' + name)
    ok = im.size == size and im.mode == 'RGB'
    if not ok: bad += 1
    print(('  OK  ' if ok else '  BAD '), name, im.size, im.mode)
sys.exit(1 if bad else 0)
`;
execFileSync('python3', ['-c', check], { stdio: 'inherit' });
