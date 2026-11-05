import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Commit, FileText, Git, Mark, Op, Pr } from '../types'
import { base, dirOf, join, listPath, slashed, unfiltered } from './paths'
import { DEFAULT_VIEW } from './state'

// The values this file reads or writes. The engine's scan wants each made by `atom` in the file that
// uses it, so every file names its own; state.ts lists the tags they must all share.
const git = atom({ plugin: 'files-pane', key: 'git' } as const, null, { shape: 'git-6' })
const pr = atom({ plugin: 'files-pane', key: 'pr' } as const, null, { shape: 'pr-2' })
const view = atom({ plugin: 'files-pane', key: 'view' } as const, DEFAULT_VIEW, { shape: 'view-4' })
const opened = atom({ plugin: 'files-pane', key: 'opened' } as const, null, { shape: 'opened-1' })

// What the pane reads of the disk: git's view of the project shown, the branch's pull request,
// folder listings and the file index search walks. All of it read-only: listings, and git and
// GitHub CLI commands that change nothing, run only where the session's own repository is
// (isTrusted).

// A version control system's own folders: listed only with Dotfiles on, and never counted or searched.
export const SKIP = new Set(['.git', '.svn', '.hg', 'CVS'])

// What an operating system leaves in folders for itself, shown nowhere, as VS Code and the app hide it.
export const JUNK = new Set(['.DS_Store', '__MACOSX', 'Thumbs.db', 'desktop.ini'])

// A pane draws again only when asked: every write ends with this.
export function redraw($: EngineInterface) {
  return $.ui.invalidate('ui.render')
}

// Git never takes the index lock for the pane (as VS Code runs it), so a read here cannot make
// Claude's own `git commit` fail on `index.lock`.
export function run($: EngineInterface, argv: string[], timeoutMs = 10000, cwd?: string) {
  const [bin, ...args] = argv
  const line = bin === 'git' ? [bin, '--no-optional-locks', ...args] : argv

  return $.process.run(line, { timeoutMs, ...(cwd ? { cwd } : {}) }).catch(() => null)
}

// The session's folder, slashed: every path the pane holds is spelled so (see paths.ts).
export function sessionDir($: EngineInterface) {
  return $.session.cwd().then(slashed)
}

// The folder git names on the first line it prints (`--show-toplevel`, `--absolute-git-dir`),
// slashed; null when it failed or names none.
export const gitPath = (out: Awaited<ReturnType<typeof run>>) => (out && out.exitCode === 0 ? slashed(out.stdout.trim()) || null : null)

// A repository's own config can make git run programs of its choosing (core.fsmonitor, a clean
// filter, a textconv) on `status`, `diff` and `ls-files`, and no flag turns them all off. So
// those run only in the session's own repository, which the person trusted by working in it and
// where Claude Code runs git already: a folder whose git directory is the session folder's. A
// project the tree follows Claude into, or a repository nested inside the session's, gets no git.
// (`rev-parse` reads the config but runs nothing from it.)
const gitDirs = new Map<string, Promise<string | null>>()

function gitDirOf($: EngineInterface, dir: string) {
  let found = gitDirs.get(dir)

  if (!found) {
    // Kept only once git has answered: a run that timed out or could not start asks again next time.
    found = run($, ['git', 'rev-parse', '--absolute-git-dir'], 3000, dir).then(out => {
      if (!out) gitDirs.delete(dir)

      return gitPath(out)
    })
    gitDirs.set(dir, found)
  }

  return found
}

// Whether git may run in `dir` (absolute; the session's folder when empty).
export async function isTrusted($: EngineInterface, dir = ''): Promise<boolean> {
  const cwd = await sessionDir($).catch(() => '')

  if (!cwd) return false
  if (!dir || dir === cwd) return true

  const [own, at] = await Promise.all([gitDirOf($, cwd), gitDirOf($, dir)])

  return own !== null && at === own
}

// Git's NUL-separated output (`-z`), whose paths come raw, never quoted or escaped. A newline
// separates too, so the output of a git that ignored `-z` still reads.
const fieldsOf = (stdout: string | undefined) => (stdout ?? '').split(/\0|\n/)

