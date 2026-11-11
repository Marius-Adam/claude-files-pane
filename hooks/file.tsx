import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput, Space } from 'claude-code'

import type { Commit, Opened, Picture } from '../types'
import { commitDiffOf, historyOf, keptDiffOf, pictureOf, redraw, sessionDir, textOf } from './disk'
import { diffView } from './diffview'
import { avatarSvg, CARD_EDGE, CLEAR, COMMIT_SVG, FOLDER, HOVER, RULE_SVG, tint } from './look'
import { isPicture, isSvg, piecesOf, wrapped } from './media'
import { agoOf, base, dayOf, dirOf, longDayOf, plural, rel, sizeOf, where } from './paths'
import { FILE_PANE } from './state'

// The values this file reads or writes. The engine's scan wants each made by `atom` in the file that
// uses it, so every file names its own; state.ts lists the tags they must all share.
const opened = atom({ plugin: 'files-pane', key: 'opened' } as const, null, { shape: 'opened-1' })

// The file pane: a file opened from the Files pane, in a pane of its own beside it, with three tabs
// at its top: the file itself (Markdown and pictures also as a preview, a Markdown file's pictures
// drawn in it), what changed in it since the last
// commit, and the commits that changed it, each opening what it changed. Drawn by register.tsx's
// `ui.render` hook for FILE_PANE.

const TABS: { tab: Opened['tab']; label: string }[] = [
  { tab: 'file', label: 'File' },
  { tab: 'diff', label: 'Diff' },
  { tab: 'history', label: 'History' },
]

const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path)

// How many rows tall the terminal draws a picture at most.
const IMAGE_ROWS = 24

// Opens `abs` in the file pane, or brings the pane up on it. Another file takes its place, on the
// same tab; a Markdown file or a picture opens as its preview.
// A pane opens as a tab behind the one shown, so it asks for the keys, which raises it. Opening a
// pane already open only retitles it, so one behind the Files pane, a tab away, would take the
// file unseen: it is closed and opened again, in front, its state kept in `opened`.
export async function openFile($: EngineInterface, abs: string) {
  await update($, opened, old =>
    old?.path === abs ? old : { path: abs, tab: old?.tab ?? 'file', isPreview: isMarkdown(abs) || isPicture(abs), commit: null },
  )

  const panes = await $.ui.panes().catch(() => [])
  if (panes.some(pane => pane.id === FILE_PANE && !pane.isShown)) await $.ui.close({ id: FILE_PANE }).catch(() => {})
  await $.ui.open({ id: FILE_PANE, title: base(abs), focus: true }).catch(() => {})
  redraw($)
}

