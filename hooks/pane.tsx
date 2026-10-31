import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { Menu, Touch, View } from '../types'
import { absOf, cardSince, follow, reveal, toggleDiff } from './activity'
import { forget, indexFiles, listDir, redraw, refreshGit, SKIP } from './disk'
import { fileIcon, folderIcon } from './icons'
import {
  ADDED,
  badgeSvg,
  BLANK_SVG,
  BRANCH_SVG,
  CARD,
  CARD_EDGE,
  CARETS,
  chevronSvg,
  CLEAR,
  DIRTY,
  DONE,
  dotSvg,
  EDIT,
  FOLDER,
  glyphOf,
  HOVER,
  kindOf,
  MUTED,
  READ,
  REMOVED,
  shimmerSvg,
  TEXT_GLYPH,
  tint,
  TOOL,
  WRITE,
} from './look'
import { base, dirOf, join, listPath, parentOf, plural, rank, rel, sizeOf, where } from './paths'
import { DEFAULT_VIEW } from './state'

// The values this file reads or writes. The engine's scan wants each made by `atom` in the file that
// uses it, so every file names its own; state.ts lists the tags they must all share.
const diff = atom({ plugin: 'files-pane', key: 'diff' } as const, null, { shape: 'diff-2' })
const earlier = atom({ plugin: 'files-pane', key: 'earlier' } as const, [], { shape: 'touched-2' })
const git = atom({ plugin: 'files-pane', key: 'git' } as const, null, { shape: 'git-3' })
const menu = atom({ plugin: 'files-pane', key: 'menu' } as const, null, { shape: 'menu-1' })
const now = atom({ plugin: 'files-pane', key: 'now' } as const, null, { shape: 'now-3' })
const scope = atom({ plugin: 'files-pane', key: 'scope' } as const, 'turn', { shape: 'scope-1' })
const isTouchedAll = atom({ plugin: 'files-pane', key: 'isTouchedAll' } as const, false)
const status = atom({ plugin: 'files-pane', key: 'status' } as const, null, { shape: 'status-1' })
const tick = atom({ plugin: 'files-pane', key: 'tick' } as const, 0)
const touched = atom({ plugin: 'files-pane', key: 'touched' } as const, [], { shape: 'touched-2' })
const view = atom({ plugin: 'files-pane', key: 'view' } as const, DEFAULT_VIEW, { shape: 'view-3' })

const TREE_ROWS = 300
const MATCHES = 50
// The touched list shows its newest files up to this many, and offers the rest a press away.
const TOUCHED_ROWS = 8