// The letter for git's two-letter status, `XY` (staged, then in the working tree): a conflict
// first, since both sides changed it, then what happened to the file, or M for a plain change. A
// file added with `git add -N` is ` A`: its A is on the working tree's side.
const markOf = (xy: string): Mark => {
  if (xy === '??') return 'U'
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'C'
  if (xy.includes('D')) return 'D'
  if (/[RC]/.test(xy)) return 'R'
  if (xy.includes('A')) return 'A'

  return 'M'
}

// The commit HEAD names in `cwd`, short; null where there is none.
export async function headOf($: EngineInterface, cwd: string) {
  const head = await run($, ['git', 'rev-parse', '--short', 'HEAD'], 5000, cwd)

  return head && head.exitCode === 0 ? head.stdout.trim() || null : null
}

type Entry = Awaited<ReturnType<EngineInterface['fs']['list']>>[number]

// Folder listings, kept between redraws: the pane draws several times a second while Claude
// streams, and the folders have not changed. Keyed by absolute path; a failed listing is not kept.
const listings = new Map<string, Promise<Entry[]>>()

export function listDir($: EngineInterface, path: string) {
  let listing = listings.get(path)

  if (!listing) {
    listing = $.fs.list(path).catch(() => {
      listings.delete(path)

      return []
    })
    listings.set(path, listing)
  }

  return listing
}

// The branch, where the folder sits in its repository (`sub/`, or nothing at the top), and whether
// HEAD is detached; null outside a repository. `--abbrev-ref` reads HEAD's commit, which a repository without one yet does
// not have: then the branch is the one HEAD names. A detached HEAD names no branch, only its commit.
async function placeOf($: EngineInterface, at: string | undefined) {
  const head = await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD', '--show-prefix'], 5000, at)

  if (head && head.exitCode === 0) {
    const [branch = '', prefix = ''] = head.stdout.split('\n')

    const isDetached = branch === 'HEAD'

    return { branch: isDetached ? ((await headOf($, at ?? '')) ?? branch) : branch, prefix, isDetached }
  }

  const [unborn, place] = await Promise.all([
    run($, ['git', 'symbolic-ref', '--short', '-q', 'HEAD'], 5000, at),
    run($, ['git', 'rev-parse', '--show-prefix'], 5000, at),
  ])

  if (!unborn || unborn.exitCode !== 0 || !place || place.exitCode !== 0) return null

  return { branch: unborn.stdout.trim(), prefix: place.stdout.split('\n')[0] ?? '', isDetached: false }
}

// The worktree's own git directory and the one its worktrees share (`--git-dir --git-common-dir`),
// absolute; empty with a git too old for `--path-format` (2.31).
function gitDirsOf(dirs: Awaited<ReturnType<typeof run>>) {
  const [own = '', shared = ''] = dirs && dirs.exitCode === 0 ? dirs.stdout.split('\n').map(line => slashed(line.trim())) : []

  return { own, shared }
}

// The repository a linked worktree belongs to, by its folder's name. Its own git directory and the
// shared one differ only in a linked worktree, whose own sits under the shared one's `worktrees/`.
// A repository's shared one is `repo/.git`, or for a bare one `repo.git`. Null in the main worktree.
function worktreeOf({ own, shared }: { own: string; shared: string }) {
  if (!own || !shared || own === shared) return null

  return base(shared) === '.git' ? base(dirOf(shared)) : base(shared).replace(/\.git$/, '')
}

// The branch's upstream and how far apart the two are, from `for-each-ref`'s
// `%(upstream)%00%(upstream:track,nobracket)`: the upstream's ref, then `ahead 1, behind 2`, or
// `gone` once it was deleted, or nothing when they are level. A branch with no commit yet is no ref,
// and prints nothing at all; a detached HEAD is never asked.
function trackOf(out: Awaited<ReturnType<typeof run>>): Pick<Git, 'upstream' | 'ahead' | 'behind'> {
  const [ref, track = ''] = out && out.exitCode === 0 && out.stdout.trim() ? out.stdout.trim().split('\0') : []
  const count = (pattern: RegExp) => Number(track.match(pattern)?.[1] ?? 0)

  if (ref === undefined) return { upstream: null, ahead: null, behind: null }
  if (!ref) return { upstream: 'unset', ahead: null, behind: null }
  if (track === 'gone') return { upstream: 'gone', ahead: null, behind: null }

  return { upstream: 'set', ahead: count(/ahead (\d+)/), behind: count(/behind (\d+)/) }
}

