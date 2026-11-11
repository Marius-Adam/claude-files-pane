import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PROPS = {
  isFocused: false,
  bodyColumns: 48,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const PANE = { plugin: 'files-pane', component: 'Pane', requestId: 'files-pane', props: { ...PROPS, title: 'Files: proj' } } as const
const FILE_PANE = { plugin: 'files-pane', component: 'Pane', requestId: 'files-pane-file', props: { ...PROPS, title: 'client.js' } } as const

const CLIENT = '/proj/src/client.js'

const entry = (name: string, kind: 'file' | 'dir', size = 0) => ({ name, kind, size, mtimeMs: 0, isLink: false })

// The folder or file the pane asked for, as it asked. The test engine resolves a path against the
// system it runs on, and on Windows `/proj` comes as `D:\proj`.
const asked = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

// The disk: each file's text by absolute path. A file under /work/other is in a repository other
// than the session's.
type Disk = Record<string, string>

const DISK: Disk = {
  '/proj/README.md': '# Proj\n\nA *small* project.\n',
  [CLIENT]: 'export const retry = 3\nexport const backoff = 200\n',
  '/work/other/notes.md': '# Notes\n',
}

const LOG = '\x1ea1c9e42\x1fAda\x1f1762000000\x1fRetry three times\n\nsrc/client.js\n\x1e9f3b210\x1fGrace\x1f1761000000\x1fAdd the client\n\nsrc/client.js\n'
const SHOWN = 'diff --git a/src/client.js b/src/client.js\n--- a/src/client.js\n+++ b/src/client.js\n@@ -1 +1 @@\n-export const retry = 1\n+export const retry = 3\n'
const DIFF = 'diff --git a/src/client.js b/src/client.js\n--- a/src/client.js\n+++ b/src/client.js\n@@ -2 +2 @@\n-export const backoff = 100\n+export const backoff = 200\n'

// The engine: a project at /proj in its own repository, holding README.md and src/client.js, on
// branch main with client.js changed, as `diff` says. `opened` collects every pane opened, `ran`
// every command.
const engine = (on: Parameters<TestBody>[1], disk: Disk = DISK, diff = DIFF) => {
  const opened: { id: string; title?: string; focus?: true }[] = []
  const ran: { argv: string[]; cwd?: string }[] = []

  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', (_, e) => {
    opened.push(e as { id: string; title?: string; focus?: true })

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('tool.call', (_, e) => {
    const edit = e as { tool: string; file_path?: string; old_string?: string; new_string?: string }

    if (edit.tool === 'Edit' && edit.file_path) disk[edit.file_path] = disk[edit.file_path]!.replace(edit.old_string!, edit.new_string!)

    return { result: {} }
  })
  on('fs.list', (_, e) => {
    const path = asked((e as { path?: string }).path ?? '')
    const under = (dir: string) =>
      Object.keys(disk)
        .filter(one => one.slice(0, one.lastIndexOf('/')) === dir)
        .map(one => entry(one.slice(dir.length + 1), 'file', disk[one]!.length))

    if (path === '/proj/src') return { value: under('/proj/src') }

    return { value: [entry('src', 'dir'), ...under('/proj')] }
  })
  on('fs.stat', (_, e) => {
    const text = disk[asked((e as { path: string }).path)]

    if (text === undefined) throw new Error('ENOENT')

    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  // A file asked for as bytes comes as base64: its text holds them one character a byte.
  on('fs.read', (_, e) => {
    const { path, as } = e as { path: string; as?: string }
    const text = disk[asked(path)]

    if (text === undefined) throw new Error('ENOENT')

    return { value: as === 'bytes' ? { base64: btoa(text) } : text }
  })
  on('process.run', (_, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string } }
    const cwd = init?.cwd ? asked(init.cwd) : undefined
    ran.push({ argv, cwd })
    const stdout = argv.includes('--absolute-git-dir')
      ? cwd?.startsWith('/work/other')
        ? '/work/other/.git\n'
        : '/proj/.git\n'
      : argv.includes('--abbrev-ref')
        ? 'main\n'
        : argv.includes('status')
          ? ' M src/client.js\0'
          : argv.includes('log')
            ? LOG
            : argv.includes('show')
              ? SHOWN
              : argv.includes('diff') && argv.includes('HEAD') && !argv.includes('--numstat')
                ? diff
                : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { opened, ran }
}

type Node = { type: string; key?: string; props: Record<string, unknown>; children?: (Node | string)[] }

const codes = async (ui: { findAll: (q: { type: string }) => Promise<unknown> }) => (await ui.findAll({ type: 'Code' })) as Node[]

// The rows a diff draws, a hunk's or a line's, by their key, with the color painted under each.
const diffRows = async (ui: { findAll: (q: { type: string }) => Promise<unknown> }, prefix: 'hunk' | 'line') =>
  ((await ui.findAll({ type: 'Box' })) as Node[]).filter(one => String(one.key ?? '').startsWith(`${prefix}:`))

// Every text the pane draws, in order, as a person reads it.
const reading = async (ui: { findAll: (q: { type: string }) => Promise<unknown> }) =>
  ((await ui.findAll({ type: 'Text' })) as { text?: string }[])
    .map(one => (one.text ?? '').replace(/ /g, ' ').trim())
    .filter(Boolean)
    .join(' ')

test('a press on a file’s row opens it in a pane of its own, beside the Files pane, its lines numbered', async ($, on) => {
  mock.clock(on)
  const { opened } = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  // It opens a tab beside the Files pane, and asks for the keys, which brings it to the front.
  expect(opened.filter(one => one.id === 'files-pane-file')).toEqual([expect.objectContaining({ id: 'files-pane-file', title: 'client.js', focus: true })])

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })
  const [code] = await codes(file)

  expect(code?.props).toEqual(expect.objectContaining({ source: 'export const retry = 3\nexport const backoff = 200', path: CLIENT, startLine: 1 }))
  expect(await reading(file)).toMatch(/^client\.js .* File Diff History/)
  await file.unmount()
  await files.unmount()
})

test('Diff shows what changed since the last commit; History the commits that changed it, each opening its change', async ($, on) => {
  mock.clock(on)
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })

  // As GitHub draws a diff: each line numbered before and after, the removed one red, the added green.
  await file.press({ key: 'tab:diff' })
  expect(await codes(file)).toEqual([])
  expect(await reading(file)).toMatch(/Line 2 2 − export const backoff = 100 2 \+ export const backoff = 200/)
  expect((await diffRows(file, 'line')).map(one => one.props.backgroundColor)).toEqual(['#e86f6f1f', '#72cc821f'])

  // The history, as GitHub lists it: under the day each was made, its first line and hash, then who
  // made it and how long ago.
  await file.press({ key: 'tab:history' })
  expect(await reading(file)).toMatch(
    /Commits on \w{3} \d{1,2}, \d{4} Retry three times a1c9e42 Ada committed \d+ \w+ ago Commits on \w{3} \d{1,2}, \d{4} Add the client 9f3b210 Grace committed/,
  )
  expect(await diffRows(file, 'line')).toEqual([])

  await file.press({ key: 'commit:a1c9e42' })
  expect(await reading(file)).toMatch(/Retry three times .* − export const retry = 1 1 \+ export const retry = 3 Commits on/)

  // A second press closes it.
  await file.press({ key: 'commit:a1c9e42' })
  expect(await diffRows(file, 'line')).toEqual([])
  await file.unmount()
  await files.unmount()
})

