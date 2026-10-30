// What Claude is doing right now: a file in hand, another tool at work, thinking (with the tail of
// its thought as it streams), writing its answer, a turn's summary or a commit.
export type Now =
  | { verb: 'reading' | 'editing'; path: string }
  | { verb: 'working'; tool: string; title: string; detail: string }
  | { verb: 'thinking'; thought?: string }
  | { verb: 'writing'; text: string }
  | { verb: 'done'; edited: string[]; read: string[] }
  | { verb: 'committed'; hash: string; files: string[] }

// A folder opening in the tree: its rows appear one by one from `at`, its chevron turns.
export type Opening = { path: string; at: number; count: number }

// A file Claude touched this turn, its path relative to the working directory.
export type Touch = { path: string; isEdited: boolean; isActive: boolean; isCommitted: boolean }

// The pane's own controls: search text, the project shown (`root`, absolute; empty for the
// session's folder), the folder shown under it, open folders and toggles.
export type View = {
  query: string
  root: string
  dir: string
  expanded: string[]
  showSizes: boolean
  showHidden: boolean
}

// The branch, how far it is ahead of its upstream (null without one), the paths git reports as
// changed and their added and removed line counts, and what it ignores (a folder as `dir/`),
// all relative to the working directory.
export type Git = {
  branch: string
  ahead: number | null
  changed: string[]
  lines: Record<string, [number, number]>
  ignored: string[]
}

// The line at the foot of the pane while Claude commits, and the commit it made.
export type Status = { verb: 'committing' } | { verb: 'committed'; hash: string }

declare module 'claude-code' {
  interface PluginState {
    'files-pane': {
      now: Shaped<Now | null>
      touched: Shaped<Touch[]>
      view: Shaped<View>
      git: Shaped<Git | null>
      status: Shaped<Status | null>
      opening: Shaped<Opening | null>
      tick: number
    }
  }
}
