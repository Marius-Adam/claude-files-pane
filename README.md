<a id="readme-top"></a>

[![Claude Code mod][mod-shield]][mod-url]
[![Stars][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT license][license-shield]][license-url]

<br />
<div align="center">
  <img src="docs/logo.svg" alt="" width="80" height="80">

  <h3 align="center">Files pane for Claude Code</h3>

  <p align="center">
    See what Claude reads, edits and commits, live, in a VS Code-style file tree beside your chat.
    <br />
    <br />
    <a href="#about-the-project">View Demo</a>
    &middot;
    <a href="https://github.com/Marius-Adam/claude-files-pane/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/Marius-Adam/claude-files-pane/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#support">Support</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

<img src="docs/demo.gif" alt="The Files pane in the Claude desktop app, recorded as Claude fixes a bug in this repository: the files it reads turn purple in the touched list, the two it edits turn orange with their line counts, the card shows the test run, and a file's ⋯ menu offers Copy, Open in an editor and its diff, drawn as numbered rows" width="880">

- **Live card**: Claude's thinking, the command it runs, the file it reads or edits
- **Tree that follows Claude**: opens to each file it edits, even in another project
- **Touched list**: files read or edited this turn or session, with lines added and removed
- **Git**: branch, commits ahead, changed files, ignored files dimmed
- **Search** with VS Code's icons, best matches first
- Works in the desktop app, VS Code and the terminal

### Built With

[![TypeScript][ts-shield]][ts-url] [![Claude Code][mod-shield]][mod-url] [![vscode-icons][icons-shield]][icons-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

[Claude Code](https://claude.com/claude-code): the desktop app, the VS Code extension or the CLI.

### Installation

In the terminal:

```bash
claude plugin marketplace add Marius-Adam/claude-files-pane && claude plugin install files-pane@marius-adam
```

Or in a Claude Code session:

```
/plugin install files-pane --marketplace Marius-Adam/claude-files-pane
```

Restart Claude Code and the pane opens beside the chat.

To update or remove it later:

```bash
claude plugin marketplace update marius-adam && claude plugin update files-pane@marius-adam
```

```bash
claude plugin uninstall files-pane@marius-adam
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

- `/files` brings the pane back if you close it.
- Colours tell you what happened to a file: read **purple**, edited **orange**, uncommitted **yellow**, committed **green**.
- A file's **⋯** menu can `@`-mention it, copy its path, show its diff, reveal it in the tree, or open it in your editor or Finder.

**Privacy:** the pane is read-only. It lists folders, runs read-only git (`status`, `diff`, `rev-parse`, `ls-files`, `rev-list`, `show`) and checks which editors are installed. It sends nothing anywhere, writes to your prompt only on **@ Mention**, and opens an app only on **Open in** or **Show in Finder**.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are welcome. Fork the repo and open a pull request, or open an issue with the label "enhancement". If the pane is useful to you, a star helps others find it.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add an amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a pull request

### Develop

Run it from a clone, then check it before you push:

```bash
git clone https://github.com/Marius-Adam/claude-files-pane.git && cd claude-files-pane && claude --plugin-dir .
```

```bash
claude plugin validate . && claude plugin test .
```

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
| `tests/` | Tests, against the terminal and desktop surfaces |

To add an icon, map a name, extension or folder in `hooks/icons.ts` to a [vscode-icons](https://icon-sets.iconify.design/vscode-icons/) id, then:

```bash
npm pack @iconify-json/vscode-icons && tar xzf iconify-json-vscode-icons-*.tgz && python3 scripts/gen_icons.py package/icons.json hooks/icons.ts hooks/icon-svgs.ts
```

### Top contributors

<a href="https://github.com/Marius-Adam/claude-files-pane/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Marius-Adam/claude-files-pane" alt="contrib.rocks image" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Support

Files pane is free. If it saves you time, you can [buy me a coffee on Ko-fi](https://ko-fi.com/adamms).

Project link: [github.com/Marius-Adam/claude-files-pane](https://github.com/Marius-Adam/claude-files-pane)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

- [vscode-icons](https://github.com/vscode-icons/vscode-icons) (MIT) for the file and folder icons
- [Best-README-Template](https://github.com/othneildrew/Best-README-Template) for this README's layout

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[mod-shield]: https://img.shields.io/badge/Claude%20Code-mod-D97757?style=for-the-badge&logo=claude&logoColor=fff
[mod-url]: https://claude.com/claude-code
[stars-shield]: https://img.shields.io/github/stars/Marius-Adam/claude-files-pane?style=for-the-badge&color=555
[stars-url]: https://github.com/Marius-Adam/claude-files-pane/stargazers
[issues-shield]: https://img.shields.io/github/issues/Marius-Adam/claude-files-pane?style=for-the-badge&color=555
[issues-url]: https://github.com/Marius-Adam/claude-files-pane/issues
[license-shield]: https://img.shields.io/badge/license-MIT-555?style=for-the-badge
[license-url]: LICENSE
[ts-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[ts-url]: https://www.typescriptlang.org/
[icons-shield]: https://img.shields.io/badge/vscode--icons-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white
[icons-url]: https://github.com/vscode-icons/vscode-icons
