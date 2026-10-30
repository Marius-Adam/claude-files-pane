// The session the README's demo GIF shows: a made-up project, a made-up task, run against the pane
// on the desktop surface. Every FRAME ms of the mock clock it prints the pane's tree, as the pane
// drew it, and what the chat beside it says; capture.mjs draws those frames.
//
// Not a test of the pane: make.sh copies it into a scratch copy of the mod as a test file, so
// `claude plugin test` can run it, and reads what it prints.
import { expect, mock, test } from 'claude-code/testing'

const FRAME = 100
// How long a piece of streamed text stays before the next.
const PIECE = 200
const HOME = '/Users/you/weather-app'
const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 30, 9, 41)

const entry = (name: string, kind: 'file' | 'dir', daysAgo = 3, size = 1200) => ({ name, kind, size, mtimeMs: NOW - daysAgo * DAY, isLink: false })

const TREE: Record<string, ReturnType<typeof entry>[]> = {
  [HOME]: [
    entry('.github', 'dir'),
    entry('node_modules', 'dir'),
    entry('src', 'dir'),
    entry('tests', 'dir'),
    entry('.gitignore', 'file', 40),
    entry('package.json', 'file', 2),
    entry('README.md', 'file', 9),
    entry('tsconfig.json', 'file', 40),
  ],
  [`${HOME}/src`]: [entry('api', 'dir'), entry('components', 'dir'), entry('App.tsx', 'file', 3), entry('main.tsx', 'file', 9)],
  [`${HOME}/src/api`]: [entry('client.ts', 'file', 6), entry('forecast.ts', 'file', 6)],
  [`${HOME}/src/components`]: [entry('Forecast.tsx', 'file', 4), entry('Header.tsx', 'file', 12)],
  [`${HOME}/tests`]: [entry('client.test.ts', 'file', 6), entry('forecast.test.ts', 'file', 6)],
  [`${HOME}/.github`]: [entry('workflows', 'dir')],
}

// What git answers: the files changed and their line counts, HEAD, how far ahead, the last commit's files.
const git = { dirty: [] as string[], lines: {} as Record<string, [number, number]>, head: '7d2e0b1', ahead: 0, committed: [] as string[] }

// What `git diff` shows of the edited client: the retry the person reviews in the pane.
const DIFF = `diff --git a/src/api/client.ts b/src/api/client.ts
--- a/src/api/client.ts
+++ b/src/api/client.ts
@@ -12,9 +12,19 @@ export async function fetchForecast(city: string) {
-  const res = await fetch(forecastUrl(city))
-  if (!res.ok) throw new ForecastError(res.status)
-  return res.json()
+  for (let attempt = 0; ; attempt++) {
+    const res = await fetch(forecastUrl(city))
+    if (res.ok) return res.json()
+    if (attempt === RETRIES || res.status < 500) {
+      throw new ForecastError(res.status)
+    }
+    await sleep(BASE_MS * 2 ** attempt)
+  }
 }
`

// A line of the chat: the person's ask, a tool call (live while it runs), or Claude's answer.
type Chat = { kind: 'user' | 'tool' | 'text'; verb?: string; detail?: string; text?: string; isLive?: boolean }

