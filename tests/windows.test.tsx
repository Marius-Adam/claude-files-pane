import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// The pane on Windows: the session's folder and Claude's files come as `C:\proj\…`, git prints
// `C:/proj`, and the pane holds one spelling of each, so a file in the project is the project's.

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

const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })

// The folder the pane listed, as it asked for it. The test engine resolves a listing against the
// system it runs on: off Windows `C:/proj` is relative, and comes after the folder the tests run in.
const asked = (path: string) => path.replace(/^.*?(?=[A-Za-z]:[\\/])/, '').replace(/\\/g, '/')

// The folders the pane may list, by the spelling it asks for them in.
const TREE: Record<string, ReturnType<typeof entry>[]> = {
  'C:/proj': [entry('src', 'dir'), entry('home.ts', 'file')],
  'C:/proj/src': [entry('client.js', 'file')],
  'D:/work/other': [entry('lib', 'dir')],
  'D:/work/other/lib': [entry('util.ts', 'file')],
}

// The engine on a Windows host: the session in C:\proj, a repository on branch main with
// src/client.js changed, and another at D:\work\other. Explorer exits 1, as it does when it opens a
// folder. A commit moves HEAD to a1c9e42. `ran` collects every command with the folder it runs in; `listed` every folder listed;
// `copied` and `toasts` what the pane copied and told the person.
const engine = (on: Parameters<TestBody>[1]) => {
  const ran: { argv: string[]; cwd?: string }[] = []
  const listed: string[] = []
  const copied: string[] = []
  const toasts: string[] = []
  let head = '9f3b210'

  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:\\proj' }))
  on('tool.call', (_, e) => {
    if (/\bcommit\b/.test((e as { command?: string }).command ?? '')) head = 'a1c9e42'

    return { result: {} }
  })
  on('fs.list', (_, e) => {
    const path = asked((e as { path: string }).path)
    listed.push(path)

    return { value: TREE[path] ?? [] }
  })
  on('ui.copy', (_, e) => {
    copied.push((e as { text: string }).text)

    return { value: { isCopied: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push((e as { text: string }).text)

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string } }
    const cwd = init?.cwd ?? 'C:\\proj'
    ran.push({ argv, cwd: init?.cwd })
    const repo = cwd.startsWith('D:/work/other') ? 'D:/work/other' : 'C:/proj'
    const stdout = argv.includes('--absolute-git-dir')
      ? `${repo}/.git\n`
      : argv.includes('--show-toplevel')
        ? `${repo}\n`
        : argv.includes('--abbrev-ref')
          ? 'main\n'
          : argv.includes('--short')
            ? `${head}\n`
          : argv.includes('status')
            ? ' M src/client.js\0'
            : argv.includes('rev-list')
              ? '0\n'
              : ''

    return { value: { exitCode: argv[0] === 'explorer' ? 1 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { ran, listed, copied, toasts }
}

// Lets what the pane started without waiting (a read of git) run to its end.
const settled = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

const text = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<{ text?: string } | undefined> }, pattern: RegExp) =>
  (await ui.find({ type: 'Text', text: pattern }))?.text

type Ui = { findAll: (q: { type: string }) => Promise<unknown> }

const shows = async (ui: Ui, label: string) =>
  ((await ui.findAll({ type: 'Text' })) as { text?: string }[]).some(one => (one.text ?? '').trim() === label)

test('on Windows, a file Claude edits in the project is the project’s, and git reads the project', async ($, on) => {
  const { ran, listed } = engine(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\proj\\src\\client.js', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 10, isAborted: false } as never)
  await settled()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The touched list names its folder from the project, and the tree stays home, opened down to it.
  expect(await text(ui, /^client\.js$/)).toBe('client.js')
  expect(await text(ui, /^src$/)).toBe('src')
  expect(await text(ui, /:\//)).toBeUndefined()
  expect(await text(ui, /^home\.ts$/)).toBe('home.ts')
  expect(listed).toContain('C:/proj/src')
  // Git is the session's own, so it runs: the branch shows.
  expect(await text(ui, /^main$/)).toBe('main')
  expect(ran.some(one => one.argv.includes('status'))).toBe(true)
  await ui.unmount()
})

test('on Windows, the tree follows Claude to a project on another drive, without its git, and back', async ($, on) => {
  const { ran } = engine(on)
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: 'd:\\work\\other\\lib\\util.ts', old_string: 'a', new_string: 'b' })
  await settled()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^lib$/)).toBe('lib')
  expect(await text(ui, /^util\.ts$/)).toBe('util.ts')
  expect(await text(ui, /^home\.ts$/)).toBeUndefined()
  // Another repository's config may run programs: nothing but rev-parse runs there.
  const risky = (one: { argv: string[] }) => ['status', 'diff', 'ls-files'].some(cmd => one.argv.includes(cmd))
  expect(ran.filter(one => one.cwd?.startsWith('D:') && risky(one))).toEqual([])

  await ui.press({ key: 'home' })
  expect(await text(ui, /^home\.ts$/)).toBe('home.ts')
  await ui.unmount()
})

test('on Windows, a file outside the project shows its folder from ~', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: 'C:\\proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'C:\\Users\\someone\\notes\\plan.md' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await text(ui, /^~\/notes$/)).toBe('~/notes')
  await ui.unmount()
})

test('on Windows, a commit made from Git Bash with -C /c/… marks the project’s files committed', async ($, on) => {
  const { ran } = engine(on)
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git -C /c/proj commit -m "fix"' })

  expect(ran.some(one => one.argv.includes('show') && one.cwd === 'C:/proj')).toBe(true)
})

test('on Windows, the ⋯ copies paths with \\, shows the file in Explorer, and looks for no editor', async ($, on) => {
  const { ran, copied, toasts } = engine(on)
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'C:\\proj\\src\\client.js' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const FILE = 'C:/proj/src/client.js'
  const press = (action: string) => ({ key: `${action}:touched:${FILE}` })

  for (const action of ['copy-abs', 'copy-rel']) {
    await ui.press(press('more'))
    await ui.press(press('copy'))
    await ui.press(press(action))
  }
  expect(copied).toEqual(['C:\\proj\\src\\client.js', 'src\\client.js'])

  await ui.press(press('more'))
  expect(await shows(ui, 'Open in')).toBe(false)
  expect(await shows(ui, 'Show in Finder')).toBe(false)
  await ui.press(press('folder'))
  expect(ran.map(one => one.argv)).toContainEqual(['explorer', '/select,C:\\proj\\src\\client.js'])
  // Explorer's exit 1 is no failure.
  expect(toasts.filter(one => one.startsWith('Could not'))).toEqual([])
  // Windows is known from the session's folder: no uname, no which.
  expect(ran.some(one => one.argv[0] === 'uname' || one.argv[0] === 'which')).toBe(false)
  await ui.unmount()
})
