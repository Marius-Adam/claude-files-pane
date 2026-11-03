# Security policy

## Supported versions

Only the version on `main`, which the marketplace installs, is supported. Update with the commands in the [README](README.md#installation).

## Reporting a vulnerability

Please report a vulnerability privately, never in a public issue or pull request: open the repository's **Security** tab and choose **Report a vulnerability**.

A report is most useful with the Claude Code and Files pane versions, your system, and the steps that show the problem. You will get an answer as soon as the maintainer can give one, and credit in the pull request that fixes it if you want it.

## What the pane runs

Files pane changes no file, and nothing it runs goes over the network but the one GitHub CLI command below. It writes to your prompt only when you press **@ Mention**. On your computer it runs:

- **git**, always with `--no-optional-locks`, so it never takes the index lock from Claude's own git.
  - In the repository the session started in (that folder, or any other in the same repository): `status`, `diff`, `ls-files`, `for-each-ref`, `rev-parse` and `symbolic-ref`, and it lists the worktree's git directory to see whether a rebase or merge is in progress. A repository's own config can make `status`, `diff` and `ls-files` run programs (`core.fsmonitor`, a clean filter, a textconv), so a project the tree follows Claude into gets none of these.
  - Outside it, only `rev-parse` and `show --name-only`, which run nothing from a repository's config: in the folder of a file Claude reads or edits, to find its repository, and in a folder Claude commits in, to see what the commit holds.
- **gh**, GitHub's CLI, where it is installed: `gh pr view --json number,url,state,isDraft,reviewDecision,statusCheckRollup`, to show the branch's pull request, its checks and its review. It runs only in the repository the session started in, as git's `status` does, since it reads that repository's config and runs git there. It asks GitHub with your own sign-in, and only for a branch it has not asked about yet, two minutes after it last asked (30 seconds while its checks run), on **↻ Refresh**, or after Claude runs `git push` or `gh pr create`, `merge`, `close`, `reopen`, `ready` or `edit`.
- **A look for editors**, once a session: on macOS `uname`, then `open -Ra` for each editor's app; on Linux `uname`, then `which` for each editor's command; on Windows `where` for each editor's command, and a read of that command's `.cmd` script.
- **What you press**, and only then: on **Open in**, `open -a` on macOS, the editor's command on Linux, and the editor's program on Windows, with no shell. On **Show in Finder**, `open -R`; on **Show in Explorer**, PowerShell starting Explorer, or Explorer alone where PowerShell cannot start.

## In scope

- Running a program or script the person did not ask for, for example through a repository's git config, a file or folder name, or a command Claude ran.
- Reading or revealing files outside what the pane shows.
- Anything the pane sends over the network beyond `gh pr view` above, which it should not do at all.
- Escaping or injecting into the terminal or the app through text the pane draws, such as file names, branch names or diffs.

## Out of scope

- Claude Code itself, or git. Report those to [Anthropic](https://www.anthropic.com/responsible-disclosure-policy) or to git.
- Git's own behaviour in the repository the session started in: running git there is how the pane works, and is the trust Claude Code already gives it.