// The pane: the card saying what Claude is doing, git's line, search, the toolbar, the files Claude
// touched and the project's tree, each file with its actions behind a ⋯. Drawn by register.tsx's
// `ui.render` hook for the pane.
export async function renderPane($: EngineInterface, e: RenderInput<'Pane'>) {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Search needs a text field, the icons an SVG and diffs a Code view, which not every surface draws.
    const Input = 'Input' in elements ? elements.Input : null
    const Code = 'Code' in elements ? elements.Code : null
    // The terminal's table answers `in` for Svg too, but draws none: ask the surface.
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : null
    const [cur, list, prior, sc, isAll, v, g, open, acts, foot] = await Promise.all([
      read($, now),
      read($, touched),
      read($, earlier),
      read($, scope),
      read($, isTouchedAll),
      read($, view),
      read($, git),
      read($, diff),
      read($, menu),
      read($, status),
    ])
    await read($, tick)
    const cwd = await $.session.cwd()
    // The project the tree shows: the session's folder, or the one it followed Claude to.
    const home = v.root || cwd
    const project = base(home)
    const changed = new Set(g?.changed ?? [])
    // A touched file as the tree spells it, relative to the project shown; null outside it.
    const keyOf = (path: string) => {
      const abs = absOf(cwd, path)

      return abs.startsWith(`${home}/`) ? abs.slice(home.length + 1) : null
    }
    const byPath = new Map(list.flatMap(one => (keyOf(one.path) === null ? [] : [[keyOf(one.path)!, one] as const])))
    const setView = async (patch: Partial<View>) => {
      await update($, view, old => ({ ...old, ...patch }))
      redraw($)
      if (patch.root !== undefined && patch.root !== v.root) {
        forget()
        void refreshGit($)
      }
    }

    // From the newest view, not this drawing's: a folder Claude opened since stays open.
    const toggle = async (path: string) => {
      await update($, view, old => ({
        ...old,
        expanded: old.expanded.includes(path) ? old.expanded.filter(one => one !== path) : [...old.expanded, path],
      }))
      redraw($)
    }

    // A file's actions, behind the ⋯ at the end of its row: open under the row for one file at a
    // time, in the list it was pressed in. A diff belongs to the actions it was opened from.
    const isActing = (where: Menu['where'], abs: string) => acts?.path === abs && acts.where === where
    const closeActions = async () => {
      await update($, menu, () => null)
      await update($, diff, () => null)
      redraw($)
    }
    const toggleActions = async (where: Menu['where'], abs: string) => {
      await update($, menu, old => (old?.path === abs && old.where === where ? null : { path: abs, where }))
      await update($, diff, () => null)
      redraw($)
    }

    // The file in the tree, wherever the tree is: in its own project (the tree moves there, as it
    // follows Claude), at a folder that holds it, its folders opened down to it, search cleared, and
    // its row in sight.
    const showInTree = async (abs: string) => {
      const path = await follow($, cwd, abs, true)

      await update($, view, old => ({ ...old, query: '' }))
      await closeActions()
      if (path) void reveal($, path)
    }

    // A surface that paints (not the terminal, where a border is box-drawing characters three rows
    // tall): it gets rounded pills and rows, soft cards and moving badges.
    const isRich = Svg !== null
    // A bordered Box is what the desktop rounds; a clear border keeps the corner without a line.
    const rounded = (color = CLEAR) => (isRich ? ({ borderStyle: 'round', borderColor: color } as const) : {})

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

    // A toolbar action: a small rounded chip, dim at rest, tinted with a check while the setting it
    // switches is on, the check in its glyph's place. The desktop draws the Button inside with its
    // own padding, so the chip adds none and the label is caption-sized: the row stays one line in a
    // narrow pane.
    const tool = (key: string, label: string, onPress: () => unknown, state: 'on' | 'off' | 'idle' = 'off', glyph = '') => {
      const mark = state === 'on' ? '✓' : glyph
      const button = (
        <Button key={key} plain dimColor={state !== 'on'} onPress={onPress}>
          <Text size="caption">{mark ? `${mark} ${label}` : label}</Text>
        </Button>
      )

      return isRich ? (
        <Box
          key={`chip:${key}`}
          {...rounded(state === 'on' ? tint(FOLDER, '59') : CARD_EDGE)}
          backgroundColor={state === 'on' ? tint(FOLDER, '1f') : undefined}
          paddingX={0}
          paddingY={0}
          hover={{ backgroundColor: state === 'on' ? tint(FOLDER, '2e') : HOVER }}
        >
          {button}
        </Box>
      ) : (
        button
      )
    }

    // The ⋯ at the end of a file's row: a press opens the file's actions under it, or closes them.
    // The desktop pads a Button itself, so a row ending in one keeps no right padding of its own:
    // the ⋯ reaches the row's end, where a folder row's count sits.
    const more = (where: Menu['where'], abs: string) => (
      <Button key={`more:${where}:${abs}`} plain dimColor={!isActing(where, abs)} onPress={() => toggleActions(where, abs)}>
        <Text size="footnote">⋯</Text>
      </Button>
    )

    // A file's row and, while its ⋯ is pressed, its actions in a popover over the row above, at the
    // ⋯'s end: put it in the prompt, copy its path, see its diff (a file git reports as changed) and,
    // from another list, find it in the tree. Then the diff itself, under the row while it is open.
    // The popover hangs off a Box around the row, as the row clips what it holds; it floats over the
    // rows before it, which an absolute Box is painted over, and moves none of them. Its actions
    // stack one to a line, left-aligned, spaced and padded in steps each surface sizes its own way:
    // a step wider apart where the surface paints, as the terminal draws that step as a blank line.
    const withActions = (row: JSX.Element, where: Menu['where'], abs: string, canDiff: boolean, indent = 0): JSX.Element[] => {
      if (!isActing(where, abs)) return [row]

      const name = rel(cwd, abs)
      const isDiff = canDiff && Code !== null && open?.path === abs
      const id = `${where}:${abs}`
      const act = (key: string, label: string, onPress: (press: { surface: typeof e.surface }) => unknown, isOn = false) => (
        <Button key={`${key}:${id}`} plain dimColor={!isOn} onPress={onPress}>
          <Text size="footnote">{label}</Text>
        </Button>
      )

      return [
        <Box key={`acting:${id}`} flexDirection="column">
          {row}
          <Box
            key={`actions:${id}`}
            position="absolute"
            bottom={1}
            right={0}
            {...rounded(CARD_EDGE)}
            backgroundColor={CARD}
            flexDirection="column"
            alignItems="flex-start"
            rowGap={isRich ? 'md' : 'sm'}
            paddingX="sm"
            paddingY="xs"
          >
            {act('mention', '@ Mention', async () => {
              await $.prompt.fill({ text: `@${name.includes(' ') ? `"${name}"` : name} `, mode: 'insert' }).catch(() => {})
              await closeActions()
            })}
            {act('copy', 'Copy path', async press => {
              await $.ui.copy({ text: name, surface: press.surface }).catch(() => {})
              $.ui.toast(`Copied ${name}`)
              await closeActions()
            })}
            {canDiff && Code !== null && act('diff', isDiff ? 'Hide diff' : 'Diff', () => toggleDiff($, abs), isDiff)}
            {where !== 'tree' && act('show', 'Show in tree', () => showInTree(abs))}
          </Box>
        </Box>,
        ...(isDiff && open && Code
          ? [
              <Box key={`diff:${id}`} flexDirection="column" gap="xs" paddingLeft={indent + 1} paddingRight={1}>
                {open.text ? (
                  <Code source={open.text} format="diff" path={abs} wrap="truncate-end" />
                ) : (
                  <Text dimColor size="footnote">
                    No changes since the last commit.
                  </Text>
                )}
                {open.more > 0 && (
                  <Text dimColor size="footnote">
                    {plural(open.more, 'more line')} not shown
                  </Text>
                )}
              </Box>,
            ]
          : []),
      ]
    }

    // A folder's chevron, which a file row draws blank so a file's icon lines up with a folder's.
    // Where the surface paints it is a thin SVG stroke, and a press on the row opens it; only a
    // Button takes a press and a Button holds only text, so the terminal's is a glyph.
    const chevron = (isOpen = false, onPress?: () => unknown, key?: string) =>
      Svg ? (
        <Svg source={onPress ? chevronSvg(isOpen) : BLANK_SVG} alt={onPress ? (isOpen ? 'open' : 'closed') : 'file'} width={12} height={12} />
      ) : (
        <Box width={2} flexShrink={0} justifyContent="center" alignItems="center">
          {onPress && (
            <Button key={key} plain dimColor onPress={onPress}>
              <Text mono size="caption">
                {CARETS[isOpen ? 1 : 0]}
              </Text>
            </Button>
          )}
        </Box>
      )

    // A press anywhere on a folder's row, where the surface paints: a Button holds only text, so a
    // row with icons cannot be one. Laid over the row instead, a Button of blank text far wider than
    // any row, so the Button covers the row end to end. (Non-breaking spaces, which a surface does
    // not collapse.) The desktop draws a Button's text on one line, cut to its room with an ellipsis
    // in the Button's own color, which no Text prop hides; so the layer reaches a pane's width past
    // the row's end, and the ellipsis falls there, where the row clips it. No `label`: the desktop
    // draws a label as text, over the chevron and the icon; the key is its address.
    const pressAnywhere = (key: string, onPress: () => unknown) =>
      isRich ? (
        <Box position="absolute" top={0} left={0} right={-e.props.bodyColumns} bottom={0} flexDirection="column" overflow="hidden">
          <Button key={key} plain onPress={onPress}>
            <Text color={CLEAR}>{'\u00a0'.repeat(Math.max(600, e.props.bodyColumns * 12))}</Text>
          </Button>
        </Box>
      ) : null

    const dot = (color: string, isLive = false, size = 12) =>
      Svg ? <Svg source={dotSvg(color, isLive)} alt={isLive ? 'live' : 'mark'} width={size} height={size} /> : <Text color={color}>●</Text>

    // The shimmer over a row, laid on top of it and clipped by it: the row is `overflow="hidden"`.
    // Wider and taller than any row, so it always covers; the row cuts it to size.
    const sweepWidth = Math.min(4096, Math.max(240, e.props.bodyColumns * 10))
    const shimmer = (color: string, height = 48) =>
      Svg ? (
        <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden">
          <Svg source={shimmerSvg(color, sweepWidth, height)} alt="working" width={sweepWidth} height={height} />
        </Box>
      ) : null

    // A rounded chip of a color's tint, a live one with a pulsing dot. It never shrinks, which would
    // wrap its label ("0 / files") in a narrow header.
    const pill = (label: string, color: string, isLive = false) =>
      isRich ? (
        <Box
          {...rounded(tint(color, '4d'))}
          backgroundColor={tint(color, '1f')}
          paddingX={1}
          paddingY={0}
          gap="xs"
          alignItems="center"
          flexShrink={0}
        >
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
          sub: 'nothing touched yet',
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
          sub: cur.thought ? (
            <Text dimColor italic size="footnote" wrap="truncate-start">
              {cur.thought}
            </Text>
          ) : opened > 0 ? (
            `opened ${plural(opened, 'file')}`
          ) : (
            `in ${project}`
          ),
        }
      }

      if (cur.verb === 'writing') {
        return {
          kicker: 'RIGHT NOW',
          color: WRITE,
          glyph: 'quill' as const,
          motion: 'pulse' as const,
          title: 'Claude is writing',
          sub: (
            <Text dimColor size="footnote" wrap="truncate-start">
              {cur.text}
            </Text>
          ),
        }
      }

      if (cur.verb === 'working') {
        return {
          kicker: 'RIGHT NOW',
          color: TOOL,
          glyph: glyphOf(cur.tool),
          motion: 'pulse' as const,
          title: cur.title,
          sub: cur.detail ? (
            <Text dimColor mono size="footnote" wrap="truncate-end">
              {cur.detail}
            </Text>
          ) : (
            cur.tool
          ),
        }
      }

      if (cur.verb === 'committed') {
        return {
          kicker: 'DONE',
          color: DONE,
          glyph: 'check' as const,
          motion: 'draw' as const,
          title: `Claude committed ${plural(cur.files.length, 'file')}`,
          sub: cur.hash,
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
            sub: 'nothing changed',
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
              <Text dimColor size="footnote" wrap="truncate-end">
                {one} <Text color={ADDED}>+{pair[0]}</Text> <Text color={REMOVED}>−{pair[1]}</Text>
              </Text>
            ) : (
              <Text dimColor size="footnote" wrap="truncate-end">
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
        sub: `in ${where(dirOf(cur.path)) || project}`,
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
    const activeUnder = (dir: string) => list.find(one => one.isActive && (keyOf(one.path) ?? '').startsWith(`${dir}/`))

    // The tree under v.dir, open folders listed in place, up to TREE_ROWS rows.
    const rows: JSX.Element[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      const entries = await listDir($, listPath(home, dir))
      const sorted = entries
        .filter(entry => !SKIP.has(entry.name) || v.showHidden)
        .filter(entry => v.showHidden || !entry.name.startsWith('.'))
        .sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name))
      // A file keeps the chevron's width only to line up with a folder beside it.
      const hasDirs = sorted.some(entry => entry.kind === 'dir')
      for (const entry of sorted) {
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
              overflow="hidden"
              hover={{ backgroundColor: HOVER }}
            >
              <Box gap={1} alignItems="center" paddingLeft={indent} flexShrink={1} minWidth={0} overflow="hidden">
                {/* The chevron sits close to the folder's icon; a press on it or the name opens it. */}
                <Box gap="xs" alignItems="center">
                  {chevron(isOpen, () => toggle(path), `caret:${path}`)}
                  {icon(folderIcon(entry.name, isOpen), entry.name, '▪', folderColor, 16)}
                </Box>
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
              {pressAnywhere(`fold:${path}`, () => toggle(path))}
            </Box>,
          )

          if (isOpen && depth < 12) await walk(path, depth + 1)
        } else {
          const touch = byPath.get(path)
          const isDirty = changed.has(path)
          const accent = touch ? accentOf(touch) : isDirty ? DIRTY : undefined
          // The row's tint: strong while Claude has the file or just committed it, faint once it let go.
          const background = touch ? tint(accentOf(touch), touch.isActive || touch.isCommitted ? '2e' : '14') : undefined
          // No pill for what Claude is doing with the file: the row's tint and shimmer say it.
          const right = (() => {
            if (isDirty && g?.lines[path]) return counts(path)
            if (v.showSizes) return <Text dimColor tabular size="footnote">{sizeOf(entry.size)}</Text>

            return null
          })()

          const row = (
            <Box
              key={`row:${path}`}
              {...rounded(touch?.isActive ? tint(accentOf(touch), '59') : CLEAR)}
              justifyContent="space-between"
              alignItems="center"
              gap={1}
              paddingLeft={1}
              paddingRight={0}
              paddingY={0}
              backgroundColor={background}
              overflow="hidden"
              hover={{ backgroundColor: background ?? HOVER }}
            >
              {touch?.isActive && shimmer(accentOf(touch))}
              <Box gap={1} alignItems="center" paddingLeft={indent} flexShrink={1} minWidth={0} overflow="hidden">
                {/* The chevron's width, unseen, so a file's icon lines up with a sibling folder's. */}
                <Box gap="xs" alignItems="center">
                  {hasDirs && chevron()}
                  {chip(entry.name)}
                </Box>
                <Text
                  color={accent}
                  dimColor={!accent && isIgnored(path, false)}
                  weight={touch?.isActive || touch?.isCommitted || isDirty ? 'semibold' : undefined}
                  wrap="truncate-end"
                >
                  {entry.name}
                </Text>
              </Box>
              <Box flexShrink={0} gap={1} alignItems="center">
                {right}
                {more('tree', join(home, path))}
              </Box>
            </Box>
          )

          rows.push(...withActions(row, 'tree', join(home, path), isDirty, indent))
        }
      }
    }

    // The way up, the tree's first row: the folder above the one shown, past the project's top too.
    const upRow = (
      <Box key="row:.." {...rounded()} alignItems="center" gap={1} paddingX={1} paddingY={0} overflow="hidden" hover={{ backgroundColor: HOVER }}>
        <Box gap="xs" alignItems="center">
          {chevron()}
          {icon(folderIcon('..', false), 'up', '▪', MUTED, 16)}
        </Box>
        <Button key="up" plain dimColor onPress={() => setView({ dir: parentOf(v.dir), expanded: [] })}>
          ..
        </Button>
        {pressAnywhere('up:row', () => setView({ dir: parentOf(v.dir), expanded: [] }))}
      </Box>
    )

    const query = v.query.trim().toLowerCase()
    const matches = query ? rank(await indexFiles($, home), query, MATCHES) : []

    if (!query) await walk(v.dir, 0)

    const totals = Object.values(g?.lines ?? {}).reduce<[number, number]>(([a, d], [x, y]) => [a + x, d + y], [0, 0])

    // A section's head: its name in small caps and, beside it, a quiet count or place, or controls.
    // In a narrow pane the name gives way, never the aside.
    const head = (title: string, aside: string | JSX.Element) => (
      <Box justifyContent="space-between" alignItems="center" gap={1} paddingX={1}>
        <Box flexShrink={1} minWidth={0}>
          <Text dimColor weight="bold" size="caption" wrap="truncate-end">
            {title}
          </Text>
        </Box>
        <Box flexShrink={0}>
          {typeof aside !== 'string' ? aside : isRich ? pill(aside, MUTED) : <Text dimColor size="caption">{aside}</Text>}
        </Box>
      </Box>
    )

    // The touched list: this turn's files, or with the whole session's, the earlier turns' first.
    const isSession = sc === 'session'
    const shownTouched = isSession ? [...prior.filter(one => !list.some(now => now.path === one.path)), ...list] : list
    // A long list shows its newest files and folds the older ones into a row that opens them; a
    // file Claude has in hand, or whose actions are open, shows wherever it sits.
    const isFolded = shownTouched.length > TOUCHED_ROWS && !isAll
    const newest = shownTouched.slice(-TOUCHED_ROWS)
    const keptTouched = isFolded ? shownTouched.filter(one => newest.includes(one) || one.isActive || acts?.path === absOf(cwd, one.path)) : shownTouched
    const foldedCount = shownTouched.length - keptTouched.length

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
              <Svg source={badgeSvg(card.glyph, card.color, card.motion, cardSince())} alt={card.kicker} width={56} height={56} />
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
              {typeof card.sub === 'string' ? (
                <Text dimColor size="footnote" wrap="truncate-end">
                  {card.sub}
                </Text>
              ) : (
                card.sub
              )}
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

        <Box gap="xs" flexWrap="wrap" paddingX={1} alignItems="center">
          {tool('refresh', '↻ Refresh', async () => {
            forget()
            await refreshGit($)
            await update($, tick, n => n + 1)
            redraw($)
          })}
          {tool('collapse', '⊟ Collapse', () => setView({ expanded: [] }), v.expanded.length === 0 ? 'idle' : 'off')}
          {tool('sizes', 'Sizes', () => setView({ showSizes: !v.showSizes }), v.showSizes ? 'on' : 'off', '⇲')}
          {tool('hidden', 'Dotfiles', () => setView({ showHidden: !v.showHidden }), v.showHidden ? 'on' : 'off', '◌')}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={CARD_EDGE} backgroundColor={isRich ? CARD : undefined} gap="xs">
          {head(
            'CLAUDE TOUCHED',
            <Box gap="xs" alignItems="center">
              {tool(
                'scope',
                'Whole session',
                async () => {
                  await update($, scope, old => (old === 'session' ? 'turn' : 'session'))
                  redraw($)
                },
                isSession ? 'on' : 'off',
              )}
              {isRich ? pill(plural(shownTouched.length, 'file'), MUTED) : <Text dimColor size="caption">{plural(shownTouched.length, 'file')}</Text>}
            </Box>,
          )}
          {shownTouched.length === 0 && (
            <Box paddingX={1}>
              <Text dimColor>Nothing yet</Text>
            </Box>
          )}
          {/* The older files, folded above the newest; opened, the same row folds them again. */}
          {(isFolded ? foldedCount > 0 : shownTouched.length > TOUCHED_ROWS) && (
            <Box key="touched-fold" paddingX={1}>
              <Button
                key="touched-all"
                plain
                dimColor
                onPress={async () => {
                  await update($, isTouchedAll, old => !old)
                  redraw($)
                }}
              >
                <Text size="footnote">{isFolded ? `${CARETS[0]} ${plural(foldedCount, 'earlier file')}` : `${CARETS[1]} Show fewer`}</Text>
              </Button>
            </Box>
          )}
          {keptTouched.flatMap(one => {
            const abs = absOf(cwd, one.path)
            // A diff for a file with changes not yet committed.
            const canDiff = (one.isEdited && !one.isCommitted) || changed.has(keyOf(one.path) ?? '')
            // As in the tree: the tint and shimmer say what Claude did with the file, the name takes its color.
            const background = tint(accentOf(one), one.isActive || one.isCommitted ? '2e' : '14')

            return withActions(
              <Box
                key={`touch:${one.path}`}
                {...rounded(one.isActive ? tint(accentOf(one), '59') : CLEAR)}
                backgroundColor={background}
                justifyContent="space-between"
                alignItems="center"
                gap={1}
                paddingLeft={1}
                paddingRight={0}
                paddingY={0}
                overflow="hidden"
                hover={{ backgroundColor: background }}
              >
                {one.isActive && shimmer(accentOf(one))}
                {/* One line: the name keeps its room, the folder gives way from its start. */}
                <Box gap={1} alignItems="center" flexShrink={1} minWidth={0} overflow="hidden">
                  {chip(base(one.path))}
                  <Box flexShrink={1}>
                    <Text color={accentOf(one)} weight="semibold" wrap="truncate-end">
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
                  {more('touched', abs)}
                </Box>
              </Box>,
              'touched',
              abs,
              canDiff,
            )
          })}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={CARD_EDGE} backgroundColor={isRich ? CARD : undefined} gap={0}>
          {head(
            query ? 'MATCHES' : 'ALL FILES',
            query ? (
              plural(matches.length, 'file')
            ) : v.dir !== '' || v.root !== '' ? (
              <Box gap="xs" alignItems="center">
                {tool('home', '⌂ Project', () => setView({ root: '', dir: '', expanded: [] }))}
                {isRich ? pill(v.dir ? base(v.dir) : project, MUTED) : <Text dimColor size="caption">{v.dir ? base(v.dir) : project}</Text>}
              </Box>
            ) : (
              project
            ),
          )}
          <Box flexDirection="column" marginTop="xs">
            {query && matches.length === 0 && (
              <Box paddingX={1}>
                <Text dimColor>No file matches "{v.query}".</Text>
              </Box>
            )}
            {matches.flatMap(path =>
              withActions(
                <Box
                  key={`match:${path}`}
                  {...rounded()}
                  justifyContent="space-between"
                  gap={1}
                  alignItems="center"
                  paddingLeft={1}
                  paddingRight={0}
                  paddingY={0}
                  overflow="hidden"
                  hover={{ backgroundColor: HOVER }}
                >
                  <Box gap={1} alignItems="center" flexShrink={1} minWidth={0} overflow="hidden">
                    {chip(base(path))}
                    <Text color={byPath.has(path) ? accentOf(byPath.get(path)!) : changed.has(path) ? DIRTY : undefined} wrap="truncate-start">
                      {path}
                    </Text>
                  </Box>
                  <Box flexShrink={0}>{more('match', join(home, path))}</Box>
                </Box>,
                'match',
                join(home, path),
                changed.has(path),
              ),
            )}
            {!query && upRow}
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
}
