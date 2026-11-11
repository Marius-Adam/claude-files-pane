// What Claude is doing right now: a file in hand, another tool at work, thinking (with the tail of
// its thought as it streams), writing its answer, a turn's summary or a commit.
export type Now =
  | { verb: 'reading' | 'editing'; path: string }
  | { verb: 'working'; tool: string; title: string; detail: string }
  | { verb: 'thinking'; thought?: string }
  | { verb: 'writing'; text: string }
  | { verb: 'done'; edited: string[]; read: string[] }
  | { verb: 'committed'; hash: string; files: string[] }

// A file Claude touched this turn, its path relative to the working directory, and when Claude
// first touched it (milliseconds since the epoch).
export type Touch = { path: string; isEdited: boolean; isActive: boolean; isCommitted: boolean; at: number }

// The pane's own controls: search text, the project shown (`root`, absolute; empty for the
// session's folder), the folder shown under it, open folders and toggles. `changed` is null, or
// while the tree shows only git's changed files, the folders that filter opened, to close after.
export type View = {
  query: string
  root: string
  dir: string
  expanded: string[]
  showSizes: boolean
  showHidden: boolean
  changed: string[] | null
}

// The branch; its upstream (`set`, `unset` for a branch never pushed, `gone` once the branch it
// tracked was deleted, null for a detached HEAD or a branch with no commit yet) and how far the
// branch is ahead of it and behind it as of the last fetch (null without one); the repository a
// linked worktree belongs to (its folder's name; null outside one); a rebase, merge, cherry-pick,
// revert or bisect left in progress; the paths git reports as changed with the letter each one
// gets and their added and removed line counts, and what it ignores (a folder as `dir/`), all
// relative to the working directory.
export type Git = {
  branch: string
  upstream: 'set' | 'unset' | 'gone' | null
  ahead: number | null
  behind: number | null
  worktreeOf: string | null
  op: Op | null
  changed: string[]
  marks: Record<string, Mark>
  lines: Record<string, [number, number]>
  ignored: string[]
}

// What git is in the middle of, and for a rebase, which of its commits it is at out of how many.
export type Op = { verb: 'rebasing' | 'merging' | 'cherry-picking' | 'reverting' | 'bisecting'; step: [number, number] | null }

// The pull request GitHub's CLI finds for a branch: the branch it was asked for, its number, its
// page, where it stands, its checks counted by how each ended (or that it has not), and its review:
// approved, changes requested, or neither yet.
export type Pr = {
  branch: string
  number: number
  url: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  checks: { passed: number; failed: number; running: number }
  review: 'approved' | 'changes' | null
}

// What git sees in a changed file, as VS Code's explorer letters it: modified, added, deleted,
// renamed, untracked, or in conflict.
export type Mark = 'M' | 'A' | 'D' | 'R' | 'U' | 'C'

// The line at the foot of the pane while Claude commits, and the commit it made.
export type Status = { verb: 'committing' } | { verb: 'committed'; hash: string }

// The diff open under a file's row: the file, absolute, its unified-diff hunks since HEAD, and how
// many lines were left out past the pane's limit.
export type Diff = { path: string; text: string; more: number }

// The file whose actions are open under its row (its ⋯ pressed), absolute, which list the row is
// in (the tree, search's matches or the files Claude touched), and the submenu open in them, if any.
export type Menu = { path: string; where: 'tree' | 'match' | 'touched'; sub: 'copy' | 'open' | null }

// What the touched list shows: this turn's files, or every file Claude touched this session.
export type Scope = 'turn' | 'session'

// The file open in the file pane, absolute, and what it shows: the file (as source, or for
// Markdown as a preview), its diff since HEAD, or its history, with the commit opened there.
export type Opened = { path: string; tab: 'file' | 'diff' | 'history'; isPreview: boolean; commit: string | null }

// A file's text as the file pane shows it, cut at the end of a line, with how many lines were left
// out; or why it shows none.
export type FileText = { text: string; more: number } | { reason: 'binary' | 'large' | 'unreadable' }

// A change to a file, as the session saw it: when, the file (from the session's folder, as the
// touched list spells it), and who made it as far as the pane can tell. `claude`: Claude's Edit or
// Write. `command`: the file changed while a tool call other than those ran, its first line in
// `command`; that was most likely the command, but a save of yours in those seconds counts too, so
// it's never said to be Claude's. `outside`: it changed with no tool call of Claude's running, by
// you or another program.
export type Change = { at: number; path: string; by: 'claude' | 'command' | 'outside'; command: string | null }

// A picture as the file pane previews it: an SVG's markup, from its `<svg` on; or a PNG, JPEG,
// GIF or WebP, its type, its pixels' width and height (0 where the header gave none), its size on
// the disk and when it last changed, and its bytes in base64 unless past what a preview draws.
// Or why it shows none.
export type Picture =
  | { kind: 'svg'; markup: string }
  | { kind: 'raster'; type: 'png' | 'jpeg' | 'gif' | 'webp'; width: number; height: number; bytes: number; mtimeMs: number; base64: string | null }
  | { reason: 'large' | 'unreadable' }

// A commit that changed a file: its short hash, author, when (milliseconds since the epoch), its
// first line, and the file's path then, from the repository's top (it may have been renamed since).
export type Commit = { hash: string; author: string; at: number; subject: string; path: string }

declare module 'claude-code' {
  interface PluginState {
    'files-pane': {
      now: Shaped<Now | null>
      touched: Shaped<Touch[]>
      earlier: Shaped<Touch[]>
      scope: Shaped<Scope>
      // Whether the touched list shows every file, past the newest few it shows by itself.
      isTouchedAll: boolean
      view: Shaped<View>
      git: Shaped<Git | null>
      pr: Shaped<Pr | null>
      diff: Shaped<Diff | null>
      menu: Shaped<Menu | null>
      status: Shaped<Status | null>
      tick: number
      opened: Shaped<Opened | null>
      log: Shaped<Change[]>
      // Whether the timeline under the touched list is open.
      isLogShown: boolean
    }
  }
}