// What git was left in the middle of, from the files it keeps in the worktree's own git directory
// while it is: a rebase's step counts there too (`msgnum` of `end`, or `next` of `last`).
const OPS: [string, Op['verb']][] = [
  ['rebase-merge', 'rebasing'],
  ['rebase-apply', 'rebasing'],
  ['MERGE_HEAD', 'merging'],
  ['CHERRY_PICK_HEAD', 'cherry-picking'],
  ['REVERT_HEAD', 'reverting'],
  ['BISECT_LOG', 'bisecting'],
]

async function opOf($: EngineInterface, gitDir: string): Promise<Op | null> {
  if (!gitDir) return null

  const names = new Set((await $.fs.list(gitDir).catch(() => [])).map(entry => entry.name))
  const [name, verb] = OPS.find(([one]) => names.has(one)) ?? []

  if (!name || !verb) return null

  const steps = name === 'rebase-merge' ? ['msgnum', 'end'] : name === 'rebase-apply' ? ['next', 'last'] : null
  const [at, of] = steps ? await Promise.all(steps.map(file => $.fs.read(join(gitDir, `${name}/${file}`)).then(Number, () => NaN))) : []

  return { verb, step: at && of ? [at, of] : null }
}

// Git as the project shown sees it: `root`, or the session's folder when empty. Paths come
// relative to that folder, as the tree spells them.
async function readGit($: EngineInterface, root: string): Promise<Git | null> {
  if (root && !(await isTrusted($, root))) return null

  const at = root || undefined
  const where = await placeOf($, at)

  if (!where) return null

  const { branch, prefix, isDetached } = where
  const [state, numstat, track, dirs, ignored] = await Promise.all([
    run($, ['git', 'status', '--porcelain', '-z', '-uall'], 10000, at),
    run($, ['git', 'diff', '--numstat', '-z', '--relative', 'HEAD'], 10000, at),
    isDetached ? null : run($, ['git', 'for-each-ref', '--format=%(upstream)%00%(upstream:track,nobracket)', `refs/heads/${branch}`], 5000, at),
    run($, ['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], 5000, at),
    // `--directory` names an ignored folder once, as `node_modules/`, not every file in it.
    run($, ['git', 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], 10000, at),
  ])

  // `XY path` from the repository's top; a rename or a copy names where it came from next.
  const changed: string[] = []
  const marks: Record<string, Mark> = {}
  const states = fieldsOf(state?.stdout)

  for (let i = 0; i < states.length; i++) {
    const field = states[i]!

    if (field.length < 4) continue
    if (/^[RC]/.test(field)) i++

    const path = field.slice(3)

    if (path.startsWith(prefix)) {
      changed.push(path.slice(prefix.length))
      marks[path.slice(prefix.length)] = markOf(field.slice(0, 2))
    }
  }

  // `added removed path`, or for a rename `added removed` and then its old and new paths.
  const lines: Record<string, [number, number]> = {}
  const counts = fieldsOf(numstat?.stdout)

  for (let i = 0; i < counts.length; i++) {
    const [added, removed, named] = counts[i]!.split('\t')

    if (named === undefined) continue

    const path = named === '' ? counts[(i += 2)] : named

    // A binary file counts as `-`: it has no lines to show.
    if (path && /^\d+$/.test(added ?? '') && /^\d+$/.test(removed ?? '')) lines[path] = [Number(added), Number(removed)]
  }

  const gitDirs = gitDirsOf(dirs)

  return {
    branch: branch.trim(),
    ...trackOf(track),
    worktreeOf: worktreeOf(gitDirs),
    op: await opOf($, gitDirs.own),
    changed,
    marks,
    lines,
    ignored: fieldsOf(ignored?.stdout).filter(Boolean).slice(0, 2000),
  }
}

// What a command may change, as it stood, to compare after it with before: `git` is where git
// stood (the commit HEAD names, the newest stash, what git is in the middle of), and
// `files` each file git reports as changed under the session's folder, by its path from there,
// with its size and time on the disk, or `gone`. A file git reports as unchanged is in neither.
export type Snapshot = { git: string; files: Map<string, string> }

// Past this many changed files a command is not looked at: each would be one more read of the disk.
const SNAPSHOT_FILES = 1000

// The paths in `git status --porcelain=v2 -z` entries, from the repository's top: a changed file's
// (`1`), a renamed one's (`2`, its old path in the next field, skipped), a conflicted one's (`u`)
// and an untracked one's (`?`), each after its fixed run of fields. The `#` headers go to `heads`.
function pathsOfV2(fields: string[], heads: string[]) {
  const paths: string[] = []
  const SKIP: Record<string, number> = { '1': 8, '2': 9, u: 10, '?': 1 }

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    const skip = SKIP[field[0] ?? '']

    if (field.startsWith('# ')) heads.push(field)
    else if (skip !== undefined && field[1] === ' ') paths.push(field.split(' ').slice(skip).join(' '))
    if (field.startsWith('2 ')) i++
  }

  return paths
}

// The session's repository as a command may leave it (Snapshot), read in the session's folder
// only. Null where git did not answer in time, or reports more than SNAPSHOT_FILES changed: the
// command is then not looked at. Bounded to a few seconds, as it stands before Claude's command.
export async function snapshotOf($: EngineInterface): Promise<Snapshot | null> {
  const cwd = await sessionDir($)
  const [state, dirs, stash] = await Promise.all([
    run($, ['git', 'status', '--porcelain=v2', '--branch', '-z', '-uall'], 3000),
    // The session's folder within the repository (`sub/`, or nothing at its top), as readGit takes
    // it: a folder reached through a link has another spelling than the top git names.
    run($, ['git', 'rev-parse', '--absolute-git-dir', '--show-prefix'], 3000),
    // The newest stash's commit, or nothing: a stash or a pop moves it, on any git.
    run($, ['git', 'for-each-ref', '--format=%(objectname)', 'refs/stash'], 3000),
  ])

  if (!cwd || !state || state.exitCode !== 0 || !dirs || dirs.exitCode !== 0 || !stash || stash.exitCode !== 0) return null

  const [gitDir = '', prefix = ''] = dirs.stdout.split('\n').map(line => line.trim())
  const heads: string[] = []
  const paths = pathsOfV2(fieldsOf(state.stdout), heads).flatMap(path => (path.startsWith(prefix) ? [path.slice(prefix.length)] : []))

  if (paths.length > SNAPSHOT_FILES) return null

  const op = await opOf($, slashed(gitDir))
  const stamps = await Promise.all(
    paths.map(path =>
      $.fs.stat(join(cwd, path)).then(
        stat => `${stat.size}\0${stat.mtimeMs}`,
        () => 'gone',
      ),
    ),
  )
  const where = [...heads.filter(head => head.startsWith('# branch.oid ')), stash.stdout.trim(), op ? `${op.verb} ${op.step?.join('/') ?? ''}` : '']

  return { git: where.join('\0'), files: new Map(paths.map((path, i) => [path, stamps[i]!])) }
}

// Git's state in two commands, for comparing, not reading: the branch, its commit and how far it
// is from its upstream, each changed file's state, and the lines changed in each. Null where git
// may not run or did not answer.
async function printOf($: EngineInterface, root: string): Promise<string | null> {
  if (root && !(await isTrusted($, root))) return null

  const at = root || undefined
  const [state, numstat] = await Promise.all([
    run($, ['git', 'status', '--porcelain=v2', '--branch', '-z', '-uall'], 10000, at),
    run($, ['git', 'diff', '--numstat', '-z', 'HEAD'], 10000, at),
  ])

  return state && state.exitCode === 0 ? `${state.stdout}\0\0${numstat?.stdout ?? ''}` : null
}

// How long a pull request found stands before git's next read asks GitHub again, as one can be
// merged or closed outside the session. While its checks run, it is asked again this often by
// itself, with or without a read, until they end.
const PR_MS = 2 * 60 * 1000
const PR_RUNNING_MS = 30 * 1000

// Which branch the pull request was last asked for (`root` and the branch, NUL between), when, and
// the wait before it is asked again while its checks run.
let prAsked = ''
let prAt = 0
let prAgain: { cancel: () => void } | null = null

const PR_STATES: Record<string, Pr['state']> = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' }
const REVIEWS: Record<string, Pr['review']> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes' }

// The branch's pull request, as GitHub's CLI finds it. It is asked over the network, so never on
// git's own read: only for a branch not asked for yet, once PR_MS have passed, or when Claude's
// command may have changed it (refreshGit's `isPrChanged`). Null without `gh`, signed out, outside
// GitHub or with no pull request; a lookup a newer one overtook writes nothing.
async function lookUpPr($: EngineInterface, root: string, branch: string | null) {
  const asked = branch === null ? '' : `${root}\0${branch}`

  if (asked === prAsked && Date.now() - prAt < PR_MS) return

  prAsked = asked
  prAt = Date.now()
  prAgain?.cancel()
  prAgain = null

  const found = branch === null ? null : await prOf($, root, branch)

  if (prAsked !== asked) return

  await update($, pr, () => found)
  redraw($)

  if (found?.checks.running && (found.state === 'open' || found.state === 'draft')) {
    prAgain = $.clock.after(PR_RUNNING_MS, () => {
      if (prAsked !== asked) return

      prAt = 0
      void lookUpPr($, root, branch).catch(() => {})
    })
  }
}

// A check as `statusCheckRollup` lists it: a GitHub Actions job or app check (CheckRun), or a
// commit status another service set (StatusContext).
type Check = {
  __typename?: string
  name?: string
  workflowName?: string
  status?: string
  conclusion?: string
  context?: string
  state?: string
  startedAt?: string
}

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])

