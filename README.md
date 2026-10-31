<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/Marius-Adam/claude-files-pane">
    <img src="docs/logo.svg" alt="An open folder, the Files pane's logo" width="80" height="80">
  </a>

  <h1 align="center">Files pane for Claude Code</h1>

  <p align="center">
    A file explorer plugin for Claude Code: see what Claude reads, edits and commits, live, in a VS Code-style file tree beside your chat.
    <br />
    <a href="#usage"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="docs/demo.gif">View Demo</a>
    &middot;
    <a href="https://github.com/Marius-Adam/claude-files-pane/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/Marius-Adam/claude-files-pane/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#faq">FAQ</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

[![The Files pane following Claude through a task: thinking, searching, reading and editing two files with the tree opening to each, running the tests, then committing][product-screenshot]](docs/demo.gif)

<sub>A scripted session in a made-up project, drawn from the pane's own output.</sub>

Files pane is a file explorer for Claude Code. While Claude works, it shows which files Claude is reading and editing right now, every file it touched this turn or this session, and what git thinks of them, in a project tree that looks like VS Code's. You see the changes as they happen instead of piecing them together from the chat or `git status` afterwards.

- **What Claude is doing, right now.** Its thinking as it streams, the command it runs, the file it reads or edits, then what the turn changed.
- **A file tree that follows Claude.** Folders open to each file Claude edits and its row shimmers, even in another project. A `..` row at the top climbs a folder, and **⌂ Project** in its header takes you home.
- **Every file Claude touched**, each row tinted by what Claude did with it and shimmering while it works on it, with the lines added and removed. **Whole session** keeps the earlier turns' files too.
- **A file's actions behind its ⋯**: put it in your prompt as `@path`, copy its path, see its **Diff** right under the row, or find it in the tree.
- **Git at a glance.** Branch, commits ahead, changed files and line counts; ignored files are dimmed.
- **VS Code's file icons and its kind of search**: type a few letters of a name, best matches first.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![TypeScript][TypeScript-shield]][TypeScript-url]
* [![Claude Code][ClaudeCode-shield]][ClaudeCode-url]
* [![vscode-icons][vscode-icons-shield]][vscode-icons-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

* Claude Code: the desktop app, the VS Code extension or the terminal.

### Installation

1. In a Claude Code session, install the plugin from this repository's marketplace:
   ```
   /plugin install files-pane --marketplace Marius-Adam/claude-files-pane
   ```
2. Restart Claude Code. The pane opens beside the chat.

To update it, or remove it:

```bash
claude plugin marketplace update marius-adam && claude plugin update files-pane@marius-adam
```

```bash
claude plugin uninstall files-pane@marius-adam
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

Work with Claude as usual; the pane follows along. Closed it? `/files` brings it back.

A file's row is tinted by what happened to it:

| Colour | Means |
| :-- | :-- |
| 🟣 Purple | Claude read it |
| 🟠 Orange | Claude edited it |
| 🟡 Yellow | Changed, not committed |
| 🟢 Green | Committed by Claude |

Press the ⋯ at the end of a file's row for its actions:

- **@ Mention** puts the file in your prompt as `@path`.
- **Copy path** copies its path, relative to the project.
- **Diff** shows what changed in it since the last commit, right under the row.
- **Show in tree**, from the touched list, opens the tree's folders down to the file and scrolls to it.

It works in the Claude desktop app and VS Code. In the terminal it draws the same pane with text in place of icons.

**Privacy.** The pane only looks. It reads folder listings and runs read-only git commands (`status`, `diff`, `rev-parse`, `ls-files`, `rev-list`, `show`) in your project. It never changes a tool call, writes no files and sends nothing anywhere. The one thing it writes is to your prompt box, when you choose **@ Mention** on a file.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- FAQ -->
## FAQ

**How do I see which files Claude Code is reading or editing?**
Install Files pane. It shows the file Claude has in hand right now, and lists every file it read or edited this turn, or this whole session, with the lines each edit added and removed.

**Is there a file explorer or file tree for Claude Code?**
Yes: Files pane adds a VS Code-style file tree beside the chat, with vscode-icons, search and git status. It opens its folders to each file Claude edits.

**Can I see a diff of what Claude Code changed?**
Yes. Press the ⋯ on a changed file and choose **Diff**: the change since the last commit shows right under the file's row.

**Does it work in the Claude desktop app, VS Code and the terminal?**
Yes, in all three. The desktop app and VS Code draw icons; the terminal draws the same pane with text.

**Does it change my files or run anything in my repository?**
No. It reads folder listings and runs read-only git commands, and only in the session's own repository: never in one it follows Claude into, nor one nested inside it. Every git command it runs leaves the index lock alone.

**How is it different from `git status`?**
`git status` tells you what changed once Claude is done. Files pane shows it as it happens, including the files Claude only read, which git never sees, and which turn touched each one.

**Do I need a git repository?**
No. Outside a repository the tree and the touched list work the same; the pane just has no git line.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

- [x] A live card of what Claude is doing
- [x] A VS Code-style tree that follows Claude, into other projects too
- [x] The files Claude touched, this turn and the whole session
- [x] File actions behind ⋯: mention, copy path, diff, show in tree
- [x] Git status, branch and line counts

See the [open issues][issues-url] for proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Contributions are welcome. If you have an idea that would make the pane better, fork the repo and open a pull request, or open an issue with the label "enhancement". And if it is useful to you, a star helps others find it.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add an amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a pull request

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
| `hooks/paths.ts` | Paths and sizes as the pane prints them, and how search ranks a file |
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

### Top contributors:

<a href="https://github.com/Marius-Adam/claude-files-pane/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Marius-Adam/claude-files-pane" alt="contrib.rocks image" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Marius Adam - [@Marius-Adam](https://github.com/Marius-Adam)

Project Link: [https://github.com/Marius-Adam/claude-files-pane](https://github.com/Marius-Adam/claude-files-pane)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [vscode-icons](https://github.com/vscode-icons/vscode-icons) (MIT), for the file and folder icons and the logo
* [Iconify](https://icon-sets.iconify.design/vscode-icons/), for the icons as a package
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template), for this README's shape
* [Shields.io](https://shields.io) and [contrib.rocks](https://contrib.rocks), for the badges and the contributors image

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/Marius-Adam/claude-files-pane.svg?style=for-the-badge
[contributors-url]: https://github.com/Marius-Adam/claude-files-pane/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Marius-Adam/claude-files-pane.svg?style=for-the-badge
[forks-url]: https://github.com/Marius-Adam/claude-files-pane/network/members
[stars-shield]: https://img.shields.io/github/stars/Marius-Adam/claude-files-pane.svg?style=for-the-badge
[stars-url]: https://github.com/Marius-Adam/claude-files-pane/stargazers
[issues-shield]: https://img.shields.io/github/issues/Marius-Adam/claude-files-pane.svg?style=for-the-badge
[issues-url]: https://github.com/Marius-Adam/claude-files-pane/issues
[license-shield]: https://img.shields.io/github/license/Marius-Adam/claude-files-pane.svg?style=for-the-badge
[license-url]: https://github.com/Marius-Adam/claude-files-pane/blob/main/LICENSE
[product-screenshot]: docs/demo.gif
[TypeScript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[ClaudeCode-shield]: https://img.shields.io/badge/Claude%20Code-D97757?style=for-the-badge&logo=claude&logoColor=white
[ClaudeCode-url]: https://claude.com/claude-code
[vscode-icons-shield]: https://img.shields.io/badge/vscode--icons-007ACC?style=for-the-badge
[vscode-icons-url]: https://github.com/vscode-icons/vscode-icons
