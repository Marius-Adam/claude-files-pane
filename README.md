<p align="center">
  <img src="docs/logo.svg" alt="" width="72" height="72">
</p>

<h1 align="center">Files pane for Claude Code</h1>

<p align="center">
  A file explorer for Claude Code: see what Claude reads, edits and commits, live, in a VS Code-style file tree beside your chat.
</p>

<p align="center">
  <img alt="Claude Code mod" src="https://img.shields.io/badge/Claude%20Code-mod-D97757?style=flat-square&logo=claude&logoColor=fff">
  <a href="https://github.com/Marius-Adam/claude-files-pane/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Marius-Adam/claude-files-pane?style=flat-square&color=555"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-555?style=flat-square"></a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="The Files pane following Claude through a task: reading and editing two files with the tree opening to each, running the tests, then committing" width="880">
</p>

## Install

In the terminal:

```bash
claude plugin marketplace add Marius-Adam/claude-files-pane && claude plugin install files-pane@marius-adam
```

Or in a Claude Code session:

```
/plugin install files-pane --marketplace Marius-Adam/claude-files-pane
```

Restart Claude Code and the pane opens beside the chat. `/files` brings it back if you close it.

## Features

- **Live card** of what Claude is doing: its thinking, the command it runs, the file it reads or edits
- **File tree that follows Claude**: folders open to each file it edits, even in another project
- **Touched list** of every file Claude read or edited this turn, or the whole session, with lines added and removed
- **Colours** for what happened to a file: read (purple), edited (orange), not committed (yellow), committed (green)
- **⋯ on a file**: `@`-mention it in your prompt, copy its path, see its diff under the row, or show it in the tree
- **Git** branch, commits ahead and changed files; ignored files dimmed
- **VS Code's icons and search**: type a few letters of a name, best matches first
- Works in the desktop app and VS Code; the terminal draws the same pane with text for icons

**Privacy:** the pane only reads. It lists folders and runs read-only git (`status`, `diff`, `rev-parse`, `ls-files`, `rev-list`, `show`) in your project, and sends nothing anywhere. It writes only to your prompt, when you pick **@ Mention**.

## FAQ

**How do I see which files Claude Code is editing?** The touched list shows the file Claude has in hand now and every file it read or edited, with line counts.

**Can I see a diff of what Claude changed?** Press ⋯ on a changed file, then **Diff**.

**How is it different from `git status`?** It updates as Claude works, and also shows files Claude only read.

**Do I need git?** No. Without a repository the pane has no git line; everything else works.

## Update or remove

```bash
claude plugin marketplace update marius-adam && claude plugin update files-pane@marius-adam
```

```bash
claude plugin uninstall files-pane@marius-adam
```

## Contributing

Issues and pull requests are welcome. Run it from a clone, then check it before you push:

```bash
git clone https://github.com/Marius-Adam/claude-files-pane.git && cd claude-files-pane && claude --plugin-dir .
```

```bash
claude plugin validate . && claude plugin test .
```

<details>
<summary>More for contributors</summary>

<br>

Claude Code writes its API types into `.claude-plugin/types/` the first time it loads the mod; then `npx -p typescript tsc -p . --noEmit` type-checks it. CI runs validation and tests on every push.

| Path | What's there |
| :-- | :-- |
| `hooks/register.tsx` | The mod's hooks: what Claude does reaches the pane through these |
| `hooks/pane.tsx` | The pane's drawing: the card, git's line, search, the toolbar, the touched list and the tree |
| `hooks/activity.ts` | Following Claude: the card's timing, commits, diffs |
| `hooks/disk.ts` | Git, folder listings, the search index, a file's diff |
| `hooks/paths.ts` | Paths and sizes as the pane prints them, and search ranking |
| `hooks/look.ts` | Colours, type chips and SVGs |
| `hooks/icons.ts`, `icon-svgs.ts` | Which vscode-icons icon a file or folder gets, and the SVGs (generated) |
| `scripts/demo/` | Redraws `docs/demo.gif` from the pane's own output |
| `tests/` | Tests, against the terminal and desktop surfaces |

To add an icon, map a name, extension or folder in `hooks/icons.ts` to a [vscode-icons](https://icon-sets.iconify.design/vscode-icons/) id, then:

```bash
npm pack @iconify-json/vscode-icons && tar xzf iconify-json-vscode-icons-*.tgz && python3 scripts/gen_icons.py package/icons.json hooks/icons.ts hooks/icon-svgs.ts
```

To redraw the demo GIF (needs Node 22+, Google Chrome and Python 3 with Pillow):

```bash
scripts/demo/make.sh
```

</details>

## License

[MIT](LICENSE). Icons from [vscode-icons](https://github.com/vscode-icons/vscode-icons) (MIT). The demo is drawn in the Tokyo Night colours of [claude-skins](https://github.com/hellosverre/claude-skins).