// The checks counted by how they ended. A check run again is listed once a run: only its latest
// counts. A skipped one is not counted.
function checksOf(rollup: unknown): Pr['checks'] {
  const latest = new Map<string, Check>()

  for (const check of Array.isArray(rollup) ? (rollup as Check[]) : []) {
    const name = check.__typename === 'StatusContext' ? (check.context ?? '') : `${check.workflowName ?? ''}/${check.name ?? ''}`
    const seen = latest.get(name)

    if (!seen || (check.startedAt ?? '') >= (seen.startedAt ?? '')) latest.set(name, check)
  }

  const checks = { passed: 0, failed: 0, running: 0 }

  for (const check of latest.values()) {
    const ended = check.__typename === 'StatusContext' ? check.state : check.status === 'COMPLETED' ? check.conclusion : undefined

    if (ended === undefined || ended === 'PENDING' || ended === 'EXPECTED') checks.running++
    else if (FAILED.has(ended)) checks.failed++
    else if (ended !== 'SKIPPED') checks.passed++
  }

  return checks
}

async function prOf($: EngineInterface, root: string, branch: string): Promise<Pr | null> {
  const out = await $.process
    .run(['gh', 'pr', 'view', '--json', 'number,url,state,isDraft,reviewDecision,statusCheckRollup'], {
      timeoutMs: 10000,
      env: { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
      ...(root ? { cwd: root } : {}),
    })
    .catch(() => null)

  if (!out || out.exitCode !== 0) return null

  try {
    const { number, url, state, isDraft, reviewDecision, statusCheckRollup } = JSON.parse(out.stdout) as Record<string, unknown>

    if (typeof number !== 'number' || typeof url !== 'string' || typeof state !== 'string' || !PR_STATES[state]) return null

    return {
      branch,
      number,
      url,
      state: isDraft === true && state === 'OPEN' ? 'draft' : PR_STATES[state],
      checks: checksOf(statusCheckRollup),
      review: (typeof reviewDecision === 'string' && REVIEWS[reviewDecision]) || null,
    }
  } catch {
    return null
  }
}

// Reads git again for the project shown, and asks for the branch's pull request when lookUpPr
// would; `isPrChanged` asks for it now. A call while a read runs is folded into one more read
// after it, so a burst of tool calls costs two reads, not one each.
let reading: Promise<void> | null = null
let isStale = false

export function refreshGit($: EngineInterface, isPrChanged = false): Promise<void> {
  if (isPrChanged) prAsked = ''

  if (reading) {
    isStale = true

    return reading
  }

  // Never rejects: callers start it without waiting, and a session that has ended answers nothing.
  reading = (async () => {
    do {
      isStale = false
      const { root } = await read($, view)
      const next = await readGit($, root)
      await update($, git, () => next)
      void lookUpPr($, root, next?.branch ?? null).catch(() => {})
      // With nothing changed left, the tree showing only changed files shows the whole tree again.
      if (!next?.changed.length) await update($, view, unfiltered)
      redraw($)
    } while (isStale)
  })()
    .catch(() => {})
    .finally(() => {
      reading = null
    })

  return reading
}

// Every file in the project shown, for search: git's list, else a bounded walk.
let fileIndex: string[] | null = null
let fileIndexRoot = ''

// `home` is the project shown, absolute.
export async function indexFiles($: EngineInterface, home: string): Promise<string[]> {
  if (fileIndex && fileIndexRoot === home) return fileIndex

  fileIndexRoot = home
  const listed = (await isTrusted($, home)) ? await run($, ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], 10000, home) : null

  if (listed && listed.exitCode === 0) {
    fileIndex = fieldsOf(listed.stdout).filter(path => path && !JUNK.has(base(path)))

    return fileIndex
  }

  const found: string[] = []
  const queue = ['']

  while (queue.length > 0 && found.length < 5000) {
    const dir = queue.shift()!
    const entries = await $.fs.list(listPath(home, dir)).catch(() => [])

    for (const entry of entries) {
      if (SKIP.has(entry.name) || JUNK.has(entry.name) || entry.name === 'node_modules') continue
      if (entry.kind === 'dir') queue.push(join(dir, entry.name))
      else found.push(join(dir, entry.name))
    }
  }

  fileIndex = found

  return found
}

