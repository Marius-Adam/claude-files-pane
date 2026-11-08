"""Write the vscode-icons SVGs that hooks/icons.ts names, and no others: hooks/icon-svgs-files.ts
holds the files' icons, hooks/icon-svgs-folders.ts the folders' and the defaults', and
hooks/icon-svgs.ts joins them as one SVGS.

    npm pack @iconify-json/vscode-icons && tar xzf iconify-json-vscode-icons-*.tgz
    python3 scripts/gen_icons.py package/icons.json hooks/icons.ts hooks/icon-svgs.ts

Run it after adding an icon id to one of the tables in hooks/icons.ts. Two files, as Anthropic's
plugin directory takes no text file over 256 KiB; it stops, writing nothing, if either would be.
"""

import json
import re
import sys
from pathlib import Path

icons_json, icons_ts, out_ts = sys.argv[1:4]

data = json.load(open(icons_json))
icons = data['icons']
aliases = data.get('aliases', {})
W, H = data.get('width', 16), data.get('height', 16)

src = open(icons_ts).read()
ids = set(re.findall(r"'((?:file-type|folder-type|default)-[a-z0-9-]+)'", src))
ids |= {f'{i}-opened' for i in ids if i.startswith('folder-type-')}


def resolve(name):
    if name in icons:
        return icons[name]
    if name in aliases:
        base = resolve(aliases[name]['parent'])
        return base and {**base, **{k: v for k, v in aliases[name].items() if k != 'parent'}}
    return None


missing, out = [], {}
for name in sorted(ids):
    icon = resolve(name)
    if not icon:
        missing.append(name)
        continue
    left, top = icon.get('left', 0), icon.get('top', 0)
    w, h = icon.get('width', W), icon.get('height', H)
    out[name] = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{left} {top} {w} {h}">{icon["body"]}</svg>'

# The plugin directory's cap on a text file, with room left for a few more icons.
MAX_BYTES = 240 * 1024
HEAD = (
    '// Generated from @iconify-json/vscode-icons (vscode-icons, MIT): only the icons icons.ts names.\n'
    '// Regenerate with scripts/gen_icons.py after adding an id to icons.ts rather than editing this file.\n'
)


def table(const, svgs):
    rows = ''.join(f'  {json.dumps(name)}: {json.dumps(svg)},\n' for name, svg in svgs.items())
    return f'{HEAD}export const {const}: Record<string, string> = {{\n{rows}}}\n'


out_path = Path(out_ts)
parts = {
    out_path.with_name(f'{out_path.stem}-files.ts'): table('FILE_SVGS', {k: v for k, v in out.items() if k.startswith('file-type-')}),
    out_path.with_name(f'{out_path.stem}-folders.ts'): table('FOLDER_SVGS', {k: v for k, v in out.items() if not k.startswith('file-type-')}),
}
for path, text in parts.items():
    size = len(text.encode())
    if size > MAX_BYTES:
        sys.exit(f'{path.name} would be {size} bytes, over {MAX_BYTES}: split it further before adding icons')

for path, text in parts.items():
    path.write_text(text)
out_path.write_text(
    HEAD
    + f"import {{ FILE_SVGS }} from './{out_path.stem}-files'\n"
    + f"import {{ FOLDER_SVGS }} from './{out_path.stem}-folders'\n\n"
    + '// Two files, as no text file in a plugin the directory lists may pass 256 KiB.\n'
    + 'export const SVGS: Record<string, string> = { ...FILE_SVGS, ...FOLDER_SVGS }\n'
)
for path, text in parts.items():
    print(path.name, len(text.encode()), 'bytes')
print('wrote', len(out), 'icons;', sum(len(s) for s in out.values()), 'chars')
print('missing', missing)
