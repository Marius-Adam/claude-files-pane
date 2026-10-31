#!/bin/sh
# Turn a screen recording of the desktop app into docs/demo.gif: compose.py cuts the parts
# cuts.json names onto a captioned backdrop, gifski joins the frames.
#
#     scripts/demo/make.sh <recording.mov>
#
# Record with record.py. Needs ffmpeg, gifski and Python 3 with Pillow, on macOS for its fonts.
set -eu

repo=$(cd "$(dirname "$0")/../.." && pwd)
demo="$repo/scripts/demo"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

python3 -I "$demo/compose.py" "$1" "$demo/cuts.json" "$work"
fps=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["fps"])' "$demo/cuts.json")
gifski --quiet --fps "$fps" --quality 90 -o "$repo/docs/demo.gif" "$work"/*.png
ls -l "$repo/docs/demo.gif"