test('on the desktop a press anywhere on a commit opens it: a one-line Button for each of its lines', async ($, on) => {
  mock.clock(on)
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })
  await file.press({ key: 'tab:history' })

  // The desktop draws a Button's text on one line: one Button of three lines took a press on the
  // row's top line alone, so each line gets its own.
  type Node = { props?: { key?: string; text?: string }; children?: unknown[] }
  const texts = (one: unknown): string[] =>
    typeof one === 'string' ? [one] : [(one as Node).props?.text ?? '', ...((one as Node).children ?? []).flatMap(texts)]
  const layer = ((await file.findAll({ type: 'Button' })) as unknown as Node[]).filter(one => /^commit:a1c9e42/.test(one.props?.key ?? ''))

  expect(layer.map(one => one.props?.key)).toEqual(['commit:a1c9e42', 'commit:a1c9e42:2', 'commit:a1c9e42:3'])
  expect(layer.every(one => !texts(one).join('').includes('\n'))).toBe(true)

  await file.press({ key: 'commit:a1c9e42:3' })
  expect(await reading(file)).toMatch(/Retry three times .* − export const retry = 1 1 \+ export const retry = 3 Commits on/)
  await file.unmount()
  await files.unmount()
})

test('a commit’s change is read from the path the file had then, from the repository’s top', async ($, on) => {
  mock.clock(on)
  const { ran } = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })
  await file.press({ key: 'tab:history' })
  await file.press({ key: 'commit:9f3b210' })

  const show = ran.find(one => one.argv.includes('show'))

  expect(show?.argv.slice(-3)).toEqual(['9f3b210', '--', ':(top,literal)src/client.js'])
  expect(show?.argv).toEqual(expect.arrayContaining(['--no-ext-diff', '--no-textconv']))
  await file.unmount()
  await files.unmount()
})

