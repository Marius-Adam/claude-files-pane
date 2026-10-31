"""Cut a screen recording of the desktop app into the README's GIF: the pane alone, on a dark
backdrop, with a caption beside it for each part and a list of the parts below.

    python3 scripts/demo/compose.py <recording.mov> scripts/demo/cuts.json <frames dir>

cuts.json goes with one recording. `pane` is where the pane sits in it, as [x, y, width] in the
recording's pixels; `cuts` are the parts the GIF shows, in order: `from` and `to` (seconds into the
recording), a `speed`, a short `step` for the list, a `title` and a `note`. A cut's `focus`, as
[x, y, width], zooms in on part of the pane; the camera eases there from the cut before's.
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

src, cuts_path, out = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
spec = json.loads(cuts_path.read_text())
fps = spec['fps']
cuts = spec['cuts']

# The GIF, in pixels: the pane on the right, its caption in the column left of it.
W, H, PAD = 1000, 740, 30
BOX_H = H - 2 * PAD
px, py, pw = spec['pane']
# The view of the pane is half again as tall as it is wide: its card, list and the tree's top.
BOX_W = round(BOX_H / 1.45)
BOX_X, BOX_Y = W - PAD - BOX_W, PAD
TEXT_X, TEXT_W = 48, BOX_X - 48 - 48
RADIUS = 14
ACCENT, TEXT, MUTED, DIM = (217, 119, 87), (246, 243, 250), (190, 180, 206), (112, 100, 128)


def font(size, weight='Regular'):
    # San Francisco, the system's own face.
    face = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)
    face.set_variation_by_name(weight)
    return face


LABEL, TITLE, NOTE, STEP = font(13, 'Semibold'), font(34, 'Bold'), font(19), font(16, 'Medium')


def wrap(text, face, width):
    lines, line = [], ''
    for word in text.split():
        trial = f'{line} {word}'.strip()
        if face.getlength(trial) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


def backdrop():
    # A dark plum wash, lighter toward the bottom right, a soft shadow under the pane.
    grad = Image.new('L', (W, H))
    grad.putdata([round(255 * (x / W + y / H) / 2) for y in range(H) for x in range(W)])
    base =Image.composite(Image.new('RGB', (W, H), (58, 40, 64)), Image.new('RGB', (W, H), (22, 20, 32)), grad)
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([BOX_X, BOX_Y + 12, BOX_X + BOX_W, BOX_Y + BOX_H + 12], RADIUS, fill=170)
    base.paste((0, 0, 0), mask=shadow.filter(ImageFilter.GaussianBlur(20)))
    ImageDraw.Draw(base).rounded_rectangle([BOX_X - 1, BOX_Y - 1, BOX_X + BOX_W, BOX_Y + BOX_H], RADIUS + 1, outline=(90, 74, 100))
    return base


def caption(canvas, index):
    # Above: what this part shows. Below: every part, this one lit.
    draw = ImageDraw.Draw(canvas)
    cut = cuts[index]
    y = 110
    draw.text((TEXT_X, y), 'FILES PANE FOR CLAUDE CODE', font=LABEL, fill=ACCENT)
    y += 34
    for line in wrap(cut['title'], TITLE, TEXT_W):
        draw.text((TEXT_X, y), line, font=TITLE, fill=TEXT)
        y += 42
    y += 10
    for line in wrap(cut['note'], NOTE, TEXT_W):
        draw.text((TEXT_X, y), line, font=NOTE, fill=MUTED)
        y += 28

    y = H - 70 - 34 * len(cuts)
    for i, one in enumerate(cuts):
        isOn = i == index
        draw.ellipse([TEXT_X, y + 6, TEXT_X + 9, y + 15], fill=ACCENT if isOn else DIM)
        draw.text((TEXT_X + 22, y), one['step'], font=STEP, fill=TEXT if isOn else DIM)
        y += 34


BACK = backdrop()
CARDS = []
for i in range(len(cuts)):
    card = BACK.copy()
    caption(card, i)
    CARDS.append(card)
MASK = Image.new('L', (BOX_W, BOX_H), 0)
ImageDraw.Draw(MASK).rounded_rectangle([0, 0, BOX_W - 1, BOX_H - 1], RADIUS, fill=255)


def ease(t):
    return t * t * (3 - 2 * t)


out.mkdir(parents=True, exist_ok=True)
for old in out.glob('*.png'):
    old.unlink()
n = 0
focus_was = [px, py, pw]
for i, cut in enumerate(cuts):
    focus = cut.get('focus', [px, py, pw])
    raw = out / f'raw{i}'
    raw.mkdir(exist_ok=True)
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-ss', str(cut['from']), '-to', str(cut['to']), '-i', src,
         '-vf', f"setpts=(PTS-STARTPTS)/{cut['speed']},fps={fps}", str(raw / '%05d.png')],
        check=True,
    )
    frames = sorted(raw.glob('*.png'))
    for k, path in enumerate(frames):
        # The camera eases from the last cut's view to this one's over its first 0.8 seconds.
        t = ease(min(1, k / (0.8 * fps)))
        x, y, w = (a + (b - a) * t for a, b in zip(focus_was, focus))
        h = w * BOX_H / BOX_W
        view = Image.open(path).convert('RGB').crop((round(x), round(y), round(x + w), round(y + h)))
        canvas = CARDS[i].copy()
        canvas.paste(view.resize((BOX_W, BOX_H), Image.LANCZOS), (BOX_X, BOX_Y), MASK)
        canvas.save(out / f'{n:05d}.png')
        n += 1
        path.unlink()
    raw.rmdir()
    focus_was = focus

# The last frame held a moment before the loop starts again.
last = Image.open(out / f'{n - 1:05d}.png')
for _ in range(fps * 2):
    last.save(out / f'{n:05d}.png')
    n += 1
print(n, 'frames at', fps, 'fps,', W, 'x', H)
