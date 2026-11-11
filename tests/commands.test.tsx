import { expect, mock, test } from 'claude-code/testing'
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

const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })

// A path as the pane asked for it. The test engine resolves one against the system it runs on, and
// on Windows `/proj` comes as `D:\proj`.
const asked = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

// What `git status --porcelain=v2 --branch -z -uall` printed for a real repository
// (git 2.54), an entry a field: a file changed in the working tree, an untracked one, one renamed
// with `git mv` (its old path the next field), and one left in conflict by a merge.
const OID = 'ca81ea3de8ed76c4829a6bc995274168c34ad2ea'
const PULLED = '192994e994c7f3c485871a5f626ac6679eaceeee'
const STASHES = ['4b1f0e7c2d9a8b3e6f5a1c0d9e8b7a6f5e4d3c2b']
const CHANGED = '1 .M N... 100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 78981922613b2afb6025042ff6bd878ac1994e85 src/client.js'
const STAGED = '1 M. N... 100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 61780798228d17af2d34fce4cfbdf35556832472 src/client.js'
const UNTRACKED = '? notes file.md'
const RENAMED = ['2 R. N... 100644 100644 100644 587be6b4c3f93f93c489c0111bba5596147a26cb 587be6b4c3f93f93c489c0111bba5596147a26cb R100 CHANGES.md', 'CHANGELOG.md']
const CONFLICT =
  'u UU N... 100644 100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 28ce6a8b26aa170e1de65536fe8abe1832bd3242 61780798228d17af2d34fce4cfbdf35556832472 src/client.js'

// The repository at /proj as git and the disk answer. `entries` are status's fields, `stash` how
// many stashes there are, `isMerging` whether MERGE_HEAD is in the git directory, and `disk` each
// file's size and time, as `fs.stat` reads them. `commands` does to the world what each command does.
type World = {
  oid: string
  stash: number
  isMerging: boolean
  entries: string[]
  disk: Record<string, { size: number; mtimeMs: number }>
  commands: Record<string, (world: World) => void>
}

const world = (patch: Partial<World> = {}): World => ({
  oid: OID,
  stash: 0,
  isMerging: false,
  entries: [],
  disk: { 'src/client.js': { size: 2, mtimeMs: 1000 }, 'notes file.md': { size: 2, mtimeMs: 1000 }, 'CHANGES.md': { size: 2, mtimeMs: 1000 } },
  commands: {},
  ...patch,
})

// A file rewritten: one byte longer, a second later.
const write = (path: string) => (one: World) => {
  const was = one.disk[path] ?? { size: 0, mtimeMs: 0 }
  one.disk[path] = { size: was.size + 1, mtimeMs: was.mtimeMs + 1000 }
}

// Status in porcelain v1, as the branch row reads it, from the same entries.
const v1 = (entries: string[]) => {
  const lines: string[] = []

  for (let i = 0; i < entries.length; i++) {
    const field = entries[i]!
    const words = field.split(' ')

    if (field.startsWith('? ')) lines.push(`?? ${field.slice(2)}`)
    else if (field.startsWith('1 ')) lines.push(`${words[1]!.replace(/\./g, ' ')} ${words.slice(8).join(' ')}`)
    else if (field.startsWith('u ')) lines.push(`${words[1]} ${words.slice(10).join(' ')}`)
    else if (field.startsWith('2 ')) lines.push(`${words[1]!.replace(/\./g, ' ')} ${words.slice(9).join(' ')}`, entries[++i]!)
  }

  return lines.map(line => `${line}\0`).join('')
}