test('Markdown opens as its preview, a press away from its source', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'open-row:tree:/proj/README.md' })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })
  const markdown = () => file.findAll({ type: 'Markdown' }) as Promise<Node[]>

  expect((await markdown()).map(one => one.props.text)).toEqual(['# Proj\n\nA *small* project.'])
  expect(await codes(file)).toEqual([])

  await file.press({ key: 'preview' })
  expect(await markdown()).toEqual([])
  expect((await codes(file)).map(one => one.props.source)).toEqual(['# Proj\n\nA *small* project.'])
  await file.unmount()
  await files.unmount()
})

test('a binary file, or one too large, says so instead of drawing it', async ($, on) => {
  mock.clock(on)
  engine(on, { ...DISK, [CLIENT]: 'PK\0\0zip', '/proj/README.md': 'x'.repeat(3 * 1024 * 1024) })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })

  expect(await reading(file)).toMatch(/A binary file: nothing to show as text\./)
  expect(await codes(file)).toEqual([])

  await files.press({ key: 'open-row:tree:/proj/README.md' })
  expect(await reading(file)).toMatch(/Too large to show here\./)
  await file.unmount()
  await files.unmount()
})

test('a file Claude edits shows its new text in the file pane', async ($, on) => {
  mock.clock(on)
  engine(on, { ...DISK })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })

  await $.tool.call({ tool: 'Edit', file_path: CLIENT, old_string: 'retry = 3', new_string: 'retry = 5' })
  expect((await codes(file)).map(one => one.props.source)).toEqual(['export const retry = 5\nexport const backoff = 200'])
  await file.unmount()
  await files.unmount()
})

test('outside the session’s repository the file pane shows the file and reads no git there', async ($, on) => {
  const { ran } = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/work/other/notes.md' })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'open-row:touched:/work/other/notes.md' })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })

  await file.press({ key: 'tab:history' })
  expect(await reading(file)).toMatch(/No history: the file is outside the session’s repository\./)
  await file.press({ key: 'tab:diff' })
  expect(await reading(file)).toMatch(/No changes since the last commit\./)

  const risky = (one: { argv: string[] }) => ['log', 'show', 'diff', 'ls-files', 'status'].some(word => one.argv.includes(word))
  expect(ran.filter(one => one.cwd?.startsWith('/work/other') && risky(one))).toEqual([])
  await file.unmount()
  await files.unmount()
})

