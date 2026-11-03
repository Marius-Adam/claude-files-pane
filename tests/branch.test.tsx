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

// What the GitHub CLI answers `gh pr view --json number,url,state,isDraft`: a pull request as it
// prints one (copied from a real run), `none` as it exits when the branch has none (or the CLI is
// signed out), `missing` when there is no `gh` on the PATH to start, or `slow` while GitHub has not
// answered yet.
type Gh = { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; isDraft: boolean } | 'none' | 'missing' | 'slow'

// A repository at /proj on `branch`, with nothing changed. In a linked worktree (`isWorktree`) its
// git directory sits under the shared one of the repository it belongs to, /src/shop/.git, as
// `git worktree add` makes it; otherwise the two are one. `world.gh` may change mid-test, as when
// Claude opens a pull request. `ran` collects every command.
const engine = (on: Parameters<TestBody>[1], world: { branch: string; isWorktree: boolean; gh: Gh }, ran: string[][] = []) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('tool.call', () => ({ result: {} }))
  on('fs.list', (_, e) =>
    ((e as { path?: string }).path ?? '').endsWith('src') ? { value: [entry('client.js', 'file')] } : { value: [entry('src', 'dir')] },
  )
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

      return answer(0, `${JSON.stringify({ isDraft: gh.isDraft, number: gh.number, state: gh.state, url })}\n`)
    }

    if (argv.includes('--path-format=absolute'))
      return answer(0, world.isWorktree ? '/src/shop/.git/worktrees/proj\n/src/shop/.git\n' : '/proj/.git\n/proj/.git\n')
    if (argv.includes('--absolute-git-dir')) return answer(0, world.isWorktree ? '/src/shop/.git/worktrees/proj\n' : '/proj/.git\n')
    if (argv.includes('--abbrev-ref')) return answer(0, `${world.branch}\n\n`)
    if (argv.includes('rev-list')) return answer(0, '0\n')

    return answer(0)
  })
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

test('a draft pull request says so, and a merged one says merged', async ($, on) => {
  const world: { branch: string; isWorktree: boolean; gh: Gh } = { branch: 'feat/search', isWorktree: false, gh: { number: 7, state: 'OPEN', isDraft: true } }
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
  const world: { branch: string; isWorktree: boolean; gh: Gh } = { branch: 'main', isWorktree: false, gh: 'none' }
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
  const world: { branch: string; isWorktree: boolean; gh: Gh } = { branch: 'fix/timeout', isWorktree: true, gh: 'none' }
  engine(on, world, ran)

  const ui = await mounted($)

  expect(await text(ui, /^#\d+/)).toBeUndefined()

  const asked = ghRuns(ran)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await settled()
  expect(ghRuns(ran)).toBe(asked)

  world.gh = { number: 43, state: 'OPEN', isDraft: false }
  await $.tool.call({ tool: 'Bash', command: 'git push -u origin fix/timeout && gh pr create --base staging --fill' })
  await settled()
  expect(ghRuns(ran)).toBe(asked + 1)
  expect(await text(ui, /#43 open/)).toMatch(/#43 open/)
  expect(await hrefs(ui)).toContain('https://github.com/someone/shop/pull/43')
  await ui.unmount()
})

test('a pull request found for one branch is not shown once HEAD is on another, while GitHub is asked about that one', async ($, on) => {
  const world: { branch: string; isWorktree: boolean; gh: Gh } = { branch: 'fix/cache', isWorktree: false, gh: { number: 50, state: 'OPEN', isDraft: false } }
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
