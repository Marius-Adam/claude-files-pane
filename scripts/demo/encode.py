"""Join the frames capture.mjs saved into the README's looping GIF.

    python3 scripts/demo/encode.py <frames dir> docs/demo.gif dither

One palette for every frame, so colors hold steady, and a run of identical frames becomes one
held longer. `dither` smooths the shimmer's gradients at about twice the size; `plain` bands them.
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageChops

src, out, dither = Path(sys.argv[1]), sys.argv[2], sys.argv[3] == 'dither'
times = json.loads((src / 'frames.json').read_text())
paths = sorted(src.glob('*.png'))
frames = [Image.open(p).convert('RGB') for p in paths]
step = times[1] - times[0]

# A palette from frames across the whole run, so colors hold steady from frame to frame.
sample = frames[:: max(1, len(frames) // 12)]
sheet = Image.new('RGB', (1000, 800 * len(sample)))
for i, f in enumerate(sample):
    sheet.paste(f, (0, 800 * i))
palette = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT)

merged, durations = [], []
for f in frames:
    if merged and not ImageChops.difference(f, merged[-1]).getbbox():
        durations[-1] += step
        continue
    merged.append(f)
    durations.append(step)
durations[-1] += 1500

dith = Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE
q = [f.quantize(palette=palette, dither=dith) for f in merged]
q[0].save(out, save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(len(frames), '->', len(merged), 'frames,', round(Path(out).stat().st_size / 1e6, 2), 'MB')