test('on the terminal a file’s name opens it, and on every surface its ⋯ offers Open', async ($, on) => {
  const { opened } = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await terminal.press({ key: 'open-row:tree:/proj/README.md' })
  expect(opened.at(-1)).toEqual(expect.objectContaining({ id: 'files-pane-file', title: 'README.md' }))
  await terminal.unmount()

  const vscode = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await vscode.press({ key: 'caret:src' })
  await vscode.press({ key: `more:tree:${CLIENT}` })
  await vscode.press({ key: `file:tree:${CLIENT}` })
  expect(opened.at(-1)).toEqual(expect.objectContaining({ id: 'files-pane-file', title: 'client.js' }))
  await vscode.unmount()
})

test('a file with Windows line ends or an escape in it draws as text, with neither', async ($, on) => {
  mock.clock(on)
  engine(on, { ...DISK, [CLIENT]: 'export const retry = 3\r\nconst red = "\x1b[31m"\r\n' })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await files.press({ key: 'dir:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'terminal' })

  expect((await codes(file)).map(one => one.props.source)).toEqual(['export const retry = 3\nconst red = "[31m"'])
  await file.unmount()
  await files.unmount()
})

test('a diff past what one drawing holds is cut where a hunk ends, and the rest counted', async ($, on) => {
  mock.clock(on)
  const long = (sign: string, n: number) => `${sign}${'x'.repeat(200)} ${n}`
  const hunk = (at: number) => [`@@ -${at},40 +${at},40 @@`, ...Array.from({ length: 20 }, (_, i) => long('-', at + i)), ...Array.from({ length: 20 }, (_, i) => long('+', at + i))]
  const big = ['diff --git a/src/client.js b/src/client.js', '--- a/src/client.js', '+++ b/src/client.js', ...[1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200].flatMap(hunk)].join('\n')
  engine(on, DISK, big)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })
  await file.press({ key: 'tab:diff' })

  // 13 hunks of about 8,300 characters each: ten fit in 90,000, whole.
  expect(await diffRows(file, 'hunk')).toHaveLength(10)
  expect(await diffRows(file, 'line')).toHaveLength(400)
  expect(await reading(file)).toMatch(/123 more lines not shown/)
  await file.unmount()
  await files.unmount()
})

test('a file pressed while the file pane is a tab behind brings it to the front with that file', async ($, on) => {
  mock.clock(on)
  const { opened } = engine(on)
  const closed: string[] = []
  const panes = [
    { id: 'files-pane', title: 'Files: proj', isShown: true, isFocused: true, isPlaced: true },
    { id: 'files-pane-file', title: 'README.md', isShown: false, isFocused: false, isPlaced: true },
  ]
  on('ui.panes', () => ({ value: panes }))
  on('ui.close', (_, e) => {
    closed.push((e as { id: string }).id)

    return { value: undefined }
  })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  expect(closed).toEqual(['files-pane-file'])
  expect(opened.at(-1)).toEqual(expect.objectContaining({ id: 'files-pane-file', title: 'client.js' }))

  // In front already, it is only given the file.
  panes[1]!.isShown = true
  await files.press({ key: 'open-row:tree:/proj/README.md' })
  expect(closed).toEqual(['files-pane-file'])
  await files.unmount()
})

test('a file saved outside Claude shows its new text in the file pane within seconds', async ($, on) => {
  const disk = { ...DISK }
  engine(on, disk)
  on('ui.panes', () => ({ value: [{ id: 'files-pane-file', title: 'client.js', isShown: true, isFocused: false, isPlaced: true }] }))
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })
  await files.press({ key: `open-row:tree:${CLIENT}` })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })
  await clock.advance(3000)
  expect((await codes(file)).map(one => one.props.source)).toEqual(['export const retry = 3\nexport const backoff = 200'])

  // Saved in an editor: no tool call, no turn.
  disk[CLIENT] = 'export const retry = 10\nexport const backoff = 200\n'
  await clock.advance(3000)
  await clock.settle()
  expect((await codes(file)).map(one => one.props.source)).toEqual(['export const retry = 10\nexport const backoff = 200'])
  await file.unmount()
  await files.unmount()
})

