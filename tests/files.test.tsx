import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { SVGS } from '../hooks/icon-svgs'
import { fileIcon, folderIcon } from '../hooks/icons'

const PANE = {
  plugin: 'files-pane',
  component: 'Pane',
  requestId: 'files-pane',
  props: {
    title: 'Files: proj',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const entry = (name: string, kind: 'file' | 'dir', size = 0) => ({ name, kind, size, mtimeMs: 0, isLink: false })

// Each hook stands for the engine: a project at /proj with src/ and tests/, on branch main.
// `dirty` is what git reports as changed, so a test can commit by emptying it.
const engine = (on: Parameters<TestBody>[1], git = { dirty: [' M src/client.js'], ahead: '0' }, registered: string[] = []) => {
  on('command.register', (_, e) => {
    registered.push((e as { name: string }).name)

    return { value: { command: 'files' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('tool.call', () => ({ result: {} }))
  on('fs.list', (_, e) => {
    const path = (e as { path?: string }).path ?? ''

    if (path.endsWith('src')) return { value: [entry('client.js', 'file', 2048)] }

    return { value: [entry('README.md', 'file', 10), entry('src', 'dir'), entry('tests', 'dir'), entry('.env', 'file')] }
  })
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    const stdout = argv.includes('--abbrev-ref')
      ? 'main\n'
      : argv.includes('--short') && argv.includes('rev-parse')
        ? 'a1c9e42\n'
        : argv.includes('status')
          ? git.dirty.map(line => `${line}\n`).join('')
          : argv.includes('--numstat')
            ? git.dirty.length > 0 ? '1\t1\tsrc/client.js\n' : ''
            : argv.includes('rev-list')
              ? `${git.ahead}\n`
              : argv.includes('show')
                ? 'src/client.js\n'
                : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const text = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<{ text?: string } | undefined> }, pattern: RegExp) =>
  (await ui.find({ type: 'Text', text: pattern }))?.text

test('a read shows in the card and the touched list, on every surface', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/proj/tests/client.test.js' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    // After the read, Claude is between tools: the card says it is thinking, and what it opened.
    expect(await text(ui, /^Claude is thinking$/)).toBe('Claude is thinking')
    expect(await text(ui, /^opened 1 file$/)).toBe('opened 1 file')
    expect(await text(ui, /Opened/)).toMatch(/Opened/)
    expect(await text(ui, /^CLAUDE TOUCHED$/)).toBe('CLAUDE TOUCHED')
    expect(await text(ui, /^ ?1 file ?$/)).toMatch(/1 file/)
    expect(await text(ui, /1 changed/)).toMatch(/1 changed/)
    expect(await text(ui, /^ ?proj ?$/)).toMatch(/proj/)
    await ui.unmount()
  }
})

test('a finished turn says what Claude edited, with its line counts', async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/proj/README.md' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/client.js', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 10, isAborted: false } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^DONE$/)).toBe('DONE')
  expect(await text(ui, /^Claude edited 1 file$/)).toBe('Claude edited 1 file')
  expect(await text(ui, /^src\/client\.js/)).toMatch(/^src\/client\.js \+1 −1/)
  expect(await text(ui, /Edited/)).toMatch(/Edited/)
  expect(await text(ui, /Not committed/)).toMatch(/Not committed/)
  await ui.unmount()
})

test('a commit turns the card, the pills and the foot green', async ($, on) => {
  const git = { dirty: [' M src/client.js'], ahead: '0' }
  engine(on, git)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/client.js', old_string: 'a', new_string: 'b' })
  git.dirty = []
  git.ahead = '1'
  await $.tool.call({ tool: 'Bash', command: 'git commit -am "Raise MAX_RETRIES to 3"' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^Claude committed 1 file$/)).toBe('Claude committed 1 file')
  expect(await text(ui, /^a1c9e42$/)).toBe('a1c9e42')
  expect(await text(ui, /Committed/)).toMatch(/Committed/)
  expect(await text(ui, /^↑1$/)).toBe('↑1')
  expect(await text(ui, /clean, nothing changed/)).toBe('clean, nothing changed')
  expect(await text(ui, /committed a1c9e42/)).toMatch(/committed a1c9e42/)
  await ui.unmount()
})

test('the first turn sets up /files when session.start never reached the mod', async ($, on) => {
  const registered: string[] = []
  engine(on, undefined, registered)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ turnId: 't1', prompt: 'hi' } as never)
  await $.turn.start({ turnId: 't2', prompt: 'again' } as never)

  expect(registered).toEqual(['files'])
})

