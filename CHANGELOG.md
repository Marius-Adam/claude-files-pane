# Changelog

Each release of Files pane, newest first. The version is the one in [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json), and each has a [GitHub release](https://github.com/Marius-Adam/claude-files-pane/releases).

## [Unreleased]

### Added

- **A timeline of the session's changes.** Under the touched list, **Show** opens every change to a file this session, newest first, with its time and who made it: **Claude** (its Edit or Write), **Command** (the file changed while a command ran, with the command, since a save of yours in those seconds would look the same), or **Outside** (no tool call of Claude's was running: you, or another program). A press on a file opens its diff. Idea from Reddit. (#54)

## [1.0.0] - 2026-11-08

The pane now does more than show you files. You can open a file to see its text, diff and history, follow the branch's pull request and its checks, and see changes from your editor or terminal as they happen.

### Added

- **Open a file in its own pane.** Press a file in the tree, the touched list or search. It opens beside the Files pane with three tabs:
  - **File:** its text with line numbers. A Markdown file opens as a preview, with its source one press away.
  - **Diff:** what changed since the last commit.
  - **History:** the commits that changed it. Press one to see what it changed in the file.
  
  In VS Code, open it from the file's **⋯**. (#44)
- **The branch's pull request in the branch row.** It's coloured by whether it's open, a draft, merged or closed, and a press opens it. An open pull request also shows its checks (failing, running or passing) and its review (approved or changes requested). While checks run, the pane asks again every 30 seconds until they end. This needs [GitHub's CLI](https://cli.github.com) signed in; without it, nothing shows. (#41, #42)
- **More in the branch row:** how far the branch is behind its upstream, "not pushed" for a branch with no upstream, "upstream gone" once the remote branch is deleted, "worktree of <repo>" in a linked worktree, and a rebase, merge, cherry-pick, revert or bisect in progress, with a rebase's step and the number of conflicted files. (#41, #42)
- **Changes made outside Claude show within seconds.** A file you make in your editor or a branch you check out in a terminal shows up within a few seconds while the pane is in sight. Before, it waited for Claude's next tool call or a press on Refresh. (#44)
- **Files a command changes count as Claude's edits.** A `sed`, a script, a formatter or a conflict Claude resolves by hand now turns the file orange in the touched list, as an Edit does. Files git brings in by moving HEAD, stashing, or starting or ending a merge or rebase are not counted. (#45)

### Changed

- **Folders work as in VS Code.** One click opens or closes a folder, and a double click goes into it. The tree's first row names the folder you're in, and **↑ Up** leads to the folder above. This replaces the **..** row from 0.9.0. (#43, #44)
- **A folder git tracks nothing in counts as one change**, as `git status` shows it, and it and everything in it are marked **U**. In a repository with generated output this took "38426 changed" down to the real 11, and each look at git from about 95 ms to 22 ms. (#45)
- System files (`.DS_Store`, `__MACOSX`, `Thumbs.db`, `desktop.ini`) are hidden everywhere, and the folders of other version control systems (`.svn`, `.hg`, `CVS`) are never counted or searched. (#44)
- Names sort as a person reads them: `file2` before `file10`. (#44)
- Every row lights the same way under the pointer, whole, with its **⋯** kept separate. Indents are smaller. (#44, #45)

### Fixed

- A long-lived branch such as `staging` no longer shows a pull request merged from it long ago. A merged or closed pull request shows only until the branch gains a commit the pull request never had. (#46)
- The pull request's label opens its link on the desktop, and is as tall as the labels beside it. (#44, #45)
- A row under a resting pointer no longer flickers while Claude is writing. (#45)
- After going into `.git`, the top of the tree no longer reads `.. files-pane`, as if it still showed the project. (#43)

### Security

[SECURITY.md](SECURITY.md#what-the-pane-runs) lists each new command and when it runs: `gh pr view`, the only one that reaches the network, `git for-each-ref`, `git merge-base --is-ancestor`, `git log --follow` and `git show` for a file's history, and the `git status` and `git diff --numstat` that watch for outside changes. All of them run only in the session's own repository.

## [0.9.0] - 2026-11-03

- **Go into a folder.** A press on an open folder goes into it, and the **..** row, named for the folder above, leads back. (#37)
- **N changed** shows only the files git reports changed, in their folders. (#34)
- Git shows in a repository with no commit yet, and on a detached HEAD. (#35)
- [SECURITY.md](SECURITY.md) lists every command the pane runs, and says how to report a vulnerability. (#36)
- The README names the oldest supported Claude Code (2.1.299), adds troubleshooting, and says the pane costs no tokens. (#33, #36)
- CI also tests on the oldest supported Claude Code. (#31)

## Earlier

Versions 0.5.0 to 0.8.2 (30 October to 1 November 2026) were released without notes. Their history is in the [commit log](https://github.com/Marius-Adam/claude-files-pane/commits/main).

[1.0.0]: https://github.com/Marius-Adam/claude-files-pane/compare/v0.9.0...release/1.0.0
[0.9.0]: https://github.com/Marius-Adam/claude-files-pane/releases/tag/v0.9.0
