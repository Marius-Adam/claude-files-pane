import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'files-pane',
  component: 'Pane',
  requestId: 'files-pane',
  props: {
    title: 'Files: proj',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 120 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })

// A path the pane listed or read, as it asked for it. The test engine resolves one against the
// system it runs on, and on Windows `/proj/.git` comes as `D:\proj\.git`.
const asked = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

// What the GitHub CLI answers `gh pr view --json number,url,state,isDraft,reviewDecision,
// statusCheckRollup`: a pull request as it prints one (copied from a real run; `checks` are its
// rollup's entries, `review` its reviewDecision), `none` as it exits when the branch has none (or the
// CLI is signed out), `missing` when there is no `gh` on the PATH to start, or `slow` while GitHub
// has not answered yet.
type PullRequest = { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; isDraft: boolean; review?: string; checks?: object[] }
type Gh = PullRequest | 'none' | 'missing' | 'slow'

// A job of the repository's Check workflow as the rollup lists it, run from `startedAt`.
const job = (name: string, status: string, conclusion: string, startedAt = '2026-11-03T04:41:10Z') => ({
  __typename: 'CheckRun',
  name,
  workflowName: 'Check',
  status,
  conclusion,
  startedAt,
})

// A repository at /proj on `branch`. In a linked worktree (`isWorktree`) its git directory sits
// under the shared one of the repository it belongs to, /src/shop/.git, as `git worktree add` makes
// it; otherwise the two are one. `track` is what `for-each-ref` prints of the branch's upstream (an
// upstream level with it when absent), `status` what `git status -z` reports, and `gitDir` the files
// git keeps in the worktree's git directory while a rebase or merge is in progress, by path. Any of
// it may change mid-test, as when Claude opens a pull request. `ran` collects every command, and
// `waits` every timer the pane set, which a test lets end with `end()`.
type World = { branch: string; isWorktree: boolean; gh: Gh; track?: string; status?: string[]; gitDir?: Record<string, string> }

const engine = (on: Parameters<TestBody>[1], world: World, ran: string[][] = []) => {
  const waits: { ms: number; end: () => void }[] = []
  const gitDir = () => (world.isWorktree ? '/src/shop/.git/worktrees/proj' : '/proj/.git')

  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('tool.call', () => ({ result: {} }))
  on('clock.after', (_, e) => new Promise(resolve => waits.push({ ms: (e as { ms: number }).ms, end: () => resolve({ value: undefined }) })))
  on('fs.list', (_, e) => {
    const path = asked((e as { path?: string }).path ?? '')

    if (path === gitDir()) {
      const names = new Set(Object.keys(world.gitDir ?? {}).map(file => file.split('/')[0]!))

      return { value: [...names, 'HEAD', 'config', 'index'].map(name => entry(name, name.startsWith('rebase-') ? 'dir' : 'file')) }
    }

    return path.endsWith('src') ? { value: [entry('client.js', 'file')] } : { value: [entry('src', 'dir')] }
  })
  on('fs.read', (_, e) => {
    const path = asked((e as { path: string }).path)
    const found = Object.entries(world.gitDir ?? {}).find(([file]) => path === `${gitDir()}/${file}`)

    if (!found) throw new Error('ENOENT')

    return { value: found[1] }
  })
  on('process.run', (_, e) => {
    const { argv } = e as { argv: string[] }
    ran.push(argv)
    const answer = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const { gh } = world

    if (argv[0] === 'gh') {
      if (gh === 'missing') throw new Error('ENOENT')
      if (gh === 'none') return answer(1)
      if (gh === 'slow') return new Promise<never>(() => {})

      const url = `https://github.com/someone/shop/pull/${gh.number}`
      const printed = { isDraft: gh.isDraft, number: gh.number, reviewDecision: gh.review ?? '', state: gh.state, statusCheckRollup: gh.checks ?? [], url }

      return answer(0, `${JSON.stringify(printed)}\n`)
    }

    if (argv.includes('--path-format=absolute')) return answer(0, `${gitDir()}\n${world.isWorktree ? '/src/shop/.git' : '/proj/.git'}\n`)
    if (argv.includes('--absolute-git-dir')) return answer(0, `${gitDir()}\n`)
    if (argv.includes('--abbrev-ref')) return answer(0, `${world.branch}\n\n`)
    if (argv.includes('for-each-ref')) return answer(0, `${world.track ?? `refs/remotes/origin/${world.branch}\0`}\n`)
    if (argv.includes('status')) return answer(0, (world.status ?? []).map(line => `${line}\0`).join(''))

    return answer(0)
  })

  return { waits }
}

