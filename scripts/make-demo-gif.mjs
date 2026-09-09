/**
 * Build the side-by-side demo GIF from recorded frames.
 *
 *   node scripts/make-demo-gif.mjs <frames-dir>
 *
 * A GIF rather than a video because the Chrome Web Store's promo-video field
 * takes a YouTube URL, not a file — so the moving picture has to live on the
 * site and in the README, where a GIF plays without a player.
 *
 * Two panes side by side, because the product's claim is about TWO windows: a
 * single-pane recording cannot show a prompt arriving somewhere you did not
 * type it.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const framesDir = process.argv[2];
if (!framesDir) { console.error('usage: make-demo-gif.mjs <frames-dir>'); process.exit(1); }

const PY = String.raw`
import sys, glob, os
from PIL import Image, ImageDraw, ImageFont

frames_dir, out = sys.argv[1], sys.argv[2]
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

files = sorted(glob.glob(os.path.join(frames_dir, '*.png')))

# Pair by CAPTURE ORDER, not by index within each side. The recorder wrote
# frames as they happened -- ChatGPT alone until the relay fires, alternating
# after -- so zipping the two lists independently would show Claude answering
# before the prompt was even sent.
pairs, cur_l, cur_r = [], None, None
for f in files:
    if 'chatgpt' in os.path.basename(f):
        cur_l = f
    else:
        cur_r = f
    if cur_l:
        pairs.append((cur_l, cur_r))

PANE_W, PANE_H = 620, 388
W = PANE_W * 2 + 60
H = PANE_H + 108

def pane(path):
    im = Image.open(path).convert('RGB')
    return im.resize((PANE_W, PANE_H), Image.LANCZOS)

out_frames = []
for i, (l, r) in enumerate(pairs):
    canvas = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(canvas)
    d.text((20, 16), 'You type here', font=font(15, bold=True), fill=INK)
    d.text((PANE_W + 40, 16), 'It arrives here on its own', font=font(15, bold=True), fill=ACCENT)

    canvas.paste(pane(l), (20, 44))
    if r:
        canvas.paste(pane(r), (PANE_W + 40, 44))
    d.rectangle([20, 44, 20+PANE_W, 44+PANE_H], outline=(222, 222, 218))
    d.rectangle([PANE_W+40, 44, PANE_W+40+PANE_W, 44+PANE_H], outline=(222, 222, 218))

    d.text((20, H - 46), 'One prompt, every AI you picked — in your own signed-in tabs.',
           font=font(15), fill=DIM)
    out_frames.append(canvas.convert('P', palette=Image.ADAPTIVE, colors=128))

# One duration per frame, exactly. A short list silently truncates the GIF.
durations = [700] * len(out_frames)
durations[0] = 1200          # let the reader see the starting state
durations[-1] = 2600         # and rest on the result before looping
assert len(durations) == len(out_frames)

# optimize=False: the optimizer merges frames it judges identical, which here
# collapsed a 32-frame recording down to 9.
out_frames[0].save(out, save_all=True, append_images=out_frames[1:],
                   duration=durations, loop=0, optimize=False)
print('wrote', out, len(out_frames), 'frames')
`;

execFileSync('python3', ['-c', PY, framesDir, join(root, 'img', 'demo.gif')], { stdio: 'inherit' });
