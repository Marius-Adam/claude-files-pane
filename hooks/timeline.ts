import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Change } from '../types'
import { changedBy } from './activity'
import { movesOf, snapshotOf } from './disk'
import type { Snapshot } from './disk'

// The values this file reads or writes. The engine's scan wants each made by `atom` in the file that
// uses it, so every file names its own; state.ts lists the tags they must all share.
const log = atom({ plugin: 'files-pane', key: 'log' } as const, [], { shape: 'log-1' })

// The session's timeline: every change to a file, in order, with who made it as far as the pane
// can tell (Change). Claude's edits and the files a command changes come from the tool calls; a
// change with no tool call running comes from a look at the repository against a baseline: the
// repository as Claude's last tool call and the last look left it.

// The timeline keeps this many changes, the newest.
const LOG = 300

// Tools that read and never write: a call to one moves nothing in the baseline.
const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'TodoRead', 'ToolSearch', 'AskUserQuestion', 'NotebookRead'])

export const isReadOnly = (tool: string) => READ_ONLY.has(tool)

export async function record($: EngineInterface, changes: Change[]) {
  if (changes.length > 0) await update($, log, old => [...old, ...changes].slice(-LOG))
}

// The repository as the last look or Claude's last tool call left it; null before the first look,
// or after one git did not answer.
let baseline: Snapshot | null = null
// Claude's tool calls running, and how many have begun: a look that spans one's start or end
// compares nothing, as what it read may be half Claude's.
let running = 0
let begun = 0

export function claudeStarts() {
  running++
  begun++
}

// A file as the baseline names it: itself, or the folder git tracks nothing in that holds it, as
// `dir/`; null when the snapshot names neither.
const keyIn = (snap: Snapshot, path: string) =>
  snap.files.has(path) ? path : ([...snap.files.keys()].find(key => key.endsWith('/') && path.startsWith(key)) ?? null)

// Claude's tool call has ended, having written nothing: a read, or a commit, whose moved HEAD the
// next look takes up.
export function claudeEnds() {
  running = Math.max(0, running - 1)
}

// Claude's tool call has ended, having changed `paths` (from the session's folder): they take their
// new state in the baseline, so a later look does not count them again, while a change of anyone
// else's to another file still shows at that look. `null`: what it changed is not known, and the
// baseline starts afresh at the next look.
export async function claudeWrote($: EngineInterface, paths: string[] | null) {
  try {
    if (paths === null) {
      baseline = null

      return
    }

    const after = await snapshotOf($, false).catch(() => null)

    if (!after || !baseline || baseline.git !== after.git) {
      baseline = after

      return
    }

    const files = new Map(baseline.files)

    for (const path of paths) {
      const key = keyIn(after, path) ?? keyIn(baseline, path) ?? path
      const stamp = after.files.get(key)

      if (stamp === undefined) files.delete(key)
      else files.set(key, stamp)
    }

    baseline = { git: after.git, files }
  } finally {
    running = Math.max(0, running - 1)
  }
}

// The baseline before anything changed: the repository as the session found it.
export async function startBaseline($: EngineInterface) {
  const at = begun
  const now = await snapshotOf($, false).catch(() => null)

  if (at === begun && running === 0 && baseline === null) baseline = now
}

// A tool call that may write, other than the Edit tools and Bash, whose own snapshots say what they
// changed: the files that differ from the baseline once it ends, counted as changed during it.
export async function afterTool($: EngineInterface, tool: string): Promise<string[]> {
  const after = await snapshotOf($, false).catch(() => null)
  const paths = changedBy(baseline, after)

  await record($, paths.map(path => ({ at: Date.now(), path, by: 'command', command: tool })))

  return paths
}

// A look at the repository with no tool call of Claude's running: each file whose state differs
// from the baseline changed outside Claude. A look that moved HEAD (a checkout, a pull) counts no
// file, as changedBy says, and starts the baseline afresh.
export async function lookOutside($: EngineInterface) {
  if (running > 0) return

  const at = begun
  const now = await snapshotOf($, false).catch(() => null)

  if (at !== begun || running > 0) return

  const was = baseline
  baseline = now

  await record($, changedBy(was, now).map(path => ({ at: Date.now(), path, by: 'outside', command: null })))
}

// How often the timeline checks whether the poll saw something move: a check that finds nothing
// reads nothing.
const WATCH_MS = 1000
let isWatching = false

export function watchOutside($: EngineInterface) {
  if (isWatching) return

  isWatching = true
  let seen = movesOf()
  const next = () =>
    $.clock.after(WATCH_MS, () => {
      const moves = movesOf()

      if (moves === seen) return next()

      seen = moves
      void lookOutside($)
        .catch(() => {})
        .then(next)
    })

  next()
}