test('on the desktop a file row’s ⋯ floats over the press that opens the file, so it stays its own', async ($, on) => {
  mock.clock(on)
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: CLIENT })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'fold:src' })

  // An absolute Box paints over every Box in the flow, and only a later absolute one paints over
  // it: a ⋯ in the row's flow sat under the layer, and a press on it opened the file.
  type Node = { props?: { key?: string; position?: string }; children?: unknown[] }
  const holds = (one: unknown, key: string): boolean =>
    (one as Node | null)?.props?.key === key || ((one as Node | null)?.children ?? []).some(child => holds(child, key))
  const floats = (one: unknown, key: string) => (one as Node | null)?.props?.position === 'absolute' && holds(one, key)
  const boxes = (await files.findAll({ type: 'Box' })) as unknown as Node[]

  for (const where of ['tree', 'touched']) {
    const row = boxes.find(one => (one.children ?? []).some(child => floats(child, `open-row:${where}:${CLIENT}`)))
    const children = row?.children ?? []
    const layer = children.findIndex(child => floats(child, `open-row:${where}:${CLIENT}`))
    const more = children.findIndex(child => floats(child, `more:${where}:${CLIENT}`))

    expect(layer).toBeGreaterThanOrEqual(0)
    expect(more).toBeGreaterThan(layer)
  }

  await files.press({ key: `more:tree:${CLIENT}` })
  expect(((await files.findAll({ type: 'Text', text: /^@ Mention$/ })) as unknown as unknown[]).length).toBe(1)
  await files.unmount()
})

// Pictures, one character a byte: a PNG 2 pixels wide and 1 tall, and a JPEG 1280 by 720, each its
// header and a little after it.
const PNG = '\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x02\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89'
const JPEG = '\xff\xd8\xff\xe0\0\x10JFIF\0\x01\x01\0\0\x01\0\x01\0\0\xff\xc0\0\x11\x08\x02\xd0\x05\0\x03\x01\x22\0\x02\x11\x01\x03\x11\x01'
// A PNG 800 by 400, as a screenshot would be.
const WIDE_PNG = PNG.replace('\0\0\0\x02\0\0\0\x01', '\0\0\x03\x20\0\0\x01\x90')
const SVG = '<?xml version="1.0"?>\n<!-- a dot -->\n<svg viewBox="0 0 2 2"><circle r="1"/></svg>\n'

const svgs = async (ui: { findAll: (q: { type: string }) => Promise<unknown> }) => ((await ui.findAll({ type: 'Svg' })) as Node[]).map(one => String(one.props.source))

test('a picture opens as its preview: SVG as itself, a raster picture inside one, with its type, size and weight', async ($, on) => {
  engine(on, { ...DISK, '/proj/logo.svg': SVG, '/proj/shot.png': PNG })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'open-row:tree:/proj/logo.svg' })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })

  // From its <svg on, with the namespace a picture drawn as an image needs; its markup a press away.
  expect((await svgs(file)).filter(one => one.includes('circle'))).toEqual(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><circle r="1"/></svg>'])
  await file.press({ key: 'preview' })
  expect((await codes(file)).map(one => one.props.source)).toEqual([SVG.trimEnd()])
  await file.press({ key: 'preview' })

  await files.press({ key: 'open-row:tree:/proj/shot.png' })
  expect((await svgs(file)).filter(one => one.includes('data:image'))).toEqual([
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1" width="2" height="1"><image width="2" height="1" href="data:image/png;base64,${btoa(PNG)}"/></svg>`,
  ])
  expect(await reading(file)).toMatch(/PNG · 2 × 1 · 33 B/)
  expect(await codes(file)).toEqual([])
  // A raster picture has no source to switch to.
  expect(await file.find({ key: 'preview' })).toBeUndefined()
  await file.unmount()
  await files.unmount()
})

