/**
 * Build the five Chrome Web Store screenshots.
 *
 *   node scripts/make-store-shots.mjs
 *
 * The store takes a MAXIMUM OF 5 images, 1280x800, 24-bit PNG with no alpha.
 *
 * Sharpness is the whole point of this script. The dashboard capture is
 * 5120px wide for a 1280 CSS-px page -- exactly 4 device pixels per CSS pixel.
 * Every frame here is composed at 2560x1600 (2x the store size) and
 * downsampled once at the end, and the screenshot crops are taken at 2 device
 * px per CSS px, so a pixel in the source maps to a pixel in the output.
 * Nothing is enlarged, and nothing is resampled twice -- earlier versions
 * shrank an already-downscaled image, which is what made the text mushy.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const PY = String.raw`
import sys, os
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None

ROOT = sys.argv[1]
OUT  = os.path.join(ROOT, 'store-assets')
S    = 2                      # compose at 2x, downsample once at the end
W, H = 1280 * S, 800 * S

BG   = (250, 250, 249)
INK  = (26, 26, 24)
DIM  = (111, 111, 106)
ACC  = (194, 65, 12)
LINE = (226, 226, 222)

def font(px, bold=False):
    """px is in FINAL (1280x800) pixels; scaled up for the 2x canvas."""
    for p in ('/System/Library/Fonts/Helvetica.ttc',
              '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(p, px * S, index=1 if bold else 0)
        except Exception:
            continue
    return ImageFont.load_default()

def heading(d, title, sub):
    d.text((64*S, 52*S), title, font=font(37, True), fill=INK)
    d.text((64*S, 108*S), sub,  font=font(20),       fill=DIM)
    d.rectangle([64*S, 158*S, 120*S, 162*S], fill=ACC)

def finish(im, name):
    # One LANCZOS step from 2x to final. RGB, no alpha, as the store requires.
    im.convert('RGB').resize((1280, 800), Image.LANCZOS).save(
        os.path.join(OUT, name), optimize=True)
    print(' ', name)

# The dashboard capture: 4 device px per CSS px.
dash = Image.open(os.path.join(OUT, 'raw-dashboard-full.png'))
DS = 4

def section(top_css, bottom_css):
    """Crop a dashboard section and hand it back at 2 device px per CSS px,
    which is exactly the canvas scale -- so it is never enlarged."""
    crop = dash.crop((0, int(top_css*DS), dash.size[0], int(bottom_css*DS)))
    return crop.resize((crop.size[0]//2, crop.size[1]//2), Image.LANCZOS)

def trim_x(im):
    """Trim uniform left/right margin only; vertical framing is deliberate."""
    g = im.convert('L'); px = g.load(); w, h = g.size
    bg = px[2, 2]
    def blank(x): return all(abs(px[x, y] - bg) < 6 for y in range(0, h, 7))
    l = 0
    while l < w - 1 and blank(l): l += 1
    r = w - 1
    while r > l and blank(r): r -= 1
    pad = 20 * S
    return im.crop((max(0, l - pad), 0, min(w, r + pad), h))

def place(im, d, shot, top_css, max_h_css):
    """Centre a shot under the heading, scaling DOWN only if it cannot fit."""
    avail_w, avail_h = W - 128*S, int(max_h_css * S)
    sc = min(avail_w / shot.size[0], avail_h / shot.size[1], 1.0)
    if sc < 1.0:
        shot = shot.resize((int(shot.size[0]*sc), int(shot.size[1]*sc)), Image.LANCZOS)
    x, y = (W - shot.size[0]) // 2, int(top_css * S)
    im.paste(shot, (x, y))
    d.rectangle([x-1, y-1, x + shot.size[0], y + shot.size[1]], outline=LINE)

# ---- 1. Fan-out diagram (drawn, so it is sharp by construction) ----------
im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
heading(d, 'Type once. It goes to the rest.',
        'In your own tabs, in the sessions you are already signed into.')
sx, sy, sw, sh = 96*S, 300*S, 300*S, 120*S
d.rounded_rectangle([sx, sy, sx+sw, sy+sh], radius=12*S, fill=(255,255,255),
                    outline=(214,214,209), width=2*S)
d.text((sx+22*S, sy+26*S), 'You type here', font=font(20, True), fill=INK)
d.text((sx+22*S, sy+58*S), 'any one of the five', font=font(17), fill=DIM)
targets = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini', 'DeepSeek']
tx, tw, th, gap = 800*S, 300*S, 74*S, 18*S
ty0 = (H - (len(targets)*th + (len(targets)-1)*gap)) // 2 + 60*S
for i, name in enumerate(targets):
    ty = ty0 + i*(th+gap)
    d.rounded_rectangle([tx, ty, tx+tw, ty+th], radius=10*S, fill=(255,255,255),
                        outline=LINE, width=1*S)
    d.text((tx+22*S, ty+24*S), name, font=font(20), fill=INK)
    x0, y0 = sx+sw, sy+sh//2
    x1, y1 = tx, ty+th//2
    mid = (x0+x1)//2
    d.line([(x0,y0),(mid,y0),(mid,y1),(x1-10*S,y1)], fill=(214,214,209), width=2*S)
    d.polygon([(x1,y1),(x1-11*S,y1-5*S),(x1-11*S,y1+5*S)], fill=ACC)
d.text((96*S, H-92*S), 'No API keys. No accounts. Nothing leaves your browser.',
       font=font(19), fill=DIM)
finish(im, 'screenshot-1-fanout.png')

# ---- 2. Dashboard summary ------------------------------------------------
im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
heading(d, 'See what waiting costs you',
        'Total time, answers counted, and the trend per day.')
place(im, d, trim_x(section(64, 470)), 196, 560)
finish(im, 'screenshot-2-dashboard.png')

# ---- 3. The panel --------------------------------------------------------
im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
heading(d, 'Pick which AIs get the prompt',
        'Every AI you are signed in to, with its own switch.')
# The panel is tall and narrow. Centring it in a 16:10 frame leaves most of
# the frame empty and the panel too small to read, so it sits on the right at
# the largest size that fits, with the claim it illustrates on the left.
panel = Image.open(sys.argv[2]).convert('RGB')
avail_h = 560 * S
sc = min(avail_h / panel.size[1], 1.0)
pw, ph = int(panel.size[0]*sc), int(panel.size[1]*sc)
panel = panel.resize((pw, ph), Image.LANCZOS)
px_, py_ = W - 64*S - pw, 200*S
im.paste(panel, (px_, py_))
d.rectangle([px_-1, py_-1, px_+pw, py_+ph], outline=LINE)

bullets = [
    'One switch per AI — only the ones you turn on get the prompt.',
    '"ready" means that tab is signed in and can receive it.',
    'Your waiting time so far, with the full dashboard one click away.',
]
by = 250*S
for b in bullets:
    d.ellipse([64*S, by+7*S, 71*S, by+14*S], fill=ACC)
    d.text((86*S, by), b, font=font(18), fill=DIM)
    by += 62*S
finish(im, 'screenshot-3-panel.png')

# ---- 4. Promises (text only) --------------------------------------------
im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
heading(d, 'It stays out of your way', 'What it will and will not do, in plain terms.')
rows = [
    ('Your own sessions',
     'It uses the tabs you are already signed into. It never sees your password.'),
    ('Nothing leaves your browser',
     'No account, no analytics, no telemetry. Your prompts stay on your machine.'),
    ('It never reads the answers',
     'Only whether one is still arriving, so it can time it.'),
    ('It does not bypass anything',
     'No CAPTCHA solving, no working around a usage limit, no hidden sessions.'),
    ('It speaks up when stuck',
     'Signed out, rate limited, or showing a check — you hear about it straight away.'),
]
y = 232*S
for title, body in rows:
    d.rounded_rectangle([64*S, y, W-64*S, y+92*S], radius=10*S,
                        fill=(255,255,255), outline=(230,230,226), width=1*S)
    d.text((90*S, y+20*S), title, font=font(22, True), fill=INK)
    d.text((90*S, y+52*S), body,  font=font(18),       fill=DIM)
    y += 106*S
finish(im, 'screenshot-4-promises.png')

# ---- 5. Per-AI table + attention, stacked -------------------------------
# Two dashboard sections in one frame, because the store allows only five
# images and dropping one would cost a real metric.
im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
heading(d, 'Which AI is slower, and what it costs you',
        'Per-AI averages, and where your attention goes while you wait.')
top = trim_x(section(1062, 1330))     # BY PLATFORM table only
bot = trim_x(section(1757, 2075))     # ATTENTION WHILE WAITING
# Both sections are placed at native scale; the frame is tight, so this one
# starts higher and uses a smaller gap rather than shrinking either shot.
y = 178*S
for shot in (top, bot):
    avail_w = W - 128*S
    sc = min(avail_w / shot.size[0], 1.0)
    if sc < 1.0:
        shot = shot.resize((int(shot.size[0]*sc), int(shot.size[1]*sc)), Image.LANCZOS)
    x = (W - shot.size[0]) // 2
    im.paste(shot, (x, y))
    d.rectangle([x-1, y-1, x+shot.size[0], y+shot.size[1]], outline=LINE)
    y += shot.size[1] + 12*S
finish(im, 'screenshot-5-metrics.png')
`;

execFileSync('python3', ['-c', PY, root, process.argv[2]], { stdio: 'inherit' });