// What the pane holds of the disk, dropped whenever it may have changed: search's index, the
// tree's listings and what the file pane read.
export const forget = () => {
  fileIndex = null
  listings.clear()
  readings.clear()
}

// What the file pane read (a file's text, its diff, its history, a commit's change to it), kept
// between redraws by what was asked, as the tree's listings are; a failed read is not kept.
const readings = new Map<string, Promise<unknown>>()

function kept<T>(key: string, readIt: () => Promise<T>): Promise<T> {
  let reading = readings.get(key) as Promise<T> | undefined

  if (!reading) {
    reading = readIt().catch(error => {
      readings.delete(key)
      throw error
    })
    readings.set(key, reading)
  }

  return reading
}

// The file pane shows a file's text up to this many characters (a drawing draws 100000 in all),
// and none past FILE_BYTES on the disk.
const FILE_CHARS = 90000
const FILE_BYTES = 2 * 1024 * 1024

// A file's text, cut at the end of a line within FILE_CHARS, with how many lines were left out.
export function textOf($: EngineInterface, abs: string): Promise<FileText> {
  return kept(`text\0${abs}`, async (): Promise<FileText> => {
    const stat = await $.fs.stat(abs).catch(() => null)

    if (!stat || stat.kind !== 'file') return { reason: 'unreadable' }
    if (stat.size > FILE_BYTES) return { reason: 'large' }

    const text = await $.fs.read(abs).catch(() => null)

    if (text === null) return { reason: 'unreadable' }
    // A NUL is what git, too, takes for a binary file.
    if (text.includes('\0')) return { reason: 'binary' }

    // Windows' line ends read as one, and no control character reaches the drawing but tab and
    // newline: an escape in a file must not reach a terminal.
    const lines = printable(text.replace(/\r\n?/g, '\n')).replace(/\n$/, '')

    if (lines.length <= FILE_CHARS) return { text: lines, more: 0 }

    const cut = lines.slice(0, lines.lastIndexOf('\n', FILE_CHARS))

    return { text: cut, more: lines.slice(cut.length + 1).split('\n').length }
  })
}

