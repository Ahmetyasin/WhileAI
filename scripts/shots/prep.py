"""Crop the source captures into the exact pieces the frames embed.

Everything here is a CROP, never an enlargement: the dashboard was captured at
4 device px per CSS px and the provider panes at 2x, so a piece shown at half
its pixel width on a 2x render maps one source pixel to one output pixel.

The provider panes are cropped to the CONVERSATION COLUMN. That is partly
composition (a sidebar full of chrome reads as clutter at tile size) and
partly privacy: the sidebars carry real chat titles from the account used for
the recording, and these images go on a public store page.
"""
import os, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

ROOT = sys.argv[1]
REC  = sys.argv[2]
OUT  = os.path.join(ROOT, 'build', 'shots')
os.makedirs(OUT, exist_ok=True)

def save(im, name):
    im.convert('RGB').save(os.path.join(OUT, name), optimize=True)
    print('  ', name, im.size)

# ---- dashboard sections (source is 4 device px per CSS px) ----------------
dash = Image.open(os.path.join(ROOT, 'store-assets', 'raw-dashboard-full.png'))
DS = 4
def section(top_css, bottom_css, name):
    crop = dash.crop((0, int(top_css*DS), dash.size[0], int(bottom_css*DS)))
    # trim uniform left/right margin
    g = crop.convert('L'); px = g.load(); w, h = g.size
    bg = px[2, 2]
    def blank(x): return all(abs(px[x, y] - bg) < 6 for y in range(0, h, 7))
    l = 0
    while l < w - 1 and blank(l): l += 1
    r = w - 1
    while r > l and blank(r): r -= 1
    pad = 18 * DS
    crop = crop.crop((max(0, l-pad), 0, min(w, r+pad), h))
    save(crop, name)

section(64, 470,     'dash-summary.png')
section(1062, 1330,  'dash-platforms.png')
section(1757, 2075,  'dash-attention.png')

# ---- the panel -----------------------------------------------------------
save(Image.open(os.path.join(ROOT, 'store-assets', 'raw-popup.png')), 'panel.png')

# ---- provider panes: crop to the conversation column ---------------------
# Measured, not guessed: the conversation column was found by dark-pixel
# density per column, and the prompt/answer rows by density within it. Each
# crop is then taken at a fixed aspect so CSS never has to crop again.
PANES = {
    'chatgpt':    ('010-chatgpt.png',    (420, 100, 2100, 940)),   # 4:3, the big tile
    'claude':     ('021-claude.png',     (820, 150, 2280, 1062)),   # 16:10
    'perplexity': ('026-perplexity.png', (520, 200, 1810, 1130)),
    'gemini':     ('027-gemini.png',     (560, 120, 2100, 1082)),
    'deepseek':   ('024-deepseek.png',   (760, 170, 2280, 1120)),
}
for key, (fname, box) in PANES.items():
    im = Image.open(os.path.join(REC, fname))
    save(im.crop(box), f'pane-{key}.png')