export async function renderFile($: EngineInterface, e: RenderInput<'Pane'>) {
  const elements = $.ui.resolve(e)
  const { Box, Text, Button, Code, Markdown } = elements
  const isRich = e.surface !== 'terminal'
  // The terminal's table answers `in` for Svg too, but draws none: ask the surface.
  const Svg = isRich && 'Svg' in elements ? elements.Svg : null
  // Every table answers `in` for Image, and only the terminal's draws one.
  const Image = e.surface === 'terminal' && 'Image' in elements ? elements.Image : null
  // Where a press can lie over a whole row, and the small step: as the Files pane has them (pane.tsx).
  const canLayer = isRich && e.surface !== 'vscode'
  const xs: Space = e.surface === 'vscode' ? 0.5 : 'xs'
  const open = await read($, opened)

  if (!open) {
    return <Text dimColor>Press a file in the Files pane to open it here.</Text>
  }

  const cwd = await sessionDir($).catch(() => '')
  const { path, tab } = open
  const set = async (patch: Partial<Opened>) => {
    await update($, opened, old => (old ? { ...old, ...patch } : old))
    redraw($)
  }

  // A tab, as the Files pane's toolbar draws its chips: tinted while it is the one shown.
  const chip = (key: string, label: string, isOn: boolean, onPress: () => unknown) => {
    const button = (
      <Button key={key} plain dimColor={!isOn} onPress={onPress}>
        <Text size="caption" weight={isOn ? 'semibold' : undefined}>
          {label}
        </Text>
      </Button>
    )

    return isRich ? (
      <Box
        key={`chip:${key}`}
        borderStyle="round"
        borderColor={isOn ? tint(FOLDER, '59') : CARD_EDGE}
        backgroundColor={isOn ? tint(FOLDER, '1f') : undefined}
        paddingX={0}
        paddingY={0}
        flexShrink={0}
      >
        {button}
      </Box>
    ) : isOn ? (
      <Text key={`chip:${key}`} weight="semibold">{`[${label}]`}</Text>
    ) : (
      button
    )
  }

  const note = (text: string) => (
    <Text dimColor size="footnote">
      {text}
    </Text>
  )

  // A press anywhere on a row, laid over it: a blank Button far wider than the row, which clips it,
  // as the Files pane's `pressAnywhere` (pane.tsx) is. The desktop draws a Button's text on one
  // line, whatever line breaks it holds, so a row of more lines gets a Button a line, stacked, the
  // first keyed as the row is: one Button of three lines took a press on the row's top line alone.
  const layer = (key: string, onPress: () => unknown, lines = 1) => (
    <Box position="absolute" top={0} left={0} right={-e.props.bodyColumns} bottom={0} flexDirection="column" overflow="hidden">
      {Array.from({ length: lines }, (_, i) => (
        <Button key={i === 0 ? key : `${key}:${i + 1}`} plain onPress={onPress}>
          <Text color={CLEAR}>{'\u00a0'.repeat(Math.max(600, e.props.bodyColumns * 12))}</Text>
        </Button>
      ))}
    </Box>
  )

  // A diff as GitHub draws one: each line numbered before and after, added rows green, removed red.
  const diff = (text: string, id: string) => diffView(elements, text, id, { isRich, xs, sides: 2 })

  // What a diff left out past the pane's room.
  const more = (n: number, what: string) => (n > 0 ? note(`${plural(n, what)} not shown`) : null)

  const body = await (async () => {
    if (tab === 'file') {
      // A raster picture has no text to show; an SVG shows its markup a press away, and on the
      // terminal, which draws no SVG, only that.
      if (isPicture(path) && (isSvg(path) ? open.isPreview && Svg : true)) return picture(path, await pictureOf($, path), 'picture')

      const found = await textOf($, path)

      if ('reason' in found) {
        return note(
          found.reason === 'binary' ? 'A binary file: nothing to show as text.' : found.reason === 'large' ? 'Too large to show here.' : 'This file can’t be read.',
        )
      }
      if (open.isPreview && isMarkdown(path)) return markdown(found.text)

      return (
        <Box flexDirection="column" gap={1}>
          {found.text ? <Code key={`code:${path}`} source={found.text} path={path} startLine={1} /> : note('This file is empty.')}
          {more(found.more, 'more line')}
        </Box>
      )
    }

    if (tab === 'diff') {
      const found = await keptDiffOf($, path)

      return found.text ? (
        <Box flexDirection="column" gap={1}>
          {diff(found.text, `diff:${path}`)}
          {more(found.more, 'more line')}
        </Box>
      ) : (
        note('No changes since the last commit.')
      )
    }

    const commits = await historyOf($, path)

    if (commits === null) return note('No history: the file is outside the session’s repository.')
    if (commits.length === 0) return note('No commits yet.')

    // The commit opened, with what it changed in the file under it.
    const shown = commits.find(one => one.hash === open.commit)
    const change = shown ? await commitDiffOf($, path, shown) : null
    // The commits by the day they were made, newest first, as git lists them.
    const days: { day: string; commits: Commit[] }[] = []

    for (const commit of commits) {
      const day = dayOf(commit.at)

      if (days.at(-1)?.day === day) days.at(-1)!.commits.push(commit)
      else days.push({ day, commits: [commit] })
    }

    const now = Date.now()

    return (
      <Box flexDirection="column" gap={1}>
        {days.map(({ day, commits: made }) => (
          <Box key={`day:${day}`} flexDirection="column" gap={xs}>
            <Box gap={xs} alignItems="center">
              {Svg ? <Svg source={COMMIT_SVG} alt="commits" width={14} height={14} /> : <Text dimColor>●</Text>}
              <Text dimColor size="footnote">
                {`Commits on ${longDayOf(made[0]!.at)}`}
              </Text>
            </Box>
            <Box flexDirection="column" {...(isRich ? ({ borderStyle: 'round', borderColor: CARD_EDGE } as const) : {})} overflow="hidden">
              {made.flatMap((commit, i) => [
                ...(i > 0 && Svg ? [<Svg key={`rule:${commit.hash}`} source={RULE_SVG} alt="divider" height={1} />] : []),
                commitRow(commit, commit.hash === open.commit, now),
                ...(commit === shown && change ? [changeOf(commit, change)] : []),
              ])}
            </Box>
          </Box>
        ))}
      </Box>
    )
  })()

  // A picture, as each surface draws one: an SVG as its markup where SVG draws; a PNG on the
  // terminal as its pixels; another raster picture as an SVG holding it, where it fits in one;
  // and under it, its type, size and weight. Where none of that draws, what it is, in words.
  function picture(abs: string, found: Picture, key: string, alt = base(abs)) {
    if ('reason' in found) return note(found.reason === 'large' ? 'Too large to preview here.' : 'This picture can’t be read.')

    if (found.kind === 'svg') return Svg ? <Svg key={`${key}:${abs}`} source={found.markup} alt={alt} /> : note(`${alt}: an SVG, which the terminal draws no preview of.`)

    const { type, width, height, bytes } = found
    const about = `${type.toUpperCase()} · ${width && height ? `${width} × ${height} · ` : ''}${sizeOf(bytes)}`

    if (Image && type === 'png' && width && height) {
      // A cell is about twice as tall as it is wide and some 8 pixels across: the picture keeps its
      // shape within the pane's width and IMAGE_ROWS rows, and a small one is not blown up.
      let columns = Math.max(1, Math.min(255, e.props.bodyColumns - 2, Math.ceil(width / 8)))
      let rows = Math.round((columns * height) / width / 2)

      if (rows > IMAGE_ROWS) {
        rows = IMAGE_ROWS
        columns = Math.max(1, Math.min(columns, Math.round((rows * 2 * width) / height)))
      }

      return (
        <Box key={`${key}:${abs}`} flexDirection="column" gap={xs}>
          <Image source={{ file: abs, format: 'png', generation: Math.floor(found.mtimeMs) }} columns={columns} rows={Math.max(1, rows)} alt={alt} />
          {note(about)}
        </Box>
      )
    }

    const markup = Svg ? wrapped(found) : null

    if (!Svg || !markup) {
      return note(`${about}. ${Svg ? 'Too large to preview here.' : Image ? 'The terminal previews PNG pictures only.' : 'No preview here.'}`)
    }

    return (
      <Box key={`${key}:${abs}`} flexDirection="column" gap={xs}>
        <Svg source={markup} alt={alt} />
        {note(about)}
      </Box>
    )
  }

  // A Markdown file's preview: its text, and each picture on a line of its own drawn in its place.
  async function markdown(text: string) {
    const pieces = piecesOf(text, dirOf(path), cwd || dirOf(path))

    if (pieces.every(one => 'text' in one)) return <Markdown key={`md:${path}`} text={text} />

    const drawn = await Promise.all(
      pieces.map(async (one, i) =>
        'text' in one ? (
          <Markdown key={`md:${path}:${i}`} text={one.text} />
        ) : (
          <Box key={`md-picture:${i}`} flexDirection="column">
            {picture(one.path, await pictureOf($, one.path), `md-picture:${i}`, one.alt || base(one.path))}
          </Box>
        ),
      ),
    )

    return (
      <Box key={`md:${path}`} flexDirection="column" gap={1}>
        {drawn}
      </Box>
    )
  }

  // A commit in the history, as GitHub lists one: its first line and its hash, then who made it
  // and how long ago. A press anywhere on it opens what it changed in the file, or closes it.
  function commitRow(commit: Commit, isOpen: boolean, now: number) {
    const onPress = () => set({ commit: isOpen ? null : commit.hash })
    const subject = (
      <Text wrap="truncate-end" weight="semibold" color={isOpen && isRich ? FOLDER : undefined}>
        {commit.subject || '(no message)'}
      </Text>
    )

    return (
      <Box
        key={`commit:${commit.hash}`}
        flexDirection="column"
        paddingX={1}
        paddingY={xs}
        backgroundColor={isOpen && isRich ? tint(FOLDER, '14') : undefined}
        overflow="hidden"
        {...(canLayer ? { hover: { backgroundColor: isOpen ? tint(FOLDER, '26') : HOVER } } : {})}
      >
        <Box justifyContent="space-between" alignItems="center" gap={1}>
          <Box flexShrink={1} minWidth={0} overflow="hidden">
            {canLayer ? (
              subject
            ) : (
              <Button key={`commit:${commit.hash}`} plain onPress={onPress}>
                {subject}
              </Button>
            )}
          </Box>
          <Box flexShrink={0} paddingX={xs} {...(isRich ? ({ borderStyle: 'round', borderColor: CARD_EDGE } as const) : {})}>
            <Text mono dimColor size="footnote">
              {commit.hash}
            </Text>
          </Box>
        </Box>
        <Box gap={xs} alignItems="center" overflow="hidden">
          {Svg && <Svg source={avatarSvg(commit.author)} alt={commit.author || 'author'} width={14} height={14} />}
          <Text dimColor size="footnote" wrap="truncate-end">
            {`${commit.author || 'Someone'} committed ${agoOf(commit.at, now)}`}
          </Text>
        </Box>
        {/* Its two lines and their padding: three blank lines cover them, and the row clips the rest. */}
        {canLayer && layer(`commit:${commit.hash}`, onPress, 3)}
      </Box>
    )
  }

  function changeOf(commit: Commit, change: { text: string; more: number }) {
    return (
      <Box key={`change:${commit.hash}`} flexDirection="column" gap={xs} paddingX={1} paddingBottom={xs}>
        {change.text ? diff(change.text, `change:${commit.hash}`) : note('Nothing to show for this file in that commit.')}
        {more(change.more, 'more line')}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text weight="bold" wrap="truncate-end">
          {base(path)}
        </Text>
        <Text dimColor size="footnote" wrap="truncate-start">
          {where(rel(cwd, dirOf(path))) || '.'}
        </Text>
      </Box>
      <Box gap={1} flexWrap="wrap" alignItems="center">
        {TABS.map(one => chip(`tab:${one.tab}`, one.label, tab === one.tab, () => set({ tab: one.tab })))}
        {tab === 'file' && (isMarkdown(path) || (isSvg(path) && Svg)) && (
          <Box marginLeft={1}>{chip('preview', open.isPreview ? 'Source' : 'Preview', false, () => set({ isPreview: !open.isPreview }))}</Box>
        )}
      </Box>
      {body}
    </Box>
  )
}