// The file pane's diffs: as the ⋯'s, with room for more lines, within what a drawing draws.
const PANE_DIFF = { lines: 2000, chars: FILE_CHARS }

export function keptDiffOf($: EngineInterface, abs: string) {
  return kept(`diff\0${abs}`, () => diffOf($, abs, PANE_DIFF))
}

// The file's history, newest first, at most HISTORY commits, through renames. Null outside the
// session's repository: see isTrusted.
const HISTORY = 50

export function historyOf($: EngineInterface, abs: string): Promise<Commit[] | null> {
  return kept(`history\0${abs}`, async () => {
    const dir = dirOf(abs)

    if (!(await isTrusted($, dir))) return null

    const out = await run(
      $,
      ['git', '-c', 'core.quotepath=false', 'log', '--follow', '--no-color', '--format=%x1e%h%x1f%an%x1f%at%x1f%s', '--name-only', '-n', String(HISTORY), '--', abs],
      10000,
      dir,
    )

    if (!out || out.exitCode !== 0) return null

    return out.stdout.split('\x1e').flatMap(record => {
      const [head = '', ...rest] = record.split('\n')
      const [hash, author, at, subject] = head.split('\x1f')
      const path = rest.find(line => line.trim() !== '')?.trim()

      return hash && path && /^[0-9a-f]+$/.test(hash) ? [{ hash, author: author ?? '', at: Number(at) * 1000, subject: subject ?? '', path }] : []
    })
  })
}