test('on the terminal a PNG draws as its pixels, in the pane’s width and its own shape; other pictures say what they are', async ($, on) => {
  engine(on, { ...DISK, '/proj/shot.png': WIDE_PNG, '/proj/photo.jpg': JPEG, '/proj/logo.svg': SVG })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await files.press({ key: 'open-row:tree:/proj/shot.png' })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'terminal' })
  const [image] = (await file.findAll({ type: 'Image' })) as Node[]

  // Twice as wide as it is tall: as wide as the pane, a quarter as many rows, as a cell is twice as tall.
  expect(image?.props).toEqual(expect.objectContaining({ source: { file: '/proj/shot.png', format: 'png', generation: 0 }, columns: 46, rows: 12, alt: 'shot.png' }))
  expect(await reading(file)).toMatch(/PNG · 800 × 400 · 33 B/)

  await files.press({ key: 'open-row:tree:/proj/photo.jpg' })
  expect(await file.findAll({ type: 'Image' })).toEqual([])
  expect(await reading(file)).toMatch(/JPEG · 1280 × 720 · \d+ B\. The terminal previews PNG pictures only\./)

  // The terminal draws no SVG: an SVG shows its markup, with nothing to switch.
  await files.press({ key: 'open-row:tree:/proj/logo.svg' })
  expect((await codes(file)).map(one => one.props.source)).toEqual([SVG.trimEnd()])
  expect(await file.find({ key: 'preview' })).toBeUndefined()
  await file.unmount()
  await files.unmount()
})

test('a raster picture past what an SVG holds is described instead of drawn', async ($, on) => {
  engine(on, { ...DISK, '/proj/big.png': PNG + 'x'.repeat(100000) })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'open-row:tree:/proj/big.png' })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })

  expect((await svgs(file)).filter(one => one.includes('data:image'))).toEqual([])
  expect(await reading(file)).toMatch(/PNG · 2 × 1 · 97\.7 KB\. Too large to preview here\./)
  await file.unmount()
  await files.unmount()
})

test('a Markdown preview draws the pictures on lines of their own in their place, from the file’s folder', async ($, on) => {
  const readme = [
    '# Proj',
    '',
    '![The logo](docs/logo.svg)',
    '',
    'Some text.',
    '',
    '![shot](./shot.png "a shot")',
    '',
    '![remote](https://example.com/a.png)',
    '',
    '```md',
    '![in a fence](docs/logo.svg)',
    '```',
  ].join('\n')
  engine(on, { ...DISK, '/proj/README.md': readme, '/proj/docs/logo.svg': SVG, '/proj/shot.png': PNG })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const files = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await files.press({ key: 'open-row:tree:/proj/README.md' })

  const file = await $.ui.mount({ ...FILE_PANE, surface: 'desktop' })
  const markdown = ((await file.findAll({ type: 'Markdown' })) as Node[]).map(one => one.props.text)

  expect(markdown).toEqual(['# Proj\n', '\nSome text.\n', '\n![remote](https://example.com/a.png)\n\n```md\n![in a fence](docs/logo.svg)\n```'])
  expect((await svgs(file)).filter(one => one.includes('circle') || one.includes('data:image'))).toEqual([
    expect.stringContaining('<circle r="1"/>'),
    expect.stringContaining('data:image/png;base64,'),
  ])
  expect(((await file.findAll({ type: 'Svg' })) as Node[]).map(one => one.props.alt)).toEqual(expect.arrayContaining(['The logo', 'shot']))
  await file.unmount()
  await files.unmount()
})
