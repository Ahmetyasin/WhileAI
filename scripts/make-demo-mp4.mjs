/**
 * Build the promo MP4 from the recorded frames.
 *
 *   node scripts/make-demo-mp4.mjs <frames-dir> [out.mp4]
 *
 * The Chrome Web Store's promo-video field takes a YouTube URL, not a file, so
 * this exists to be uploaded to YouTube first. 1920x1080 because that is what
 * YouTube expects; the composition is letterboxed into it rather than
 * stretched, so no pane is distorted.
 *
 * Each recorded state is held for about a second and a half -- long enough to
 * actually read a pane, unlike the GIF where file size forces a quicker cut.
 *
 * Frames live outside the repo, in ../whileai-recordings/ -- see the README
 * there. Built with OpenCV rather than ffmpeg, which is not installed on this
 * machine.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const framesDir = process.argv[2];
const outFile = process.argv[3] || join(root, 'store-assets', 'demo.mp4');
if (!framesDir) {
  console.error('usage: make-demo-mp4.mjs <frames-dir> [out.mp4]');
  process.exit(1);
}

const PY = String.raw`
import sys, glob, os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

frames_dir, out = sys.argv[1], sys.argv[2]
OUT_W, OUT_H = 1920, 1080
FPS = 30
HOLD_S = 1.6
FIRST_S, LAST_S = 2.6, 4.0

BG=(250,250,249); INK=(26,26,24); DIM=(120,120,114); ACC=(194,65,12); LINE=(223,223,218)

def font(size, bold=False):
    for p in ('/System/Library/Fonts/Helvetica.ttc',
              '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(p, size, index=1 if bold else 0)
        except Exception:
            continue
    return ImageFont.load_default()

ORDER = ['chatgpt','claude','perplexity','gemini','deepseek']
NAMES = {'chatgpt':'ChatGPT','claude':'Claude','perplexity':'Perplexity',
         'gemini':'Gemini','deepseek':'DeepSeek'}
SRC = 'chatgpt'
TARGETS = [p for p in ORDER if p != SRC]

files = sorted(glob.glob(os.path.join(frames_dir,'*.png')))
def prov(f):
    b = os.path.basename(f)
    for p in ORDER:
        if b.endswith('-'+p+'.png'): return p
    return None

# Pair by capture order: each pane holds its latest picture, so the target
# panes stay on their pre-send state until the relay actually lands.
timeline, cur = [], {}
for f in files:
    p = prov(f)
    if p is None: continue
    cur[p] = f
    if len(cur) == len(ORDER):
        timeline.append(dict(cur))

MAX = 16
if len(timeline) > MAX:
    step = len(timeline)/MAX
    timeline = [timeline[int(i*step)] for i in range(MAX)]

SRC_W, SRC_H = 1120, 700
TGT_W, TGT_H = 400, 250
GAP, PAD = 22, 40
HEAD, FOOT = 76, 66
CW = PAD + SRC_W + GAP + TGT_W*2 + GAP + PAD
CH = HEAD + SRC_H + FOOT

cache = {}
def load(path, size):
    k = (path, size)
    if k not in cache:
        cache[k] = Image.open(path).convert('RGB').resize(size, Image.LANCZOS)
    return cache[k]

def compose(state):
    c = Image.new('RGB',(CW,CH),BG)
    d = ImageDraw.Draw(c)
    d.text((PAD,22),'You type here  ·  '+NAMES[SRC],font=font(24,True),fill=INK)
    c.paste(load(state[SRC],(SRC_W,SRC_H)),(PAD,HEAD))
    d.rectangle([PAD,HEAD,PAD+SRC_W,HEAD+SRC_H],outline=LINE)
    rx = PAD+SRC_W+GAP
    d.text((rx,22),'They answer on their own',font=font(24,True),fill=ACC)
    for i,p in enumerate(TARGETS):
        cx = rx + (i%2)*(TGT_W+GAP)
        cy = HEAD + (i//2)*(TGT_H+GAP+22)
        c.paste(load(state[p],(TGT_W,TGT_H)),(cx,cy))
        d.rectangle([cx,cy,cx+TGT_W,cy+TGT_H],outline=LINE)
        d.text((cx+3,cy+TGT_H+5),NAMES[p],font=font(18),fill=DIM)
    d.text((PAD,CH-46),
           'One prompt, five AIs — in your own signed-in tabs. Every answer timed.',
           font=font(21),fill=DIM)
    return c

def to_canvas(comp):
    sc = min(OUT_W/comp.size[0], OUT_H/comp.size[1])
    w,h = int(comp.size[0]*sc), int(comp.size[1]*sc)
    page = Image.new('RGB',(OUT_W,OUT_H),BG)
    page.paste(comp.resize((w,h),Image.LANCZOS), ((OUT_W-w)//2,(OUT_H-h)//2))
    return page

# avc1 (H.264) is what YouTube prefers; mp4v is the fallback if the local
# OpenCV build has no H.264 encoder.
vw = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*'avc1'), FPS, (OUT_W,OUT_H))
codec = 'avc1'
if not vw.isOpened():
    vw = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*'mp4v'), FPS, (OUT_W,OUT_H))
    codec = 'mp4v'
    if not vw.isOpened():
        print('ERROR: no usable encoder'); sys.exit(1)

total = 0
for i, st in enumerate(timeline):
    secs = FIRST_S if i == 0 else (LAST_S if i == len(timeline)-1 else HOLD_S)
    bgr = cv2.cvtColor(np.array(to_canvas(compose(st))), cv2.COLOR_RGB2BGR)
    for _ in range(int(secs*FPS)):
        vw.write(bgr); total += 1
vw.release()
print(f'wrote {out}  {total/FPS:.1f}s  {OUT_W}x{OUT_H}  {FPS}fps  codec={codec}')
`;

execFileSync('python3', ['-c', PY, framesDir, outFile], { stdio: 'inherit' });