// What `commit` changed in the file, at `path` from the repository's top, as hunks.
export function commitDiffOf($: EngineInterface, abs: string, commit: Commit): Promise<{ text: string; more: number }> {
  return kept(`commit\0${abs}\0${commit.hash}`, async () => {
    const dir = dirOf(abs)

    if (!/^[0-9a-f]+$/.test(commit.hash) || !(await isTrusted($, dir))) return { text: '', more: 0 }

    const out = await run(
      $,
      ['git', 'show', '--format=', '--no-color', '--no-ext-diff', '--no-textconv', '-U2', commit.hash, '--', `:(top,literal)${commit.path}`],
      10000,
      dir,
    )

    return hunksOf(out?.stdout ?? '', PANE_DIFF)
  })
}

// What changes on the disk without Claude (a file made in an editor, a branch checked out in a
// terminal) shows too: while the pane is in sight, every few seconds, it lists the folders the
// tree holds again and asks git for its state, and draws again only where either moved. Those
// are the folders listed since the pane last forgot them, at most LOOK_FOLDERS; and the wait
// grows with them, as one listing costs about as much as another.
const LOOK_MS = 3000
const LOOK_MS_PER_FOLDER = 500
const LOOK_FOLDERS = 64

let isLooking = false
// Whether the last look found the pane in sight, and what `printOf` gave it, for which project.
let wasShown = true
let gitSeen: { root: string; print: string } | null = null
// The file open in the file pane as the last look found it: its path, and its size and when it
// changed.
let fileSeen: { path: string; stamp: string } | null = null

export function lookForChanges($: EngineInterface) {
  if (isLooking) return

  isLooking = true
  const next = (ms: number) =>
    $.clock.after(ms, () => {
      void lookAgain($)
        .catch(() => 0)
        .then(folders => next(Math.max(LOOK_MS, folders * LOOK_MS_PER_FOLDER)))
    })

  // The first look at once, beside git's first read, so a change made in the seconds after is
  // not taken for how things were.
  next(0)
}

// A listing as the tree draws it: each entry's name and kind, and its size, which Sizes shows.
const namesOf = (entries: Entry[]) => entries.map(entry => `${entry.kind}\0${entry.name}`).sort().join('\0\0')
const sizesOf = (entries: Entry[]) => entries.map(entry => `${entry.kind}\0${entry.name}\0${entry.size}`).sort().join('\0\0')

// One look; resolves how many folders it listed.
async function lookAgain($: EngineInterface): Promise<number> {
  // Any of the plugin's panes in sight counts: each shows what is on the disk. A Claude Code that
  // cannot list its panes gets looks as though one were.
  const panes = await $.ui.panes().catch(() => null)

  if (panes && !panes.some(pane => pane.isShown && pane.isPlaced)) {
    wasShown = false

    return 0
  }

  // A pane back in sight reads git again whole: what changed while it was hidden went unlooked at.
  const isBack = !wasShown
  wasShown = true

  const folders = [...listings].slice(0, LOOK_FOLDERS)
  let isRenamed = false
  let isResized = false

  await Promise.all(
    folders.map(async ([path, held]) => {
      const [was, now] = await Promise.all([held, $.fs.list(path).catch(() => null)])

      if (now === null || sizesOf(was) === sizesOf(now)) return
      // A forget since the look began dropped this listing: the tree lists it afresh anyway.
      if (listings.get(path) !== held) return

      listings.set(path, Promise.resolve(now))
      if (namesOf(was) === namesOf(now)) isResized = true
      else isRenamed = true
    }),
  )

  // A file made or removed is one search should find, or not; it may be one git ignores, so git
  // is read again as well, for the tree to dim it.
  if (isRenamed) fileIndex = null

  // Git's state against the last look's: the first look in a project only notes it, and one git
  // did not answer (it timed out, or may not run there) compares with nothing.
  const { root } = await read($, view)
  const print = await printOf($, root)
  const seen = gitSeen
  const isGitMoved = print !== null && seen !== null && seen.root === root && seen.print !== print

  if (print !== null) gitSeen = { root, print }

  // The file open in the file pane, changed on the disk (an editor saved it), or git moved under
  // it: what the pane read of it is read again. Its size and time are enough to tell.
  const open = await read($, opened)
  const stat = open ? await $.fs.stat(open.path).catch(() => null) : null
  const file = open ? { path: open.path, stamp: `${stat?.size ?? -1}\0${stat?.mtimeMs ?? -1}` } : null
  const isFileMoved = file !== null && fileSeen?.path === file.path && fileSeen.stamp !== file.stamp

  fileSeen = file
  if (isFileMoved || isGitMoved || isBack) readings.clear()

  if (isRenamed || isGitMoved || isBack) void refreshGit($)
  else if (isResized || isFileMoved) redraw($)

  return folders.length
}

