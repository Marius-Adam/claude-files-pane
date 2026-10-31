import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

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

// The engine, as little as the touched list needs: a project at /proj with nothing in it and no
// git, so every row the pane draws is the touched list's or its frame's.
const engine = (on: Parameters<TestBody>[1]) => {
  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}

type Ui = { findAll: (q: { type: string; text?: RegExp }) => Promise<unknown> }

// Every text the pane draws, so a word can be looked for anywhere in it.
const texts = async (ui: Ui) => ((await ui.findAll({ type: 'Text' })) as { text?: string }[]).map(one => one.text ?? '')
const notes = async (ui: Ui) => (await texts(ui)).filter(one => /^n\d+\.md$/.test(one)).length

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the fold row says how many more, opened says Show fewer, and never "earlier" (${surface})`, async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/proj', surface, isInteractive: true })
    for (let i = 1; i <= 11; i++) await $.tool.call({ tool: 'Read', file_path: `/proj/notes/n${i}.md` })

    const ui = await $.ui.mount({ ...PANE, surface })

    // Folded: the newest eight, and one row for the three older.
    expect(await notes(ui)).toBe(8)
    expect((await texts(ui)).filter(one => /\b3 more$/.test(one))).toHaveLength(1)
    expect((await texts(ui)).some(one => /Show fewer/.test(one))).toBe(false)
    expect((await texts(ui)).filter(one => /earlier/i.test(one))).toEqual([])

    // Opened: every file, and the same row now folds them.
    await ui.press({ key: 'touched-all' })
    expect(await notes(ui)).toBe(11)
    expect((await texts(ui)).filter(one => /Show fewer$/.test(one))).toHaveLength(1)
    expect((await texts(ui)).some(one => /\bmore$/.test(one))).toBe(false)
    expect((await texts(ui)).filter(one => /earlier/i.test(one))).toEqual([])

    await ui.press({ key: 'touched-all' })
    expect(await notes(ui)).toBe(8)
    expect((await texts(ui)).filter(one => /\b3 more$/.test(one))).toHaveLength(1)
    await ui.unmount()
  })
}

test('with Whole session on, the fold row counts every turn’s files and still says "more"', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.turn.start({ turnId: 't1', prompt: 'look' } as never)
  for (let i = 1; i <= 6; i++) await $.tool.call({ tool: 'Read', file_path: `/proj/notes/n${i}.md` })
  await $.turn.start({ turnId: 't2', prompt: 'again' } as never)
  for (let i = 7; i <= 12; i++) await $.tool.call({ tool: 'Read', file_path: `/proj/notes/n${i}.md` })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // This turn's six: nothing to fold.
  expect(await notes(ui)).toBe(6)
  expect((await texts(ui)).some(one => /\bmore$|Show fewer/.test(one))).toBe(false)

  await ui.press({ key: 'scope' })
  expect(await notes(ui)).toBe(8)
  expect((await texts(ui)).filter(one => /\b4 more$/.test(one))).toHaveLength(1)
  expect((await texts(ui)).filter(one => /earlier/i.test(one))).toEqual([])
  await ui.unmount()
})

test('one file past the fold reads "1 more"', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  for (let i = 1; i <= 9; i++) await $.tool.call({ tool: 'Read', file_path: `/proj/notes/n${i}.md` })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await notes(ui)).toBe(8)
  expect((await texts(ui)).filter(one => /\b1 more$/.test(one))).toHaveLength(1)
  await ui.unmount()
})