test('record', { timeoutMs: 900_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The script's own time, in step with the mock clock. A test's hooks cannot sleep on the clock,
  // so a tool call waits here instead, woken by the frame that passes its deadline.
  let time = 0
  const waits: { at: number; wake: () => void }[] = []
  const sleep = (ms: number) => new Promise<void>(wake => waits.push({ at: time + ms, wake }))
  // How long the next tool call takes, and what the next model step streams.
  let toolMs = 0
  let pieces: { kind: 'thinking' | 'text'; text: string }[] = []

  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: HOME }))
  on('fs.list', (_, e) => ({ value: TREE[(e as { path: string }).path] ?? [] }))
  on('tool.call', async (_, e) => {
    await sleep(toolMs)
    const call = e as { tool: string; command?: string; file_path?: string }

    if (call.tool === 'Edit' && call.file_path) {
      const path = call.file_path.slice(HOME.length + 1)
      git.dirty.push(` M ${path}`)
      git.lines[path] = path.includes('test') ? [38, 0] : path.includes('Header') ? [3, 1] : [24, 6]
    }

    if (call.command?.startsWith('git commit')) {
      git.committed = git.dirty.map(line => line.slice(3))
      git.dirty = []
      git.lines = {}
      git.head = 'a1c9e42'
      git.ahead = 1
    }

    return { result: {} }
  })
  on('process.run', (_, e) => {
    const { argv } = e as { argv: string[] }
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

    if (argv.includes('--absolute-git-dir')) return out(`${HOME}/.git\n`)
    if (argv.includes('--show-toplevel')) return out(`${HOME}\n`)
    if (argv.includes('--abbrev-ref')) return out('main\n')
    if (argv.includes('--short') && argv.includes('rev-parse')) return out(`${git.head}\n`)
    if (argv.includes('status')) return out(git.dirty.map(line => `${line}\n`).join(''))
    if (argv.includes('diff') && !argv.includes('--numstat')) return out(DIFF)
    if (argv.includes('--numstat')) return out(Object.entries(git.lines).map(([path, [a, d]]) => `${a}\t${d}\t${path}\n`).join(''))
    if (argv.includes('rev-list')) return out(`${git.ahead}\n`)
    if (argv.includes('--ignored')) return out('node_modules/\n')
    if (argv.includes('ls-files')) return out(Object.entries(TREE).flatMap(([dir, list]) => list.filter(one => one.kind === 'file').map(one => `${dir}/${one.name}`.slice(HOME.length + 1))).join('\n'))
    if (argv.includes('show')) return out(git.committed.map(path => `${path}\n`).join(''))

    return out('')
  })
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* () {
    for (const piece of pieces) yield { ...piece, index: 0 } as never

    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })

  await $.session.start({ cwd: HOME, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'files-pane',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'files-pane',
    props: { title: 'Files: weather-app', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  } as never)

  // Each tree is printed once, at the end; a frame names its tree by index.
  const chat: Chat[] = []
  const trees: string[] = []
  let pressing: string | null = null
  const shot = async () => {
    const tree = JSON.stringify(await ui.drawn())
    let at = trees.indexOf(tree)
    if (at < 0) at = trees.push(tree) - 1
    console.log(`FRAME ${JSON.stringify({ time, tree: at, chat, press: pressing })}`)
  }
  const hold = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += FRAME) {
      await shot()
      await clock.advance(FRAME)
      time += FRAME
      for (const one of waits.filter(w => w.at <= time)) {
        waits.splice(waits.indexOf(one), 1)
        one.wake()
      }
      await clock.advance(0)
    }
  }
  // Frames until `work` settles: a woken call may finish a frame or two after its deadline.
  const until = async (work: Promise<unknown>) => {
    let isDone = false
    void work.then(() => (isDone = true), () => (isDone = true))
    while (!isDone) await hold(FRAME)
  }
  // A stream drawn as it grows: one whole step per piece, each carrying the words so far, since a
  // drawing waits for an open stream to settle. The card shows the newest words either way.
  const stream = async (kind: 'thinking' | 'text', words: string, chunk = 3) => {
    const parts = words.split(' ')
    for (let i = chunk; i < parts.length + chunk; i += chunk) {
      const text = parts.slice(0, i).join(' ')
      pieces = [{ kind, text }]
      for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'demo', messageCount: 1 } as never) as never as AsyncIterable<unknown>) {
        // Drained as the engine would.
      }
      if (kind === 'text') chat[chat.length - 1].text = text
      await hold(PIECE)
    }
  }
  // The pointer rests on the element a moment, the press lands, and the pointer lingers.
  const press = async (key: string, before = 700, after = 500) => {
    pressing = key
    await hold(before)
    await ui.press({ key } as never)
    await hold(after)
    pressing = null
  }
  const tool = async (call: Record<string, unknown>, row: Chat, ms: number) => {
    chat.push({ ...row, kind: 'tool', isLive: true })
    toolMs = ms
    await until($.tool.call(call as never))
    chat[chat.length - 1].isLive = false
  }

  // The pane at rest, then the person's ask.
  await hold(1200)
  chat.push({ kind: 'user', text: 'Retry failed forecast requests with exponential backoff, and add a test.' })
  await $.turn.start({ turnId: 't1', prompt: '' } as never).catch(() => {})
  await hold(500)
  await stream('thinking', 'Forecast requests fail outright on a flaky network. I will find where they are made, then wrap the fetch in a retry that backs off.')
  await hold(400)

  await tool({ tool: 'Grep', pattern: 'fetchForecast', path: 'src' }, { verb: 'Search', detail: '"fetchForecast"' }, 1200)
  await tool({ tool: 'Read', file_path: `${HOME}/src/api/client.ts` }, { verb: 'Read', detail: 'src/api/client.ts' }, 1400)
  await tool({ tool: 'Read', file_path: `${HOME}/tests/client.test.ts` }, { verb: 'Read', detail: 'tests/client.test.ts' }, 1200)
  await hold(300)
  await tool({ tool: 'Edit', file_path: `${HOME}/src/api/client.ts`, old_string: 'a', new_string: 'b' }, { verb: 'Update', detail: 'src/api/client.ts' }, 2000)
  await hold(600)
  await tool({ tool: 'Edit', file_path: `${HOME}/tests/client.test.ts`, old_string: 'a', new_string: 'b' }, { verb: 'Update', detail: 'tests/client.test.ts' }, 1800)
  await hold(600)
  await tool({ tool: 'Bash', command: 'npm test -- tests/client.test.ts', description: 'Run the client tests' }, { verb: 'Bash', detail: 'npm test -- tests/client.test.ts' }, 1800)
  await hold(400)

  chat.push({ kind: 'text', text: '' })
  await stream('text', 'Failed forecast requests now retry up to 3 times with exponential backoff (250 ms, 500 ms, 1 s). Added 4 tests in tests/client.test.ts; all pass.')
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1000, isAborted: false } as never).catch(() => {})
  await hold(900)

  // The person reviews the change in the pane: the file's ⋯, then its diff, then closed again.
  const client = `${HOME}/src/api/client.ts`
  await press(`more:touched:${client}`)
  await press(`diff:touched:${client}`, 600, 3200)
  await press(`diff:touched:${client}`, 500, 200)
  await press(`more:touched:${client}`, 400, 600)

  // A second turn: commit, then a small change elsewhere.
  chat.push({ kind: 'user', text: 'Commit it, then show the retry count in the header.' })
  await $.turn.start({ turnId: 't2', prompt: '' } as never).catch(() => {})
  await hold(400)
  await tool({ tool: 'Bash', command: 'git commit -am "Retry forecast requests with backoff"', description: 'Commit the change' }, { verb: 'Bash', detail: 'git commit -m "Retry forecast requests with backoff"' }, 1200)
  await hold(900)
  await tool({ tool: 'Read', file_path: `${HOME}/src/components/Header.tsx` }, { verb: 'Read', detail: 'src/components/Header.tsx' }, 1100)
  await tool({ tool: 'Edit', file_path: `${HOME}/src/components/Header.tsx`, old_string: 'a', new_string: 'b' }, { verb: 'Update', detail: 'src/components/Header.tsx' }, 1600)
  await hold(400)
  chat.push({ kind: 'text', text: '' })
  await stream('text', 'Committed a1c9e42. The header now shows the retry count while a forecast request is retrying.', 4)
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1000, isAborted: false } as never).catch(() => {})
  await hold(900)

  // The whole session's files, the first turn's committed ones too; then a closed folder, opened
  // by a press anywhere on its row.
  await press('scope', 700, 2200)
  await press('fold:.github', 700, 1800)
  await hold(1200)

  trees.forEach((tree, at) => console.log(`TREE ${at} ${tree}`))
  await ui.unmount()
  expect(trees.length).toBeGreaterThan(0)
})
