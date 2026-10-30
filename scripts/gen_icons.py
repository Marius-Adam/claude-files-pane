"""Write hooks/icon-svgs.ts: the vscode-icons SVGs that hooks/icons.ts names, and no others.

    npm pack @iconify-json/vscode-icons && tar xzf iconify-json-vscode-icons-*.tgz
    python3 scripts/gen_icons.py package/icons.json hooks/icons.ts hooks/icon-svgs.ts

Run it after adding an icon id to one of the tables in hooks/icons.ts.
"""

import json
import re
import sys

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

with open(out_ts, 'w') as f:
    f.write('// Generated from @iconify-json/vscode-icons (vscode-icons, MIT): only the icons icons.ts names.\n')
    f.write('// Regenerate after adding an id to icons.ts rather than editing this file.\n')
    f.write('export const SVGS: Record<string, string> = {\n')
    for name, svg in out.items():
        f.write(f'  {json.dumps(name)}: {json.dumps(svg)},\n')
    f.write('}\n')

print('wrote', len(out), 'icons;', sum(len(s) for s in out.values()), 'chars')
print('missing', missing)