const engine = (on: Parameters<TestBody>[1], git: World) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_, e) => {
    git.commands[(e as { command?: string }).command ?? '']?.(git)

    return { result: {} }
  })
  on('fs.list', (_, e) => {
    const path = asked((e as { path?: string }).path ?? '')

    if (path === '/proj/.git') return { value: git.isMerging ? [entry('MERGE_HEAD', 'file'), entry('HEAD', 'file')] : [entry('HEAD', 'file')] }
    if (path.endsWith('src')) return { value: [entry('client.js', 'file')] }

    return { value: [entry('src', 'dir'), entry('CHANGES.md', 'file'), entry('notes file.md', 'file')] }
  })
  on('fs.stat', (_, e) => {
    const found = git.disk[asked((e as { path: string }).path).replace(/^\/proj\//, '')]

    if (!found) throw new Error('ENOENT: no such file or directory')

    return { value: { kind: 'file', ...found, isLink: false } }
  })
  on('process.run', (_, e) => {
    const { argv } = e as { argv: string[] }
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

    if (argv.includes('--show-prefix') && argv.includes('--absolute-git-dir')) return answer('/proj/.git\n\n')
    if (argv.includes('--absolute-git-dir')) return answer('/proj/.git\n')
    if (argv.includes('--abbrev-ref')) return answer('main\n\n')
    if (argv.includes('--git-dir')) return answer('/proj/.git\n/proj/.git\n')
    if (argv.includes('rev-parse') && argv.includes('--short')) return answer(`${git.oid.slice(0, 7)}\n`)
    if (argv.includes('status') && argv.includes('--porcelain=v2'))
      return answer([`# branch.oid ${git.oid}`, '# branch.head main', ...git.entries].map(field => `${field}\0`).join(''))
    // A stash is a commit `refs/stash` names: each stash or pop names another, or none.
    if (argv.includes('refs/stash')) return answer(git.stash ? `${STASHES[git.stash - 1]}\n` : '')
    if (argv.includes('status')) return answer(v1(git.entries))

    return answer('')
  })
}

// The files the touched list shows, by their rows' keys.
const touchedOf = async (ui: { findAll: (q: { type: string }) => Promise<unknown> }) =>
  ((await ui.findAll({ type: 'Box' })) as { key?: string }[]).flatMap(one => (one.key?.startsWith('touch:') ? [one.key.slice('touch:'.length)] : []))

const text = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<{ text?: string } | undefined> }, pattern: RegExp) =>
  (await ui.find({ type: 'Text', text: pattern }))?.text

const bash = (command: string) => ({ tool: 'Bash' as const, command, description: 'Run it' })

test('a file a command changes counts as edited by Claude, as one the Edit tool changes does', async ($, on) => {
  const git = world({
    commands: {
      "sed -i '' 's/retry = 2/retry = 3/' src/client.js": one => {
        write('src/client.js')(one)
        one.entries = [CHANGED]
      },
    },
  })
  engine(on, git)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call(bash("sed -i '' 's/retry = 2/retry = 3/' src/client.js"))
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 10, isAborted: false } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await touchedOf(ui)).toEqual(['src/client.js'])
  expect(await text(ui, /^Claude edited 1 file$/)).toBe('Claude edited 1 file')
  await ui.unmount()
})

test('a changed file a command writes again counts; a changed one it leaves alone does not', async ($, on) => {
  const git = world({ entries: [CHANGED, UNTRACKED], commands: { 'python3 scripts/bump.py': write('src/client.js') } })
  engine(on, git)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call(bash('npm test'))
  await $.tool.call(bash('python3 scripts/bump.py'))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await touchedOf(ui)).toEqual(['src/client.js'])
  await ui.unmount()
})

// Staging's files come in with the merge: they are not Claude's. The conflict it then resolves, and
// stages with `git add`, is.
test('a merge counts none of the files it brings in; the conflict Claude then resolves counts', async ($, on) => {
  const git = world({
    commands: {
      'git merge origin/staging': one => {
        one.isMerging = true
        one.entries = [...RENAMED, CONFLICT]
        write('CHANGES.md')(one)
        write('src/client.js')(one)
      },
      "python3 -c 'resolve()'": write('src/client.js'),
      'git add src/client.js': one => {
        one.entries = [...RENAMED, STAGED]
      },
    },
  })
  engine(on, git)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call(bash('git merge origin/staging'))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await touchedOf(ui)).toEqual([])

  await $.tool.call(bash("python3 -c 'resolve()'"))
  await $.tool.call(bash('git add src/client.js'))
  expect(await touchedOf(ui)).toEqual(['src/client.js'])
  await ui.unmount()
})

