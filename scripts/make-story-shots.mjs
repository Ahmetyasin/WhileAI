/**
 * Build the "how it works" screenshots the store listing was missing.
 *
 *   node scripts/make-story-shots.mjs
 *
 * Two raw captures exist (the panel and the dashboard) and both show STATE.
 * Neither shows the thing the product actually does: one prompt going to
 * several AIs. A visitor deciding in four seconds cannot infer that from a
 * settings panel, so these add a caption band that says it in words, and one
 * composed frame that shows the fan-out as a diagram.
 *
 * Captions rather than more UI shots on purpose: the store shows these small,
 * and small UI is unreadable. The words carry the meaning; the image carries
 * the credibility.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'store-assets');

const PY = String.raw`
import sys
DIR = sys.argv[2]
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None

W, H = 1280, 800
BG = (250, 250, 249)
INK = (26, 26, 24)
DIM = (111, 111, 106)
ACCENT = (194, 65, 12)

def font(size, bold=False):
    for p in ('/System/Library/Fonts/Helvetica.ttc',
              '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(p, size, index=1 if bold else 0)
        except Exception:
            continue
    return ImageFont.load_default()

def flatten(im):
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        base = Image.new('RGB', im.size, BG)
        base.paste(im, mask=im.split()[-1])
        return base
    return im.convert('RGB')

def trim(im, thresh=246, pad=8):
    """Crop the empty canvas a full-page capture leaves around the content."""
    g = im.convert('L').point(lambda p: 0 if p > thresh else 255)
    b = g.getbbox()
    if not b:
        return im
    return im.crop((max(0, b[0]-pad), max(0, b[1]-pad),
                    min(im.width, b[2]+pad), min(im.height, b[3]+pad)))

def trim_x(im, thresh=246, pad=18):
    """Horizontal-only trim: keeps the section's vertical framing intact."""
    g = im.convert('L').point(lambda p: 0 if p > thresh else 255)
    b = g.getbbox()
    if not b:
        return im
    return im.crop((max(0, b[0] - pad), 0, min(im.width, b[2] + pad), im.height))


def caption_frame(title, subtitle, image_path=None, crop_top=None, crop=None, image_scale=1.0):
    """
    A caption band across the top, the product underneath.

    The band is what a browsing user actually reads; the screenshot is what
    makes them believe it.
    """
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((64, 54), title, font=font(40, bold=True), fill=INK)
    d.text((64, 112), subtitle, font=font(21), fill=DIM)
    d.rectangle([64, 168, 64 + 56, 172], fill=ACCENT)

    if image_path:
        raw = flatten(Image.open(image_path))
        if crop:
            x0, y0, x1, y1 = crop
            shot = raw.crop((x0, y0, min(x1, raw.width), min(y1, raw.height)))
            # The dashboard is max-width centred, so a full-width slice is
            # mostly empty margin. Crop horizontally to the content.
            shot = trim_x(shot)
        else:
            shot = trim(raw)
            if crop_top:
                shot = shot.crop((0, 0, shot.width, min(crop_top, shot.height)))
        avail_h = H - 210 - 40
        avail_w = W - 128
        scale = min(avail_w / shot.width, avail_h / shot.height) * image_scale
        shot = shot.resize((max(1, round(shot.width * scale)),
                            max(1, round(shot.height * scale))), Image.LANCZOS)
        x = (W - shot.width) // 2
        # A hairline border so a white screenshot does not bleed into the page.
        d.rectangle([x-1, 209, x + shot.width, 210 + shot.height], outline=(226, 226, 222))
        im.paste(shot, (x, 210))
    return im

def fanout():
    """
    The one thing no screenshot shows: a prompt leaving one AI for four others.
    Drawn rather than captured, because there is no single moment in the UI
    where this is visible.
    """
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((64, 54), 'Type once. It goes to the rest.', font=font(40, bold=True), fill=INK)
    d.text((64, 112), 'In your own tabs, in the sessions you are already signed into.',
           font=font(21), fill=DIM)
    d.rectangle([64, 168, 120, 172], fill=ACCENT)

    # Source box
    sx, sy, sw, sh = 96, 300, 300, 120
    d.rounded_rectangle([sx, sy, sx+sw, sy+sh], radius=12, fill=(255, 255, 255),
                        outline=(214, 214, 209), width=2)
    d.text((sx+22, sy+26), 'You type here', font=font(20, bold=True), fill=INK)
    d.text((sx+22, sy+58), 'any one of the five', font=font(17), fill=DIM)

    targets = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini', 'DeepSeek']
    tx, tw, th, gap = 800, 300, 74, 18
    total = len(targets) * th + (len(targets) - 1) * gap
    ty0 = (H - total) // 2 + 60

    for i, name in enumerate(targets):
        ty = ty0 + i * (th + gap)
        d.rounded_rectangle([tx, ty, tx+tw, ty+th], radius=10, fill=(255, 255, 255),
                            outline=(226, 226, 222), width=1)
        d.text((tx+22, ty+24), name, font=font(20), fill=INK)
        # Curve from the source box to each target.
        x0, y0 = sx + sw, sy + sh // 2
        x1, y1 = tx, ty + th // 2
        mid = (x0 + x1) // 2
        d.line([(x0, y0), (mid, y0), (mid, y1), (x1 - 10, y1)], fill=(214, 214, 209), width=2)
        d.polygon([(x1, y1), (x1-11, y1-5), (x1-11, y1+5)], fill=ACCENT)

    d.text((96, H - 92), 'No API keys. No accounts. Nothing leaves your browser.',
           font=font(19), fill=DIM)
    return im

def promises():
    """
    The objections a cautious person has before installing something that
    types into their ChatGPT session — answered in their own words.
    """
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((64, 54), 'It stays out of your way', font=font(40, bold=True), fill=INK)
    d.text((64, 112), 'What it will and will not do, in plain terms.',
           font=font(21), fill=DIM)
    d.rectangle([64, 168, 120, 172], fill=ACCENT)

    rows = [
        ('Your own sessions', 'It uses the tabs you are already signed into. It never sees your password.'),
        ('Nothing leaves your browser', 'No account, no analytics, no telemetry. Your prompts stay on your machine.'),
        ('It never reads the answers', 'Only whether one is still arriving, so it can time it.'),
        ('It does not bypass anything', 'No CAPTCHA solving, no working around a usage limit, no hidden sessions.'),
        ('It speaks up when stuck', 'Signed out, rate limited, or showing a check — you hear about it straight away.'),
    ]
    y = 240
    for title, body in rows:
        d.rounded_rectangle([64, y, W-64, y+92], radius=10, fill=(255, 255, 255),
                            outline=(230, 230, 226), width=1)
        d.text((90, y+20), title, font=font(22, bold=True), fill=INK)
        d.text((90, y+52), body, font=font(18), fill=DIM)
        y += 106

    return im

out = sys.argv[1]

if out == 'all':
    fanout().save(f'{DIR}/screenshot-1-fanout.png')

    # Section boxes come from the live page, in CSS pixels, multiplied by the
    # capture scale. Measuring rather than eyeballing matters: a crop guessed
    # from the image cut charts in half and put the wrong section under each
    # heading.
    #
    #   deviceScaleFactor 2  x  clip scale 2  =  4
    S = 4
    W_PX = 5120  # the capture's own width

    def sect(top_css, bottom_css):
        return (0, top_css * S, W_PX, bottom_css * S)

    caption_frame(
        'See what waiting actually costs you',
        'Every answer timed, per AI, with the total for the week.',
        f'{DIR}/raw-dashboard-full.png', crop=sect(64, 495),
    ).save(f'{DIR}/screenshot-2-dashboard.png')

    caption_frame(
        'Which AI is actually slower',
        'Per-AI averages, and the ten longest waits you sat through.',
        f'{DIR}/raw-dashboard-full.png', crop=sect(1062, 1470),
    ).save(f'{DIR}/screenshot-5-platforms.png')

    caption_frame(
        'Where your attention went',
        'How often you tabbed away mid-answer, and what that adds up to.',
        f'{DIR}/raw-dashboard-full.png', crop=sect(1757, 2075),
    ).save(f'{DIR}/screenshot-6-attention.png')

    caption_frame(
        'Pick which AIs get the prompt',
        'Toggle any of them off. The panel shows what you have waited so far.',
        f'{DIR}/raw-popup.png', image_scale=0.92,
    ).save(f'{DIR}/screenshot-3-panel.png')

    # A text-only frame, because the honest alternative was reusing the panel
    # screenshot under a caption about notifications — a picture that does not
    # show the thing its caption claims.
    promises().save(f'{DIR}/screenshot-4-promises.png')
`;

execFileSync('python3', ['-c', PY, 'all', dir], { stdio: 'inherit' });

const check = `
from PIL import Image
import sys
DIR = sys.argv[1]
bad = 0
for n in ['screenshot-1-fanout.png', 'screenshot-2-dashboard.png',
          'screenshot-3-panel.png', 'screenshot-4-promises.png',
          'screenshot-5-platforms.png', 'screenshot-6-attention.png']:
    im = Image.open(DIR + '/' + n)
    ok = im.size == (1280, 800) and im.mode == 'RGB'
    bad += 0 if ok else 1
    print(('  OK  ' if ok else '  BAD '), n, im.size, im.mode)
sys.exit(1 if bad else 0)
`;
execFileSync('python3', ['-c', check, dir], { stdio: 'inherit' });