const text = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<{ text?: string } | undefined> }, pattern: RegExp) =>
  (await ui.find({ type: 'Text', text: pattern }))?.text

// The link the pane draws, by where it goes.
const hrefs = async (ui: { findAll: (q: { type: string }) => Promise<unknown> }) =>
  ((await ui.findAll({ type: 'Link' })) as { props: { href: string } }[]).map(one => one.props.href)

// Lets what the pane started without waiting (git's read, the pull request's lookup) run to its end.
const settled = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

// The pane reads git as a session starts only once a module's life, and keeps a pull request it
// found a while: each test asks for both again, as a press on ↻ Refresh does.
const mounted = async ($: Parameters<TestBody>[0], surface: (typeof SURFACES)[number] = 'desktop') => {
  await $.session.start({ cwd: '/proj', surface, isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface })

  await ui.press({ key: 'refresh' })
  await settled()

  return ui
}

const ghRuns = (ran: string[][]) => ran.filter(argv => argv[0] === 'gh').length

test('in a linked worktree, the branch row says whose worktree it is and links the branch’s pull request, on every surface', async ($, on) => {
  engine(on, { branch: 'fix/retry', isWorktree: true, gh: { number: 42, state: 'OPEN', isDraft: false } })

  for (const surface of SURFACES) {
    const ui = await mounted($, surface)

    expect(await text(ui, /^fix\/retry$/)).toBe('fix/retry')
    expect(await text(ui, /worktree of shop/)).toMatch(/worktree of shop/)
    expect(await text(ui, /#42 open/)).toMatch(/#42 open/)
    expect(await hrefs(ui)).toContain('https://github.com/someone/shop/pull/42')
    await ui.unmount()
  }
})

test('on the desktop the pull request’s pill is a link holding its label, which the app opens', async ($, on) => {
  engine(on, { branch: 'fix/retry', isWorktree: false, gh: { number: 42, state: 'OPEN', isDraft: false } })

  const ui = await mounted($, 'desktop')
  type Node = { type: string; props: { href?: string }; children?: (Node | string)[] }
  const [link] = (await ui.findAll({ type: 'Link' })) as Node[]
  const label = (node: Node): string => (node.children ?? []).map(child => (typeof child === 'string' ? child : label(child))).join('')

  // The app opens a Link it draws itself; one drawn inside a Text it draws as text only.
  expect(link?.props.href).toBe('https://github.com/someone/shop/pull/42')
  expect(link?.children?.map(child => (typeof child === 'string' ? 'string' : child.type))).toEqual(['Text'])
  expect(label(link!).trim()).toBe('#42 open')
  await ui.unmount()
})

test('a draft pull request says so, and a merged one says merged', async ($, on) => {
  const world: World = { branch: 'feat/search', isWorktree: false, gh: { number: 7, state: 'OPEN', isDraft: true } }
  engine(on, world)

  const ui = await mounted($)

  expect(await text(ui, /#7 draft/)).toMatch(/#7 draft/)

  world.gh = { number: 7, state: 'MERGED', isDraft: false }
  await ui.press({ key: 'refresh' })
  await settled()
  expect(await text(ui, /#7 merged/)).toMatch(/#7 merged/)
  await ui.unmount()
})

test('in the repository’s own folder, with no pull request or no GitHub CLI, the branch row shows just the branch', async ($, on) => {
  const world: World = { branch: 'main', isWorktree: false, gh: 'none' }
  engine(on, world)

  for (const gh of ['none', 'missing'] as const) {
    world.gh = gh
    const ui = await mounted($)

    expect(await text(ui, /^main$/)).toBe('main')
    expect(await text(ui, /worktree of/)).toBeUndefined()
    expect(await text(ui, /^#\d+/)).toBeUndefined()
    expect(await hrefs(ui)).toEqual([])
    await ui.unmount()
  }
})

// GitHub is asked over the network: not after every command, only after one that may have opened,
// moved or closed the pull request.
test('the pull request Claude opens shows once its `gh pr create` returns, and other commands do not ask GitHub again', async ($, on) => {
  const ran: string[][] = []
  const world: World = { branch: 'fix/timeout', isWorktree: true, gh: 'none' }
  engine(on, world, ran)

  const ui = await mounted($)

  expect(await text(ui, /^#\d+/)).toBeUndefined()

  const before = ghRuns(ran)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await settled()
  expect(ghRuns(ran)).toBe(before)

  world.gh = { number: 43, state: 'OPEN', isDraft: false }
  await $.tool.call({ tool: 'Bash', command: 'git push -u origin fix/timeout && gh pr create --base staging --fill' })
  await settled()
  expect(ghRuns(ran)).toBe(before + 1)
  expect(await text(ui, /#43 open/)).toMatch(/#43 open/)
  expect(await hrefs(ui)).toContain('https://github.com/someone/shop/pull/43')
  await ui.unmount()
})

test('a pull request found for one branch is not shown once HEAD is on another, while GitHub is asked about that one', async ($, on) => {
  const world: World = { branch: 'fix/cache', isWorktree: false, gh: { number: 50, state: 'OPEN', isDraft: false } }
  engine(on, world)

  const ui = await mounted($)

  expect(await text(ui, /#50 open/)).toMatch(/#50 open/)

  world.branch = 'main'
  world.gh = 'slow'
  await $.tool.call({ tool: 'Bash', command: 'git switch main' })
  await settled()
  expect(await text(ui, /^main$/)).toBe('main')
  expect(await text(ui, /#50/)).toBeUndefined()
  await ui.unmount()
})

test('an open pull request’s failing check and requested changes show beside it; a merged one shows neither', async ($, on) => {
  const world: World = {
    branch: 'fix/retry',
    isWorktree: false,
    gh: { number: 42, state: 'OPEN', isDraft: false, review: 'CHANGES_REQUESTED', checks: [job('test (macos-latest)', 'COMPLETED', 'SUCCESS'), job('test (windows-latest)', 'COMPLETED', 'FAILURE')] },
  }
  engine(on, world)

  const ui = await mounted($)

  expect(await text(ui, /✗ 1 failing/)).toMatch(/✗ 1 failing/)
  expect(await text(ui, /changes requested/)).toMatch(/changes requested/)

  world.gh = { number: 42, state: 'MERGED', isDraft: false, review: 'APPROVED', checks: [job('test (windows-latest)', 'COMPLETED', 'FAILURE')] }
  await ui.press({ key: 'refresh' })
  await settled()
  expect(await text(ui, /#42 merged/)).toMatch(/#42 merged/)
  expect(await text(ui, /failing|checks|approved/)).toBeUndefined()
  await ui.unmount()
})

// A job re-run is listed once per run: the latest run is the one that counts. A skipped job counts
// for nothing, as `from-staging` is skipped on every pull request into staging.
test('a check that failed and passed on its re-run counts as passing, beside an approval', async ($, on) => {
  engine(on, {
    branch: 'fix/retry',
    isWorktree: false,
    gh: {
      number: 42,
      state: 'OPEN',
      isDraft: false,
      review: 'APPROVED',
      checks: [
        job('test (windows-latest)', 'COMPLETED', 'FAILURE', '2026-11-03T04:31:00Z'),
        job('test (windows-latest)', 'COMPLETED', 'SUCCESS', '2026-11-03T04:41:16Z'),
        job('from-staging', 'COMPLETED', 'SKIPPED'),
      ],
    },
  })

  const ui = await mounted($)

  expect(await text(ui, /✓ checks pass/)).toMatch(/✓ checks pass/)
  expect(await text(ui, /^ ?approved ?$/)).toMatch(/approved/)
  expect(await text(ui, /failing/)).toBeUndefined()
  await ui.unmount()
})

// While checks run, the pane asks GitHub again every 30 seconds by itself, with nothing else to set
// it off, and stops once they end.
test('running checks are asked about again by themselves until they end', async ($, on) => {
  const ran: string[][] = []
  const world: World = { branch: 'feat/search', isWorktree: false, gh: { number: 7, state: 'OPEN', isDraft: true, checks: [job('test (ubuntu-latest)', 'IN_PROGRESS', '')] } }
  const { waits } = engine(on, world, ran)

  const ui = await mounted($)

  expect(await text(ui, /checks running/)).toMatch(/checks running/)
  expect(waits.map(wait => wait.ms)).toContain(30000)

  const before = ghRuns(ran)
  world.gh = { number: 7, state: 'OPEN', isDraft: true, checks: [job('test (ubuntu-latest)', 'COMPLETED', 'SUCCESS')] }
  const pending = waits.length
  waits.find(wait => wait.ms === 30000)!.end()
  await settled()

  expect(ghRuns(ran)).toBe(before + 1)
  expect(await text(ui, /✓ checks pass/)).toMatch(/✓ checks pass/)
  expect(waits.slice(pending).filter(wait => wait.ms === 30000)).toEqual([])
  await ui.unmount()
})

test('the branch row says how far the branch is behind its upstream, or that it was never pushed, or that its upstream is gone', async ($, on) => {
  const world: World = { branch: 'fix/retry', isWorktree: false, gh: 'none', track: 'refs/remotes/origin/fix/retry\0ahead 2, behind 3' }
  engine(on, world)

  const ui = await mounted($)

  expect(await text(ui, /↑2/)).toMatch(/↑2/)
  expect(await text(ui, /↓3/)).toMatch(/↓3/)
  expect(await text(ui, /not pushed|gone/)).toBeUndefined()

  world.track = '\0'
  await ui.press({ key: 'refresh' })
  expect(await text(ui, /not pushed/)).toMatch(/not pushed/)
  expect(await text(ui, /↓/)).toBeUndefined()

  // After its pull request merged and GitHub deleted the branch, the upstream is gone.
  world.track = 'refs/remotes/origin/fix/retry\0gone'
  await ui.press({ key: 'refresh' })
  expect(await text(ui, /upstream gone/)).toMatch(/upstream gone/)
  expect(await text(ui, /not pushed/)).toBeUndefined()
  await ui.unmount()
})

// What git keeps in the worktree's own git directory, copied from a rebase stopped on a conflict at
// its third of seven commits, then a merge stopped on one.
test('a rebase left in progress shows its step and its conflicts, and a merge says it is merging', async ($, on) => {
  const world: World = {
    branch: 'fix/retry',
    isWorktree: true,
    gh: 'none',
    status: ['UU src/client.js'],
    gitDir: { 'rebase-merge/msgnum': '3\n', 'rebase-merge/end': '7\n', 'rebase-merge/head-name': 'refs/heads/fix/retry\n' },
  }
  engine(on, world)

  const ui = await mounted($)

  expect(await text(ui, /rebasing 3\/7/)).toMatch(/rebasing 3\/7/)
  expect(await text(ui, /1 conflict\b/)).toMatch(/1 conflict/)

  world.gitDir = { MERGE_HEAD: '9f3b210\n', MERGE_MSG: "Merge branch 'staging'\n" }
  await ui.press({ key: 'refresh' })
  expect(await text(ui, /^ ?merging ?$/)).toMatch(/merging/)
  expect(await text(ui, /rebasing/)).toBeUndefined()

  world.gitDir = {}
  world.status = []
  await ui.press({ key: 'refresh' })
  expect(await text(ui, /merging|conflict/)).toBeUndefined()
  await ui.unmount()
})