test('a stash, a pop and a pull count none of the files they rewrite', async ($, on) => {
  const git = world({
    entries: [CHANGED, UNTRACKED],
    commands: {
      'git stash -u': one => {
        one.stash = 1
        one.entries = []
        write('src/client.js')(one)
        delete one.disk['notes file.md']
      },
      'git stash pop': one => {
        one.stash = 0
        one.entries = [CHANGED, UNTRACKED]
        write('src/client.js')(one)
        one.disk['notes file.md'] = { size: 2, mtimeMs: 5000 }
      },
      'git pull --ff-only': one => {
        one.oid = PULLED
        write('CHANGES.md')(one)
        write('src/client.js')(one)
      },
    },
  })
  engine(on, git)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call(bash('git stash -u'))
  await $.tool.call(bash('git stash pop'))
  await $.tool.call(bash('git pull --ff-only'))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await touchedOf(ui)).toEqual([])
  await ui.unmount()
})

// Every text the pane draws, in order, as a person reads it.
const reading = async (ui: { findAll: (q: { type: string }) => Promise<unknown> }) =>
  ((await ui.findAll({ type: 'Text' })) as { text?: string }[])
    .map(one => (one.text ?? '').replace(/\u00a0/g, ' ').trim())
    .filter(Boolean)
    .join(' ')

test('the timeline says who changed each file, newest first: Claude’s edit, a command, or something outside Claude', async ($, on) => {
  const clock = mock.clock(on)
  const edited = CHANGED.replace('src/client.js', 'CHANGES.md')
  const git = world({
    commands: {
      // The Edit tool, which runs no command.
      '': one => {
        write('CHANGES.md')(one)
        one.entries = [...one.entries.filter(field => field !== edited), edited]
      },
      "sed -i '' 's/retry = 2/retry = 3/' src/client.js": one => {
        write('src/client.js')(one)
        one.entries = [...one.entries, CHANGED]
      },
    },
  })
  engine(on, git)
  // Set up as a session is: /files registered, the pane in sight, and its looks at the disk running.
  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.panes', () => ({ value: [{ id: 'files-pane', title: 'Files: proj', isShown: true, isFocused: false, isPlaced: true }] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await clock.advance(3000)
  await clock.settle()

  await $.tool.call({ tool: 'Edit', file_path: '/proj/CHANGES.md', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call(bash("sed -i '' 's/retry = 2/retry = 3/' src/client.js"))

  // Saved in an editor, with no tool call running.
  write('notes file.md')(git)
  git.entries = [...git.entries, UNTRACKED]
  await clock.advance(5000)
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Closed until asked for, with how many changes it holds.
  expect(await reading(ui)).toMatch(/TIMELINE Show 3 changes/)
  await ui.press({ key: 'timeline' })
  expect(await reading(ui)).toMatch(
    /TIMELINE ✓ Show 3 changes \d\d:\d\d Outside notes file\.md \d\d:\d\d Command client\.js src during sed -i '' 's\/retry = 2\/retry = 3\/' src\/client\.js \d\d:\d\d Claude CHANGES\.md Command: changed while it ran, most likely by it\. Outside: you or another program\./,
  )

  // Claude's own edits never come back as changes made outside it.
  await clock.advance(5000)
  await clock.settle()
  expect(await reading(ui)).toMatch(/TIMELINE ✓ Show 3 changes/)
  await ui.unmount()
})

test('an edit Claude makes again counts each time; a command that changes nothing adds nothing', async ($, on) => {
  const edited = CHANGED.replace('src/client.js', 'CHANGES.md')
  const git = world({
    commands: {
      '': one => {
        write('CHANGES.md')(one)
        one.entries = [...one.entries.filter(field => field !== edited), edited]
      },
    },
  })
  engine(on, git)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/CHANGES.md', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/CHANGES.md', old_string: 'b', new_string: 'c' } as never)
  await $.tool.call(bash('npm test'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'timeline' })
  expect(await reading(ui)).toMatch(/TIMELINE .*2 changes \d\d:\d\d Claude CHANGES\.md \d\d:\d\d Claude CHANGES\.md/)
  await ui.unmount()
})
