/**
 * Build the five-AI demo GIF from recorded frames.
 *
 *   node scripts/make-demo-gif5.mjs <frames-dir> <out.gif>
 *
 * Layout: the source AI large on the left, the four targets tiled on the right,
 * because the claim is "type once, it goes to the rest" -- a row of five equal
 * panes would not say which one was typed in.
 *
 * The raw frames are NOT in this repo -- 19MB of screenshots for one 583KB
 * GIF. They live beside it, in ../whileai-recordings/, together with the
 * scripts that captured them, so a shot can be re-cropped or the GIF re-timed
 * without spending live quota on paid accounts again:
 *
 *   node scripts/make-demo-gif5.mjs \
 *     ../whileai-recordings/2026-09-09-five-ai-broadcast img/demo5.gif
 *
 * Verified 2026-09-09: that command reproduces the shipped img/demo5.gif
 * byte for byte.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const framesDir = process.argv[2];
const outFile = process.argv[3] || join(root, 'img', 'demo5.gif');
if (!framesDir) { console.error('usage: make-demo-gif5.mjs <frames-dir> [out]'); process.exit(1); }

const PY = String.raw`
import sys, glob, os
from PIL import Image, ImageDraw, ImageFont

frames_dir, out = sys.argv[1], sys.argv[2]
BG   = (250, 250, 249)
INK  = (26, 26, 24)
DIM  = (120, 120, 114)
ACC  = (194, 65, 12)
LINE = (223, 223, 218)

def font(size, bold=False):
    for p in ('/System/Library/Fonts/Helvetica.ttc',
              '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try: return ImageFont.truetype(p, size, index=1 if bold else 0)
        except Exception: continue
    return ImageFont.load_default()

ORDER = ['chatgpt', 'claude', 'perplexity', 'gemini', 'deepseek']
NAMES = {'chatgpt':'ChatGPT','claude':'Claude','perplexity':'Perplexity',
         'gemini':'Gemini','deepseek':'DeepSeek'}
SRC = 'chatgpt'
TARGETS = [p for p in ORDER if p != SRC]

files = sorted(glob.glob(os.path.join(frames_dir, '*.png')))
def prov(f):
    b = os.path.basename(f)
    for p in ORDER:
        if b.endswith('-' + p + '.png'): return p
    return None

# Walk the recording in capture order; each pane holds its latest picture.
timeline, cur = [], {}
for f in files:
    p = prov(f)
    if p is None: continue
    cur[p] = f
    if len(cur) == len(ORDER):
        timeline.append(dict(cur))

# Too many near-identical steps make a heavy GIF; sample down to ~26 states.
MAX = 20
if len(timeline) > MAX:
    step = len(timeline) / MAX
    timeline = [timeline[int(i * step)] for i in range(MAX)]

SRC_W, SRC_H = 720, 450
TGT_W, TGT_H = 384, 240
GAP, PAD = 14, 20
HEAD, FOOT = 46, 42
W = PAD + SRC_W + GAP + TGT_W * 2 + GAP + PAD
H = HEAD + SRC_H + FOOT

cache = {}
def load(path, size):
    k = (path, size)
    if k not in cache:
        cache[k] = Image.open(path).convert('RGB').resize(size, Image.LANCZOS)
    return cache[k]

def label(d, x, y, text, color, size=13, bold=True):
    d.text((x, y), text, font=font(size, bold), fill=color)

out_frames = []
for state in timeline:
    canvas = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(canvas)

    label(d, PAD, 14, 'You type here  ·  ' + NAMES[SRC], INK, 14)
    canvas.paste(load(state[SRC], (SRC_W, SRC_H)), (PAD, HEAD))
    d.rectangle([PAD, HEAD, PAD + SRC_W, HEAD + SRC_H], outline=LINE)

    rx = PAD + SRC_W + GAP
    label(d, rx, 14, 'They answer on their own', ACC, 14)
    for i, p in enumerate(TARGETS):
        cx = rx + (i % 2) * (TGT_W + GAP)
        cy = HEAD + (i // 2) * (TGT_H + GAP + 16)
        canvas.paste(load(state[p], (TGT_W, TGT_H)), (cx, cy))
        d.rectangle([cx, cy, cx + TGT_W, cy + TGT_H], outline=LINE)
        label(d, cx + 2, cy + TGT_H + 3, NAMES[p], DIM, 11)

    d.text((PAD, H - 28),
           'One prompt, five AIs — in your own signed-in tabs. Every answer timed.',
           font=font(13), fill=DIM)
    out_frames.append(canvas.convert('P', palette=Image.ADAPTIVE, colors=128))

# One duration per frame, exactly: a short list silently truncates the GIF.
durations = [420] * len(out_frames)
durations[0] = 1400
durations[-1] = 2800
assert len(durations) == len(out_frames)

# optimize=False: the optimizer merges frames it judges identical.
out_frames[0].save(out, save_all=True, append_images=out_frames[1:],
                   duration=durations, loop=0, optimize=False)
print('wrote', out, len(out_frames), 'frames', W, 'x', H)
`;

execFileSync('python3', ['-c', PY, framesDir, outFile], { stdio: 'inherit' });