// A diff the pane shows whole up to this many lines; past it, cut where a hunk ends.
const DIFF_LINES = 400

// How much of a diff to show: at most `lines` lines and `chars` characters.
type Room = { lines: number; chars: number }

// Lines Code draws: no control character but tab and newline.
const printable = (line: string) => line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

// A hunk's header counted again for the lines kept of it, so a hunk cut short still parses.
const recount = (hunk: string[]) => {
  const [, from = '0', to = '0', rest = ''] = hunk[0]!.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/) ?? []
  const body = hunk.slice(1)
  const old = body.filter(line => !line.startsWith('+')).length
  const next = body.filter(line => !line.startsWith('-')).length

  return [`@@ -${from},${old} +${to},${next} @@${rest}`, ...body]
}

// What changed in a file since HEAD, as unified-diff hunks with two lines around each change; a
// file git does not track yet, or any file before the first commit, whole, as added lines. Past
// DIFF_LINES the rest is left out, and counted.
// None outside the session's repository: see isTrusted.
export async function diffOf($: EngineInterface, abs: string, room: Room = { lines: DIFF_LINES, chars: Infinity }): Promise<{ text: string; more: number }> {
  const dir = dirOf(abs)

  if (!(await isTrusted($, dir))) return { text: '', more: 0 }

  const tracked = await run($, ['git', 'ls-files', '--error-unmatch', '--', abs], 5000, dir)
  const whole = ['git', 'diff', '--no-color', '--no-ext-diff', '-U2', '--no-index', '--', '/dev/null', abs]
  // A tracked file is diffed against HEAD; before the first commit there is none, git exits 128, and
  // the file is new. (Asked first, a slow HEAD read would show a tracked file as wholly added.)
  const sinceHead = tracked && tracked.exitCode === 0 ? await run($, ['git', 'diff', '--no-color', '--no-ext-diff', '-U2', 'HEAD', '--', abs], 10000, dir) : null
  // `--no-index` exits 1 when the files differ, which they always do: its output is what counts.
  const out = (sinceHead && sinceHead.exitCode !== 128 ? sinceHead : await run($, whole, 10000, dir))?.stdout ?? ''

  return hunksOf(out, room)
}

// A diff's hunks, from git's output, whole while they fit `room`; past it, cut where a hunk ends,
// and the rest counted.
function hunksOf(out: string, room: Room): { text: string; more: number } {
  const all = out.split('\n').map(printable)
  const start = all.findIndex(line => line.startsWith('@@'))

  if (start < 0) return { text: '', more: 0 }

  const lines = all.slice(start)

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  // How many lines fit: `room.lines` at most, each with its newline within `room.chars`.
  let fit = 0

  for (let chars = 0; fit < Math.min(lines.length, room.lines); fit++) {
    chars += lines[fit]!.length + 1
    if (chars > room.chars) break
  }

  if (fit === lines.length) return { text: lines.join('\n'), more: 0 }

  // Cut where the last hunk that starts in room begins; a first hunk too long for the room is
  // cut inside, its header counted again.
  const lastStart = lines.slice(0, fit + 1).findLastIndex(line => line.startsWith('@@'))
  const shown = lastStart > 0 ? lines.slice(0, lastStart) : recount(lines.slice(0, fit))

  return { text: shown.join('\n'), more: lines.length - shown.length }
}
