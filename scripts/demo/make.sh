#!/bin/sh
# Redraw docs/demo.gif from the pane as it is now: record.tsx runs a scripted session against a
# scratch copy of the mod, capture.mjs draws each frame in headless Chrome, encode.py joins them.
#
#     scripts/demo/make.sh
#
# Needs the claude CLI, Node 22+, Google Chrome (or CHROME=<path>) and Python 3 with Pillow.
set -eu

repo=$(cd "$(dirname "$0")/../.." && pwd)
demo="$repo/scripts/demo"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/mod/tests"
cp -R "$repo/.claude-plugin" "$repo/hooks" "$repo/types" "$work/mod/"
cp "$demo/record.tsx" "$work/mod/tests/record.test.tsx"

if ! claude plugin test "$work/mod" > "$work/recording.txt" 2>&1; then
  grep -v '^FRAME \|^TREE ' "$work/recording.txt" >&2
  exit 1
fi

node "$demo/capture.mjs" "$work/recording.txt" "$work/frames"
python3 -I "$demo/encode.py" "$work/frames" "$repo/docs/demo.gif" dither
