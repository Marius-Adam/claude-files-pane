import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Git, Now, Status, Touch, View } from '../types'
import { fileIcon, folderIcon } from './icons'

const PANE = 'files-pane'
const READS = new Set(['Read'])
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const COMMIT = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/
const TREE_ROWS = 300
const MATCHES = 50
const SKIP = new Set(['.git'])

// Hidden files show by default, as in VS Code's explorer: the toolbar offers to hide them.
const DEFAULT_VIEW: View = { query: '', dir: '', expanded: [], showSizes: false, showHidden: true }

// Raw colors, so the pane looks the same whatever the theme. A tint is the color at low alpha.
const READ = '#ad8cf2'
const EDIT = '#e8914f'
const DIRTY = '#e2c07f'
const DONE = '#72cc82'
const ADDED = '#72cc82'
const REMOVED = '#e86f6f'
const FOLDER = '#7fa7e3'
const MUTED = '#8a8a8a'
const tint = (color: string, alpha = '26') => `${color}${alpha}`
const HOVER = '#8080801a'
const CLEAR = '#00000000'
// The soft surfaces cards sit on, from the person's theme, light or dark.
const CARD = 'userMessageBackground'
const CARD_EDGE = '#8080802e'

// Change a tag when its value's fields change: it declines what an earlier version stored.
const now = atom({ plugin: 'files-pane', key: 'now' } as const, null, { shape: 'now-2' })
const touched = atom({ plugin: 'files-pane', key: 'touched' } as const, [], { shape: 'touched-2' })
const view = atom({ plugin: 'files-pane', key: 'view' } as const, DEFAULT_VIEW, { shape: 'view-2' })
const git = atom({ plugin: 'files-pane', key: 'git' } as const, null, { shape: 'git-3' })
const status = atom({ plugin: 'files-pane', key: 'status' } as const, null, { shape: 'status-1' })
// Bumped by Refresh so the tree is listed again.
const tick = atom({ plugin: 'files-pane', key: 'tick' } as const, 0)

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
const rel = (cwd: string, path: string) => (path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path)
// A folder as the pane prints it: a file outside the project gets its home folder as `~`.
const where = (dir: string) => dir.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const sizeOf = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Today's files show the time, older ones the day: 15:40, 3 Sep, 3 Sep 2024.
const whenOf = (ms: number) => {
  if (!ms) return ''

  const date = new Date(ms)
  const today = new Date()

  if (date.toDateString() === today.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`

  return date.getFullYear() === today.getFullYear() ? day : `${day} ${date.getFullYear()}`
}

// The chip before a file's name: its type, in that type's color.
const KINDS: Record<string, [string, string]> = {
  js: ['JS', '#e5c07b'],
  jsx: ['JS', '#e5c07b'],
  mjs: ['JS', '#e5c07b'],
  cjs: ['JS', '#e5c07b'],
  ts: ['TS', '#6cb0f0'],
  tsx: ['TS', '#6cb0f0'],
  json: ['{ }', '#98c379'],
  md: ['MD', '#6cb0f0'],
  mdx: ['MD', '#6cb0f0'],
  pdf: ['PDF', '#e06c75'],
  csv: ['CSV', '#98c379'],
  doc: ['DOC', '#6cb0f0'],
  docx: ['DOC', '#6cb0f0'],
  xls: ['XLS', '#98c379'],
  xlsx: ['XLS', '#98c379'],
  css: ['CSS', '#c678dd'],
  html: ['HTML', '#e5a050'],
  py: ['PY', '#6cb0f0'],
  sh: ['SH', '#98c379'],
  yml: ['YML', '#d19a66'],
  yaml: ['YML', '#d19a66'],
  toml: ['TOML', '#d19a66'],
  png: ['IMG', '#c678dd'],
  jpg: ['IMG', '#c678dd'],
  jpeg: ['IMG', '#c678dd'],
  gif: ['IMG', '#c678dd'],
  svg: ['SVG', '#c678dd'],
  webp: ['IMG', '#c678dd'],
  txt: ['TXT', MUTED],
}

const kindOf = (name: string): [string, string] => {
  if (name.startsWith('.git') || name === '.gitignore') return ['GIT', MUTED]

  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''

  return KINDS[ext] ?? [ext ? ext.slice(0, 3).toUpperCase() : '•', MUTED]
}

// Icons, drawn as SVG where the surface has it; the terminal gets the glyph instead.
// Files and folders wear vscode-icons (icons.ts); the rest are drawn here.
const svg = (size: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

const BRANCH_SVG = svg(
  18,
  `<g stroke="${READ}" stroke-width="1.8"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-11 7"/></g>`,
)

const GLYPHS = {
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  spark: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  idle: '<circle cx="12" cy="12" r="6"/>',
} as const

// How the badge moves: a halo while Claude has a file, a spinning arc while it thinks, a check
// that draws itself when done, a slow breath while idle. SVG animation runs inside an image, so
// it needs nothing from the surface; a redraw starts it again, which none of these show.
type Motion = 'pulse' | 'spin' | 'draw' | 'breathe'

const halo = (color: string, delay: string) =>
  `<circle cx="28" cy="28" r="18" fill="none" stroke="${color}" stroke-width="2" opacity="0"><animate attributeName="r" values="18;27" dur="1.8s" begin="${delay}" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0" dur="1.8s" begin="${delay}" repeatCount="indefinite"/></circle>`

const MOTION: Record<Motion, (color: string) => string> = {
  pulse: color => halo(color, '0s') + halo(color, '0.9s'),
  spin: color =>
    `<circle cx="28" cy="28" r="21" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="34 98"><animateTransform attributeName="transform" type="rotate" from="0 28 28" to="360 28 28" dur="1.1s" repeatCount="indefinite"/></circle>`,
  draw: color => `<circle cx="28" cy="28" r="21" fill="none" stroke="${tint(color, '66')}" stroke-width="1.5"/>`,
  breathe: () => '',
}

// The badge at the left of the card: the glyph on a soft gradient disc of its color, moving.
const badgeSvg = (glyph: keyof typeof GLYPHS, color: string, motion: Motion) => {
  const body =
    motion === 'draw' && glyph === 'check'
      ? '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-dasharray="24" stroke-dashoffset="24"><animate attributeName="stroke-dashoffset" from="24" to="0" dur="0.6s" begin="0.15s" fill="freeze"/></path>'
      : GLYPHS[glyph]
  const breath =
    motion === 'breathe' ? '<animate attributeName="opacity" values="1;0.5;1" dur="3.2s" repeatCount="indefinite"/>' : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56" fill="none" stroke-linecap="round" stroke-linejoin="round"><defs><radialGradient id="g" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${color}" stop-opacity="0.45"/><stop offset="1" stop-color="${color}" stop-opacity="0.12"/></radialGradient></defs>${MOTION[motion](color)}<circle cx="28" cy="28" r="18" fill="url(#g)"/><circle cx="28" cy="28" r="17.5" stroke="${tint(color, '59')}"/><g transform="translate(18 18) scale(0.8333)" stroke="${color}" stroke-width="2.2">${body}${breath}</g></svg>`
}

// A band of light sweeping across a row Claude is working on. Stretched to the row by
// preserveAspectRatio="none" and clipped to its rounded corners.
const shimmerSvg = (color: string, width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 100 10" preserveAspectRatio="none"><defs><linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset="0.5" stop-color="${color}" stop-opacity="0.3"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><rect x="-35" y="0" width="35" height="10" fill="url(#s)"><animate attributeName="x" values="-35;100" dur="1.6s" repeatCount="indefinite"/></rect></svg>`

// A small dot: pulsing while live, still otherwise.
const dotSvg = (color: string, isLive: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">${
    isLive
      ? `<circle cx="6" cy="6" r="3" fill="${color}" opacity="0"><animate attributeName="r" values="3;6" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0" dur="1.4s" repeatCount="indefinite"/></circle>`
      : ''
  }<circle cx="6" cy="6" r="3" fill="${color}"/></svg>`

const TEXT_GLYPH: Record<keyof typeof GLYPHS, string> = { eye: '◉', pencil: '✎', check: '✓', spark: '✳', idle: '○' }

// The folder above `dir`, which may climb past the project as `..` segments.
const parentOf = (dir: string) => {
  if (dir === '' || dir.split('/').every(part => part === '..')) return join(dir, '..')

  return dirOf(dir)
}

// The file a tool call reads or edits, if it is one of those.
const touchOf = (e: { tool: string }) => {
  const input = e as unknown as Record<string, unknown>
  const path = typeof input.file_path === 'string' ? input.file_path : input.notebook_path

  if (typeof path !== 'string') return null
  if (EDITS.has(e.tool)) return { path, isEdit: true }
  if (READS.has(e.tool)) return { path, isEdit: false }

  return null
}

const isCommit = (e: { tool: string }) => {
  const command = (e as unknown as Record<string, unknown>).command

  return e.tool === 'Bash' && typeof command === 'string' && COMMIT.test(command)
}

const upsert = (list: Touch[], path: string, isEdit: boolean): Touch[] => {
  const old = list.find(one => one.path === path)
  const touch: Touch = { path, isEdited: isEdit || Boolean(old?.isEdited), isActive: true, isCommitted: false }

  // A file keeps its place in the list: files stay in the order Claude first touched them.
  return old ? list.map(one => (one.path === path ? touch : one)) : [...list, touch].slice(-100)
}

// The tree opened down to a file Claude picked up, as VS Code reveals the active file: every
// folder above it, from the folder shown. A file outside the project opens nothing.
const reveal = (old: View, path: string): View => {
  if (path.startsWith('/') || path.startsWith('../')) return old

  const parts = path.split('/').slice(0, -1)
  const folders = parts.map((_, i) => parts.slice(0, i + 1).join('/')).filter(dir => !old.dir || dir.startsWith(`${old.dir}/`))
  const missing = folders.filter(dir => !old.expanded.includes(dir))

  return missing.length === 0 ? old : { ...old, expanded: [...old.expanded, ...missing] }
}

const run = ($: EngineInterface, argv: string[], timeoutMs = 10000) => $.process.run(argv, { timeoutMs }).catch(() => null)

const readGit = async ($: EngineInterface): Promise<Git | null> => {
  const head = await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], 5000)

  if (!head || head.exitCode !== 0) return null

  // --short keeps paths relative to the working directory, as the tree spells them.
  const [state, numstat, ahead, ignored] = await Promise.all([
    run($, ['git', 'status', '--short', '-uall']),
    run($, ['git', 'diff', '--numstat', '--relative', 'HEAD']),
    run($, ['git', 'rev-list', '--count', '@{u}..HEAD'], 5000),
    // `--directory` names an ignored folder once, as `node_modules/`, not every file in it.
    run($, ['git', 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory']),
  ])
  const changed = (state?.stdout ?? '')
    .split('\n')
    .filter(line => line.length > 3)
    .map(line => line.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, ''))
  const lines: Record<string, [number, number]> = {}

  for (const line of (numstat?.stdout ?? '').split('\n')) {
    const [added, removed, path] = line.split('\t')

    // A binary file counts as `-`: it has no lines to show.
    if (path && /^\d+$/.test(added ?? '') && /^\d+$/.test(removed ?? '')) lines[path] = [Number(added), Number(removed)]
  }

  return {
    branch: head.stdout.trim(),
    ahead: ahead && ahead.exitCode === 0 ? Number(ahead.stdout.trim()) || 0 : null,
    changed,
    lines,
    ignored: (ignored?.stdout ?? '').split('\n').filter(Boolean).slice(0, 2000),
  }
}

// Every file under the working directory, for search: git's list, else a bounded walk.
let fileIndex: string[] | null = null

const indexFiles = async ($: EngineInterface): Promise<string[]> => {
  if (fileIndex) return fileIndex

  const listed = await run($, ['git', 'ls-files', '--cached', '--others', '--exclude-standard'])

  if (listed && listed.exitCode === 0) {
    fileIndex = listed.stdout.split('\n').filter(Boolean)

    return fileIndex
  }

  const found: string[] = []
  const queue = ['']

  while (queue.length > 0 && found.length < 5000) {
    const dir = queue.shift()!
    const entries = await $.fs.list(dir || undefined).catch(() => [])

    for (const entry of entries) {
      if (SKIP.has(entry.name) || entry.name === 'node_modules') continue
      if (entry.kind === 'dir') queue.push(join(dir, entry.name))
      else found.push(join(dir, entry.name))
    }
  }

  fileIndex = found

  return found
}

// A pane draws again only when asked: every write below ends with this.
const redraw = ($: EngineInterface) => $.ui.invalidate('ui.render')

const refreshGit = async ($: EngineInterface) => {
  const next = await readGit($)
  await update($, git, () => next)
  redraw($)
}

const openPane = async ($: EngineInterface) => {
  const cwd = await $.session.cwd().catch(() => '')

  return $.ui.open({ id: PANE, title: `Files: ${base(cwd) || 'project'}` })
}

// The card between tools: what this turn has done so far.
const between = (list: Touch[]): Now =>
  list.some(one => one.isEdited)
    ? { verb: 'done', edited: list.filter(one => one.isEdited).map(one => one.path), read: list.filter(one => !one.isEdited).map(one => one.path) }
    : { verb: 'thinking' }

// Set up once per session: /files, the pane and git. session.start alone is not enough: a mod
// installed while a session runs is loaded into it after the start, and an organization's guard
// may skip a user mod's session.start. The first turn then does it instead.
let isReady = false

const setUp = async ($: EngineInterface) => {
  if (isReady) return

  isReady = true
  await $.command.register({ name: 'files', description: 'Show the Files pane: what Claude reads and edits, and the project tree' })
  void openPane($).catch(() => {})
  void refreshGit($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setUp($).catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'files' }, async $ => {
    await openPane($)

    return { text: 'Files pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    if (isCommit(e)) {
      await update($, status, () => ({ verb: 'committing' }) as const).catch(() => {})
      redraw($)

      try {
        return await next(e)
      } finally {
        await afterCommit($).catch(() => {})
      }
    }

    const hit = touchOf(e)

    if (!hit) return next(e)

    // The pane's bookkeeping never stands between Claude and its tool: a failure here is dropped.
    const path = rel(await $.session.cwd().catch(() => ''), hit.path)
    await update($, now, () => ({ verb: hit.isEdit ? 'editing' : 'reading', path }) as const).catch(() => {})
    await update($, touched, list => upsert(list, path, hit.isEdit)).catch(() => {})
    await update($, view, old => reveal(old, path)).catch(() => {})
    redraw($)

    try {
      return await next(e)
    } finally {
      const list = await update($, touched, old => old.map(one => (one.path === path ? { ...one, isActive: false } : one))).catch(() => null)

      if (list && !list.some(one => one.isActive)) await update($, now, () => between(list)).catch(() => {})
      redraw($)

      if (hit.isEdit) {
        fileIndex = null
        void refreshGit($)
      }
    }
  })

  on('turn.start', async ($, e, next) => {
    await setUp($).catch(() => {})

    if (!e.agentId) {
      await update($, touched, () => [])
      await update($, now, () => ({ verb: 'thinking' }) as const)
      await update($, status, () => null)
      redraw($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const list = (await read($, touched)).map(one => ({ ...one, isActive: false }))
    await update($, touched, () => list)

    // A commit this turn stays the card's news; otherwise the turn's summary.
    if ((await read($, now))?.verb !== 'committed') {
      await update($, now, () => ({
        verb: 'done' as const,
        edited: list.filter(one => one.isEdited).map(one => one.path),
        read: list.filter(one => !one.isEdited).map(one => one.path),
      }))
    }

    void refreshGit($)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Search needs a text field and the icons an SVG, which not every surface draws.
    const Input = 'Input' in elements ? elements.Input : null
    // The terminal's table answers `in` for Svg too, but draws none: ask the surface.
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : null
    const [cur, list, v, g, foot] = await Promise.all([read($, now), read($, touched), read($, view), read($, git), read($, status)])
    await read($, tick)
    const cwd = await $.session.cwd()
    const project = base(cwd)
    const changed = new Set(g?.changed ?? [])
    const byPath = new Map(list.map(one => [one.path, one]))
    const setView = async (patch: Partial<View>) => {
      await update($, view, old => ({ ...old, ...patch }))
      redraw($)
    }

    const toggle = (path: string) => {
      const isOpen = v.expanded.includes(path)

      return setView({ expanded: isOpen ? v.expanded.filter(one => one !== path) : [...v.expanded, path] })
    }

    // Every Svg names itself in `alt`: the desktop drops one whose alt is empty.
    const icon = (source: string, alt: string, glyph: string, color: string, size = 18) =>
      Svg ? <Svg source={source} alt={alt} width={size} height={size} /> : <Text color={color}>{glyph}</Text>

    // A file's icon: its vscode-icons SVG, or on the terminal a chip naming its type.
    const chip = (name: string) => {
      if (Svg) return <Svg source={fileIcon(name)} alt={name} width={16} height={16} />

      const [label, color] = kindOf(name)

      return (
        <Text color={color} backgroundColor={tint(color, '22')} mono size="caption" weight="semibold">
          {` ${label} `}
        </Text>
      )
    }

    // A toolbar action: quiet text that a press runs, dimmer when it would change nothing.
    const tool = (key: string, label: string, onPress: () => unknown, isIdle = false) => (
      <Button key={key} plain label={label} onPress={onPress}>
        <Text size="footnote" color={isIdle ? undefined : MUTED} dimColor={isIdle}>
          {label}
        </Text>
      </Button>
    )

    // A surface that paints (not the terminal, where a border is box-drawing characters three rows
    // tall): it gets rounded pills and rows, soft cards and moving badges.
    const isRich = Svg !== null
    // A bordered Box is what the desktop rounds; a clear border keeps the corner without a line.
    const rounded = (color = CLEAR) => (isRich ? ({ borderStyle: 'round', borderColor: color } as const) : {})

    const dot = (color: string, isLive = false) =>
      Svg ? <Svg source={dotSvg(color, isLive)} alt={isLive ? 'live' : 'mark'} width={12} height={12} /> : <Text color={color}>●</Text>

    // The shimmer over a row, laid on top of it and clipped by it: the row is `overflow="hidden"`.
    // Wider and taller than any row, so it always covers; the row cuts it to size.
    const sweepWidth = Math.min(4096, Math.max(240, e.props.bodyColumns * 10))
    const shimmer = (color: string, height = 48) =>
      Svg ? (
        <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
          <Svg source={shimmerSvg(color, sweepWidth, height)} alt="working" width={sweepWidth} height={height} />
        </Box>
      ) : null

    // A rounded chip of a color's tint, a live one with a pulsing dot.
    const pill = (label: string, color: string, isLive = false) =>
      isRich ? (
        <Box {...rounded(tint(color, '4d'))} backgroundColor={tint(color, '1f')} paddingX={1} paddingY={0} gap="xs" alignItems="center">
          {isLive && dot(color, true)}
          <Text color={color} size="footnote" weight="semibold">
            {label}
          </Text>
        </Box>
      ) : (
        <Text color={color} backgroundColor={tint(color, '2e')} size="footnote" weight="semibold">
          {` ${label} `}
        </Text>
      )

    const counts = (path: string) => {
      const pair = g?.lines[path]

      if (!pair) return null

      return (
        <Text size="footnote" tabular>
          <Text color={ADDED}>+{pair[0]}</Text> <Text color={REMOVED}>−{pair[1]}</Text>
        </Text>
      )
    }

    // The accent a touched file carries: green once committed, orange once edited, purple once read.
    const accentOf = (one: Touch) => (one.isCommitted ? DONE : one.isEdited ? EDIT : READ)

    const card = (() => {
      if (cur === null) {
        return {
          kicker: 'RIGHT NOW',
          color: MUTED,
          glyph: 'idle' as const,
          motion: 'breathe' as const,
          title: 'Waiting for Claude',
          sub: <Text dimColor>nothing touched yet</Text>,
        }
      }

      if (cur.verb === 'thinking') {
        const opened = list.filter(one => !one.isEdited).length

        return {
          kicker: 'RIGHT NOW',
          color: MUTED,
          glyph: 'spark' as const,
          motion: 'spin' as const,
          title: 'Claude is thinking',
          sub: opened > 0 ? <Text dimColor>opened {plural(opened, 'file')}</Text> : <Text dimColor>in {project}</Text>,
        }
      }

      if (cur.verb === 'committed') {
        return {
          kicker: 'DONE',
          color: DONE,
          glyph: 'check' as const,
          motion: 'draw' as const,
          title: `Claude committed ${plural(cur.files.length, 'file')}`,
          sub: <Text dimColor>{cur.hash}</Text>,
        }
      }

      if (cur.verb === 'done') {
        if (cur.edited.length === 0) {
          return {
            kicker: 'DONE',
            color: DONE,
            glyph: 'check' as const,
            motion: 'draw' as const,
            title: cur.read.length > 0 ? `Claude read ${plural(cur.read.length, 'file')}` : 'Claude touched no files',
            sub: <Text dimColor>nothing changed</Text>,
          }
        }

        // One edited file names its path and, in git, its line counts; otherwise names and what was opened.
        const one = cur.edited.length === 1 ? cur.edited[0]! : null
        const pair = one ? g?.lines[one] : undefined
        const folders = new Set(cur.read.map(dirOf))
        const where = folders.size === 1 && [...folders][0] ? base([...folders][0]!) : 'files'
        const opened = cur.read.length > 0 ? `, opened ${cur.read.length} ${cur.read.length === 1 && where === 'files' ? 'file' : where}` : ''

        return {
          kicker: 'DONE',
          color: EDIT,
          glyph: 'pencil' as const,
          motion: 'draw' as const,
          title: `Claude edited ${plural(cur.edited.length, 'file')}`,
          sub:
            one && pair ? (
              <Text dimColor>
                {one} <Text color={ADDED}>+{pair[0]}</Text> <Text color={REMOVED}>−{pair[1]}</Text>
              </Text>
            ) : (
              <Text dimColor wrap="truncate-end">
                {cur.edited.slice(0, 2).map(base).join(', ')}
                {cur.edited.length > 2 ? ` and ${cur.edited.length - 2} more` : ''}
                {opened}
              </Text>
            ),
        }
      }

      const isEdit = cur.verb === 'editing'

      return {
        kicker: 'RIGHT NOW',
        color: isEdit ? EDIT : READ,
        glyph: isEdit ? ('pencil' as const) : ('eye' as const),
        motion: 'pulse' as const,
        title: `Claude is ${cur.verb} ${base(cur.path)}`,
        sub: (
          <Text dimColor wrap="truncate-start">
            in {where(dirOf(cur.path)) || project}
          </Text>
        ),
      }
    })()

    // What git ignores draws dim, as in VS Code's explorer: the path itself or a folder above it.
    const ignored = new Set(g?.ignored ?? [])
    const isIgnored = (path: string, isDir: boolean) => {
      if (ignored.has(isDir ? `${path}/` : path)) return true

      const parts = path.split('/')

      return parts.slice(0, -1).some((_, i) => ignored.has(`${parts.slice(0, i + 1).join('/')}/`))
    }

    // A folder's changed files under it, for its count and its icon's color.
    const changedUnder = (dir: string) => (g?.changed ?? []).filter(one => one.startsWith(`${dir}/`)).length
    // The touched file under a folder that Claude has in hand, for the folder's name color.
    const activeUnder = (dir: string) => list.find(one => one.isActive && one.path.startsWith(`${dir}/`))

    // The tree under v.dir, open folders listed in place, up to TREE_ROWS rows.
    const rows: JSX.Element[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      const entries = await $.fs.list(dir || undefined).catch(() => [])
      const shown = entries
        .filter(entry => !SKIP.has(entry.name) || v.showHidden)
        .filter(entry => v.showHidden || !entry.name.startsWith('.'))
        .sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name))

      for (const entry of shown) {
        if (rows.length >= TREE_ROWS) return

        const path = join(dir, entry.name)
        const indent = depth * 2

        if (entry.kind === 'dir') {
          const isOpen = v.expanded.includes(path)
          const count = SKIP.has(entry.name) ? 0 : changedUnder(path)
          const active = activeUnder(path)
          const folderColor = entry.name.startsWith('.') ? MUTED : count > 0 ? EDIT : FOLDER

          rows.push(
            <Box
              key={`row:${path}`}
              {...rounded()}
              justifyContent="space-between"
              alignItems="center"
              gap={1}
              paddingX={1}
              paddingY={0}
              hover={{ backgroundColor: HOVER }}
            >
              <Box gap={1} alignItems="center" paddingLeft={indent} flexShrink={1} minWidth={0} overflow="hidden">
                <Button key={`caret:${path}`} plain onPress={() => toggle(path)}>
                  <Text dimColor mono size="caption">
                    {isOpen ? '▾' : '▸'}
                  </Text>
                </Button>
                {icon(folderIcon(entry.name, isOpen), entry.name, '▪', folderColor, 16)}
                <Button key={`dir:${path}`} plain onPress={() => toggle(path)}>
                  <Text color={active ? accentOf(active) : count > 0 ? DIRTY : undefined} dimColor={!active && count === 0 && isIgnored(path, true)}>
                    {entry.name}
                  </Text>
                </Button>
              </Box>
              {(active || count > 0) && (
                <Box flexShrink={0} gap="xs" alignItems="center">
                  {active && dot(accentOf(active), true)}
                  {count > 0 && (
                    <Text color={DIRTY} size="footnote" tabular>
                      {count}
                    </Text>
                  )}
                </Box>
              )}
            </Box>,
          )

          if (isOpen && depth < 12) await walk(path, depth + 1)
        } else {
          const touch = byPath.get(path)
          const isDirty = changed.has(path)
          const accent = touch ? accentOf(touch) : isDirty ? DIRTY : undefined
          // The row's tint: strong while Claude has the file or just committed it, faint once it let go.
          const background = touch ? tint(accentOf(touch), touch.isActive || touch.isCommitted ? '2e' : '14') : undefined
          const right = (() => {
            if (touch?.isActive) return pill(touch.isEdited ? 'editing' : 'reading', accentOf(touch), true)
            if (touch?.isCommitted) return pill('committed', DONE)
            if (isDirty && g?.lines[path]) return counts(path)
            if (v.showSizes) return <Text dimColor tabular size="footnote">{sizeOf(entry.size)}</Text>

            return <Text dimColor tabular size="footnote">{whenOf(entry.mtimeMs)}</Text>
          })()

          rows.push(
            <Box
              key={`row:${path}`}
              {...rounded(touch?.isActive ? tint(accentOf(touch), '59') : CLEAR)}
              justifyContent="space-between"
              alignItems="center"
              gap={1}
              paddingX={1}
              paddingY={0}
              backgroundColor={background}
              overflow="hidden"
              hover={{ backgroundColor: background ?? HOVER }}
            >
              {touch?.isActive && shimmer(accentOf(touch))}
              <Box gap={1} alignItems="center" paddingLeft={indent} flexShrink={1} minWidth={0} overflow="hidden">
                {/* The caret's width, unseen, so a file's icon lines up with its folder's. */}
                <Text mono size="caption" color="#00000000">
                  ▸
                </Text>
                {chip(entry.name)}
                <Text
                  color={accent}
                  dimColor={!accent && isIgnored(path, false)}
                  weight={touch?.isActive || touch?.isCommitted || isDirty ? 'semibold' : undefined}
                  wrap="truncate-end"
                >
                  {entry.name}
                </Text>
              </Box>
              <Box flexShrink={0}>{right}</Box>
            </Box>,
          )
        }
      }
    }

    const query = v.query.trim().toLowerCase()
    const matches = query ? (await indexFiles($)).filter(path => path.toLowerCase().includes(query)).slice(0, MATCHES) : []

    if (!query) await walk(v.dir, 0)

    const badge = (one: Touch) => {
      if (one.isCommitted) return pill('Committed', DONE)
      if (one.isActive) return one.isEdited ? pill('Editing', EDIT, true) : pill('Reading', READ, true)

      return one.isEdited ? pill('Edited', EDIT) : pill('Opened', READ)
    }

    const totals = Object.values(g?.lines ?? {}).reduce<[number, number]>(([a, d], [x, y]) => [a + x, d + y], [0, 0])

    // A section's head: its name in small caps and a quiet count or place beside it.
    const head = (title: string, aside: string) => (
      <Box justifyContent="space-between" alignItems="center" paddingX={1}>
        <Text dimColor weight="bold" size="caption">
          {title}
        </Text>
        {isRich ? pill(aside, MUTED) : <Text dimColor size="caption">{aside}</Text>}
      </Box>
    )

    // While Claude is idle the card sits on the theme's soft surface; otherwise on its state's tint.
    const isIdle = card.color === MUTED

    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={isIdle ? CARD_EDGE : tint(card.color, '66')}
          backgroundColor={isRich ? (isIdle ? CARD : tint(card.color, '14')) : undefined}
          overflow="hidden"
          gap={1}
        >
          {card.motion === 'pulse' && shimmer(card.color, 400)}
          <Box gap={1} alignItems="center">
            {Svg ? (
              <Svg source={badgeSvg(card.glyph, card.color, card.motion)} alt={card.kicker} width={56} height={56} />
            ) : (
              <Text color={card.color}>{TEXT_GLYPH[card.glyph]}</Text>
            )}
            <Box flexDirection="column" flexShrink={1} minWidth={0}>
              <Text color={card.color} weight="bold" size="caption">
                {card.kicker}
              </Text>
              <Text weight="bold" size="heading" wrap="truncate-end">
                {card.title}
              </Text>
              {card.sub}
            </Box>
          </Box>

          {g !== null && (
            <Box
              {...rounded(CARD_EDGE)}
              backgroundColor={isRich ? HOVER : undefined}
              justifyContent="space-between"
              alignItems="center"
              gap={1}
              paddingX={1}
              paddingY={isRich ? 'xs' : 0}
              flexWrap="wrap"
            >
              <Box gap="xs" alignItems="center">
                {icon(BRANCH_SVG, 'branch', '⎇', READ, 16)}
                <Text weight="semibold">{g.branch}</Text>
                {g.ahead ? pill(`↑${g.ahead}`, DONE) : null}
              </Box>
              {g.changed.length === 0 ? (
                <Text dimColor size="footnote">
                  clean, nothing changed
                </Text>
              ) : (
                <Box gap="xs" alignItems="center">
                  {totals[0] > 0 && pill(`+${totals[0]}`, ADDED)}
                  {totals[1] > 0 && pill(`−${totals[1]}`, REMOVED)}
                  {pill(`${g.changed.length} changed`, DIRTY)}
                </Box>
              )}
            </Box>
          )}

          <Box columnGap={2} rowGap={0} flexWrap="wrap">
            <Box gap="xs" alignItems="center">
              {dot(READ)}
              <Text dimColor size="footnote">
                Claude read
              </Text>
            </Box>
            <Box gap="xs" alignItems="center">
              {dot(EDIT)}
              <Text dimColor size="footnote">
                Claude edited
              </Text>
            </Box>
            {g !== null && (
              <Box gap="xs" alignItems="center">
                {dot(DIRTY)}
                <Text dimColor size="footnote">
                  Not committed
                </Text>
              </Box>
            )}
          </Box>
        </Box>

        {Input && (
          <Input
            key="find"
            placeholder="Find a file"
            value={v.query}
            onInput={(value: string) => setView({ query: value })}
            onSubmit={(value: string) => setView({ query: value })}
          />
        )}

        <Box columnGap={2} rowGap={0} flexWrap="wrap" paddingX={1}>
          {tool('refresh', 'Refresh', async () => {
            fileIndex = null
            await refreshGit($)
            await update($, tick, n => n + 1)
            redraw($)
          })}
          {tool('collapse', 'Collapse all', () => setView({ expanded: [] }), v.expanded.length === 0)}
          {tool('sizes', v.showSizes ? 'Dates' : 'Sizes', () => setView({ showSizes: !v.showSizes }))}
          {tool('hidden', v.showHidden ? 'Hide dotfiles' : 'Show dotfiles', () => setView({ showHidden: !v.showHidden }))}
          {tool('up', 'Up a folder', () => setView({ dir: parentOf(v.dir), expanded: [] }))}
          {v.dir !== '' && tool('home', 'Back to project', () => setView({ dir: '', expanded: [] }))}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={CARD_EDGE} backgroundColor={isRich ? CARD : undefined} gap="xs">
          {head('CLAUDE TOUCHED', plural(list.length, 'file'))}
          {list.length === 0 && (
            <Box paddingX={1}>
              <Text dimColor>Nothing yet</Text>
            </Box>
          )}
          {list.map(one => (
            <Box
              key={`touch:${one.path}`}
              {...rounded(one.isActive ? tint(accentOf(one), '59') : CLEAR)}
              backgroundColor={one.isActive ? tint(accentOf(one), '1f') : undefined}
              justifyContent="space-between"
              alignItems="center"
              gap={1}
              paddingX={1}
              paddingY={isRich ? 'xs' : 0}
              overflow="hidden"
              hover={{ backgroundColor: one.isActive ? tint(accentOf(one), '2e') : 'userMessageBackgroundHover' }}
            >
              {one.isActive && shimmer(accentOf(one))}
              {/* One line: the name keeps its room, the folder gives way from its start. */}
              <Box gap={1} alignItems="center" flexShrink={1} minWidth={0} overflow="hidden">
                {chip(base(one.path))}
                <Box flexShrink={1}>
                  <Text weight="semibold" wrap="truncate-end">
                    {base(one.path)}
                  </Text>
                </Box>
                <Box flexShrink={8} minWidth={0}>
                  <Text dimColor size="footnote" wrap="truncate-start">
                    {where(dirOf(one.path))}
                  </Text>
                </Box>
              </Box>
              <Box gap={1} alignItems="center" flexShrink={0}>
                {one.isEdited && !one.isCommitted && counts(one.path)}
                {badge(one)}
              </Box>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={CARD_EDGE} backgroundColor={isRich ? CARD : undefined} gap={0}>
          {head(query ? 'MATCHES' : 'ALL FILES', query ? plural(matches.length, 'file') : v.dir ? base(v.dir) : project)}
          <Box flexDirection="column" marginTop="xs">
            {query && matches.length === 0 && (
              <Box paddingX={1}>
                <Text dimColor>No file matches "{v.query}".</Text>
              </Box>
            )}
            {matches.map(path => (
              <Box key={`match:${path}`} {...rounded()} gap={1} alignItems="center" paddingX={1} paddingY={0} hover={{ backgroundColor: HOVER }}>
                {chip(base(path))}
                <Text color={byPath.has(path) ? accentOf(byPath.get(path)!) : changed.has(path) ? DIRTY : undefined} wrap="truncate-start">
                  {path}
                </Text>
              </Box>
            ))}
            {rows}
            {rows.length >= TREE_ROWS && (
              <Box paddingX={1}>
                <Text dimColor>More files not shown. Search to find them.</Text>
              </Box>
            )}
          </Box>
        </Box>

        {foot && (
          <Box justifyContent="flex-end" paddingX={1}>
            {pill(foot.verb === 'committing' ? 'committing…' : `committed ${foot.hash}`, DONE, foot.verb === 'committing')}
          </Box>
        )}
      </Box>
    )
  })
}

// After Claude's `git commit`: the hash at the foot, the committed files marked green, the card's news.
async function afterCommit($: EngineInterface): Promise<void> {
  const head = await run($, ['git', 'rev-parse', '--short', 'HEAD'], 5000)
  const shown = await run($, ['git', 'show', '--name-only', '--relative', '--format=', 'HEAD'], 5000)

  if (!head || head.exitCode !== 0) {
    await update($, status, () => null)
    redraw($)

    return
  }

  const hash = head.stdout.trim()
  const files = (shown?.stdout ?? '').split('\n').filter(Boolean)
  const inCommit = new Set(files)

  await update($, status, () => ({ verb: 'committed', hash }) as const)
  await update($, touched, list => list.map(one => (inCommit.has(one.path) ? { ...one, isActive: false, isCommitted: true } : one)))
  await update($, now, () => ({ verb: 'committed', hash, files }) as const)
  fileIndex = null
  await refreshGit($)
}
