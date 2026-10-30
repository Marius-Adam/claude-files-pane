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
- **A tree that follows Claude.** Folders open to each file Claude edits and its row shimmers, even in another project. **⌂ Project** takes you home.
- **Every file it touched**, with `Reading`, `Edited` and `Committed` pills and the lines added and removed.
- **Git at a glance.** Branch, commits ahead, changed files and line counts; ignored files are dimmed.
- **VS Code's icons, search, dates and sizes.**

| Colour | Means |
| :-- | :-- |
| 🟣 Purple | Claude read it |
| 🟠 Orange | Claude edited it |
| 🟡 Yellow | Changed, not committed |
| 🟢 Green | Committed by Claude |

Works in the Claude desktop app and VS Code. In the terminal it draws the same pane with text in place of icons.

## Privacy

The pane only looks. It reads folder listings and runs read-only git commands (`status`, `diff --numstat`, `rev-parse`, `ls-files`, `rev-list`, `show`) in your project. It never changes a tool call, writes no files and sends nothing anywhere.

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

Claude Code writes its API types into `.claude-plugin/types/` the first time it loads the mod; after that, `npx -p typescript tsc -p . --noEmit` type-checks it.

| Path | What's there |
| :-- | :-- |
| `hooks/register.tsx` | The mod: its hooks, its state and the pane's drawing |
| `hooks/icons.ts` | Which icon a file or folder gets: exact name, config prefix, then longest extension |
| `hooks/icon-svgs.ts` | The vscode-icons SVGs those tables use (generated) |
| `scripts/gen_icons.py` | Regenerates `icon-svgs.ts` after you add an icon to `icons.ts` |
| `tests/` | Tests, run against the terminal and desktop surfaces |

To add an icon, map a name, extension or folder in `hooks/icons.ts` to an id from [vscode-icons](https://icon-sets.iconify.design/vscode-icons/), then:

```bash
npm pack @iconify-json/vscode-icons && tar xzf iconify-json-vscode-icons-*.tgz && python3 scripts/gen_icons.py package/icons.json hooks/icons.ts hooks/icon-svgs.ts
```

</details>

## Credits

MIT © Marius Adam. File and folder icons from [vscode-icons](https://github.com/vscode-icons/vscode-icons) (MIT).