test('the tree shows hidden files until asked, and opens a folder', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^\.env$/)).toBe('.env')
  expect(await text(ui, /^client\.js$/)).toBeUndefined()

  await ui.press({ key: 'dir:src' })
  expect(await text(ui, /^client\.js$/)).toBe('client.js')
  // The desktop draws the vscode-icons JavaScript icon where the terminal draws a chip.
  const icons = (await ui.findAll({ type: 'Svg' })) as unknown as { props: { source: string; alt: string } }[]
  expect(icons.some(one => one.props.source === fileIcon('client.js'))).toBe(true)
  // The desktop drops an Svg whose alt is empty, so every icon must name itself.
  expect(icons.filter(one => one.props.alt.trim() === '')).toHaveLength(0)
  expect(await text(ui, /^ JS $/)).toBeUndefined()

  await ui.press({ key: 'hidden' })
  expect(await text(ui, /^\.env$/)).toBeUndefined()
  await ui.unmount()
})

test('the terminal shows a chip for a file type, and a folder outside the project from ~', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/Users/someone/notes/plan.md' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await text(ui, /^ MD $/)).toBe(' MD ')
  expect(await text(ui, /^~\/notes$/)).toBe('~/notes')
  await ui.unmount()
})

test('icons follow VS Code: an exact name, then the longest extension, then a default', () => {
  expect(fileIcon('package.json')).toBe(SVGS['file-type-npm'])
  expect(fileIcon('types.d.ts')).toBe(SVGS['file-type-typescriptdef'])
  expect(fileIcon('Button.tsx')).toBe(SVGS['file-type-reactts'])
  expect(fileIcon('vite.config.ts')).toBe(SVGS['file-type-vite'])
  expect(fileIcon('mystery.zzz')).toBe(SVGS['default-file'])
  expect(folderIcon('src', true)).toBe(SVGS['folder-type-src-opened'])
  expect(folderIcon('whatever', false)).toBe(SVGS['default-folder'])
})

test('a file Claude reads opens its folders in the tree, as VS Code reveals it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/client.js' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // No press on src: the read opened it.
  const names = (await ui.findAll({ type: 'Text', text: /^client\.js$/ })) as unknown as unknown[]
  expect(names.length).toBeGreaterThan(1)
  await ui.unmount()
})

// A second world for the tests below: a tree by absolute folder, git's top level for folders outside /proj,
// and a tool call that can be held open while the test looks.
const world = (on: Parameters<TestBody>[1], tree: Record<string, ReturnType<typeof entry>[]>, hold?: Promise<void>) => {
  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('tool.call', async () => {
    await hold

    return { result: {} }
  })
  on('fs.list', (_, e) => ({ value: tree[(e as { path: string }).path] ?? [] }))
  on('process.run', (_, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string } }
    const cwd = init?.cwd
    const stdout = argv.includes('--show-toplevel') ? (cwd?.startsWith('/work/other') ? '/work/other\n' : '/proj\n') : argv.includes('--abbrev-ref') ? 'main\n' : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('a folder slides open: one more row each frame, its chevron turning', async ($, on) => {
  const clock = mock.clock(on)
  world(on, { '/proj': [entry('src', 'dir')], '/proj/src': [entry('a.ts', 'file'), entry('b.ts', 'file'), entry('c.ts', 'file')] })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dir:src' })

  expect(await text(ui, /^a\.ts$/)).toBe('a.ts')
  expect(await text(ui, /^c\.ts$/)).toBeUndefined()

  await clock.advance(200)
  expect(await text(ui, /^c\.ts$/)).toBe('c.ts')
  await ui.unmount()
})

test('the tree follows Claude into another project and back', async ($, on) => {
  world(on, {
    '/proj': [entry('home.ts', 'file')],
    '/work/other': [entry('lib', 'dir')],
    '/work/other/lib': [entry('util.ts', 'file')],
  })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/work/other/lib/util.ts', old_string: 'a', new_string: 'b' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The tree lists the other project, opened down to the file, and offers the way home.
  expect(await text(ui, /^ ?other ?$/)).toMatch(/other/)
  expect((await ui.findAll({ type: 'Text', text: /^util\.ts$/ })).length).toBeGreaterThan(1)
  expect(await text(ui, /^home\.ts$/)).toBeUndefined()

  await ui.press({ key: 'home' })
  expect(await text(ui, /^home\.ts$/)).toBe('home.ts')
  await ui.unmount()
})

test('the card says what Claude is doing with a tool other than a read or an edit', async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(resolve => (release = resolve))
  world(on, {}, hold)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const call = $.tool.call({ tool: 'Bash', command: 'npm test -- --watch=false', description: 'Run the tests' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^Run the tests$/)).toBe('Run the tests')
  expect(await text(ui, /^npm test/)).toMatch(/^npm test/)

  release()
  await call
  await ui.unmount()
})

test('the card shows the tail of what Claude is thinking as it streams', async ($, on) => {
  world(on, {})
  on('turn.step', async function* () {
    yield { kind: 'thinking', index: 0, text: 'The retry should back off, ' } as never
    yield { kind: 'thinking', index: 0, text: 'so I will check client.ts first.' } as never

    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'test', messageCount: 1 } as never) as never as AsyncIterable<unknown>) {
    // Drain the stream as the engine would.
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^Claude is thinking$/)).toBe('Claude is thinking')
  expect(await text(ui, /back off/)).toMatch(/back off/)
  await ui.unmount()
})
