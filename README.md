<h1 align="center">Files pane for Claude Code</h1>

<p align="center">
  See what Claude reads, edits and commits, live, in a VS Code-style file tree beside your chat.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="Claude Code mod" src="https://img.shields.io/badge/Claude%20Code-mod-d97757">
  <img alt="vscode-icons" src="https://img.shields.io/badge/icons-vscode--icons-007acc">
</p>

<p align="center">
  <img src="docs/demo.gif" alt="The Files pane following Claude through a task: thinking, searching, reading and editing two files with the tree opening to each, running the tests, then committing" width="880">
</p>

<p align="center"><sub>A scripted session in a made-up project, drawn from the pane's own output.</sub></p>

## Install

In a Claude Code session:

```
/plugin install files-pane --marketplace Marius-Adam/claude-files-pane
```

Restart Claude Code and the pane opens beside the chat. Closed it? `/files` brings it back.

## What you see

- **What Claude is doing, right now.** Its thinking as it streams, the command it runs, the file it reads or edits, then what the turn changed.
- **A tree that follows Claude.** Folders open to each file Claude edits and its row shimmers, even in another project. A `..` row at the top climbs a folder, and **⌂ Project** in its header takes you home.
- **Every file it touched**, each row tinted by what Claude did with it and shimmering while it works on it, with the lines added and removed. **Whole session** keeps the earlier turns' files too.
- **A file's actions behind its ⋯**: put it in your prompt as `@path`, copy its path, see its **Diff** right under the row, or find it in the tree.
- **Git at a glance.** Branch, commits ahead, changed files and line counts; ignored files are dimmed.
- **VS Code's icons, dates and sizes, and its kind of search**: type a few letters of a name, best matches first.

| Colour | Means |
| :-- | :-- |
| 🟣 Purple | Claude read it |
| 🟠 Orange | Claude edited it |
| 🟡 Yellow | Changed, not committed |
| 🟢 Green | Committed by Claude |

Works in the Claude desktop app and VS Code. In the terminal it draws the same pane with text in place of icons.

## Privacy

The pane only looks. It reads folder listings and runs read-only git commands (`status`, `diff`, `rev-parse`, `ls-files`, `rev-list`, `show`) in your project. It never changes a tool call, writes no files and sends nothing anywhere. The one thing it writes is to your prompt box, when you choose **@ Mention** on a file.

## Update or remove

```bash
claude plugin marketplace update marius-adam && claude plugin update files-pane@marius-adam
```

```bash
claude plugin uninstall files-pane@marius-adam
```

<details>
<summary><b>Develop</b></summary>

<br>

Run it from a clone:

```bash
git clone https://github.com/Marius-Adam/claude-files-pane.git && cd claude-files-pane && claude --plugin-dir .
```

Check and test it:

```bash
claude plugin validate . && claude plugin test .
```

Claude Code writes its API types into `.claude-plugin/types/` the first time it loads the mod; after that, `npx -p typescript tsc -p . --noEmit` type-checks it. GitHub runs the validation and the tests on every push and pull request (`.github/workflows/check.yml`).

| Path | What's there |
| :-- | :-- |
| `hooks/register.tsx` | The mod's hooks: what Claude does reaches the pane through these |
| `hooks/pane.tsx` | The pane's drawing: the card, git's line, search, the toolbar, the touched list and the tree |
| `hooks/activity.ts` | What Claude is doing and touched: the card's timing, following Claude, commits, diffs |
| `hooks/disk.ts` | What the pane reads of the disk: git, folder listings, the search index, a file's diff |
| `hooks/paths.ts` | Paths, dates and sizes as the pane prints them, and how search ranks a file |
| `hooks/look.ts` | Colours, type chips and the SVG the pane draws |
| `hooks/state.ts` | The pane's constants, and the tags of the values it keeps |
| `hooks/icons.ts` | Which icon a file or folder gets: exact name, config prefix, then longest extension |
| `hooks/icon-svgs.ts` | The vscode-icons SVGs those tables use (generated) |
| `scripts/gen_icons.py` | Regenerates `icon-svgs.ts` after you add an icon to `icons.ts` |
| `scripts/demo/` | Redraws `docs/demo.gif` from the pane's own output |
| `tests/` | Tests, run against the terminal and desktop surfaces |

To add an icon, map a name, extension or folder in `hooks/icons.ts` to an id from [vscode-icons](https://icon-sets.iconify.design/vscode-icons/), then:

```bash
npm pack @iconify-json/vscode-icons && tar xzf iconify-json-vscode-icons-*.tgz && python3 scripts/gen_icons.py package/icons.json hooks/icons.ts hooks/icon-svgs.ts
```

After a change to how the pane looks, redraw the demo GIF. It runs a scripted session against the pane and needs Node 22+, Google Chrome and Python 3 with Pillow:

```bash
scripts/demo/make.sh
```

</details>

## Credits

MIT © Marius Adam. File and folder icons from [vscode-icons](https://github.com/vscode-icons/vscode-icons) (MIT).
