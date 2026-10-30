# Files pane for Claude Code

A live Files pane beside your Claude Code chat. It shows which file Claude is reading or editing right now, every file it touched this turn, your git status, and a VS Code-style project tree that opens itself to follow Claude around.

## What you get

- **A "right now" card** that changes colour with what Claude is doing: purple while it reads, orange while it edits, green when it's done or has committed. Its badge moves too: a pulsing halo while Claude has a file open, a spinning arc while it thinks, and a check that draws itself at the end of a turn.
- **Your branch at a glance:** its name, how many commits it is ahead, the lines added and removed, and how many files aren't committed yet.
- **Claude touched:** each file Claude opened or edited this turn, in the order it got to them. Each one gets a pill saying `Reading`, `Editing`, `Opened`, `Edited` or `Committed`, with line counts for edits.
- **A project tree with [vscode-icons](https://github.com/vscode-icons/vscode-icons):**
  - Files and folders get the icons VS Code users know.
  - When Claude picks up a file, the tree opens down to it, and the row shimmers while Claude works on it.
  - Changed files and folders are marked, and git-ignored entries are dimmed.
  - Each file shows its modified date or its size.
- **Search:** find any file in the project by name.
- **Commits:** when Claude runs `git commit`, the files it committed turn green and the card shows the commit hash.

| Colour | Means |
| --- | --- |
| Purple | Claude read it |
| Orange | Claude edited it |
| Yellow | Changed, not committed |
| Green | Committed by Claude |

## Install

At the prompt of a Claude Code session:

```
/plugin install files-pane --marketplace Marius-Adam/claude-files-pane
```

Answer `y` to add the `marius-adam` marketplace, then pick a scope (user scope gives you the pane in every project).

Or from a shell:

```bash
claude plugin install files-pane --marketplace Marius-Adam/claude-files-pane
```

Start a new session (or restart the desktop app) and the pane opens by itself.

## Use

- The pane opens when a session starts. Close it whenever you like; `/files` brings it back.
- Click a folder to open or close it. The toolbar under the search field has:
  - **Refresh**, which lists the files and reads git again.
  - **Collapse all**.
  - **Sizes / Dates**, to switch what the right-hand column shows.
  - **Show / Hide dotfiles**.
  - **Up a folder** and **Back to project**, to browse outside the project or come back to it.
- Type in **Find a file** to search the whole project, ignored files excluded.

### Where it runs

| Surface | What you see |
| --- | --- |
| Claude desktop app (Code tab), VS Code | The full pane: vscode-icons, rounded pills and rows, soft cards, animations |
| Terminal | The same information, with text chips (`TS`, `MD`, …) in place of icons |
| Mobile | The full pane without the search field, which the app doesn't draw yet |

It needs a Claude Code version that runs mods (plugins with a hooks module). It was built on Claude Code 2.1.

## Update and uninstall

```bash
claude plugin marketplace update marius-adam
```

```bash
claude plugin update files-pane@marius-adam
```

```bash
claude plugin uninstall files-pane@marius-adam
```

## What it does on your machine

The pane only reads. It watches Claude's `Read`, `Edit`, `Write`, `MultiEdit` and `NotebookEdit` calls to know which file is in hand, and spots `git commit` in Claude's Bash commands. Beyond that it lists folders, and in a git repository it runs these read-only git commands in the project:
- `rev-parse`
- `status`
- `diff --numstat`
- `rev-list --count`
- `ls-files`
- `show --name-only`

It never blocks or changes a tool call, writes no files, and sends nothing anywhere.

## Develop

```bash
git clone https://github.com/Marius-Adam/claude-files-pane.git
```

```bash
cd claude-files-pane
```

```bash
claude --plugin-dir .
```

That runs the pane from your clone. Useful commands in the folder:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
npx -p typescript tsc -p . --noEmit
```

Claude Code writes the API types into `.claude-plugin/types/` the first time it loads the mod, so run it once before type-checking.

| Path | What's there |
| --- | --- |
| `hooks/register.tsx` | The mod: the hooks, the state and the pane's drawing |
| `hooks/icons.ts` | Which icon a file or folder gets: exact name, then config prefix, then longest extension |
| `hooks/icon-svgs.ts` | The vscode-icons SVGs those tables use (generated) |
| `scripts/gen_icons.py` | Regenerates `icon-svgs.ts` after you add an icon to `icons.ts` |
| `types/index.d.ts` | The types of the state the pane keeps |
| `tests/files.test.tsx` | Tests, run on the terminal and desktop surfaces |

To add an icon, map a name, extension or folder to a vscode-icons id in `hooks/icons.ts` (the ids are listed at [icon-sets.iconify.design/vscode-icons](https://icon-sets.iconify.design/vscode-icons/)). Then regenerate:

```bash
npm pack @iconify-json/vscode-icons && tar xzf iconify-json-vscode-icons-*.tgz
```

```bash
python3 scripts/gen_icons.py package/icons.json hooks/icons.ts hooks/icon-svgs.ts
```

Issues and pull requests are welcome.

## Credits and license

MIT © Marius Adam. File and folder icons are from [vscode-icons](https://github.com/vscode-icons/vscode-icons) (MIT); see [LICENSE](LICENSE).
