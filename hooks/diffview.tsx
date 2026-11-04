import type { BoxProps, ElementConstructor, Space, TextProps } from 'claude-code'

import { rowsOf } from './diff'
import { ADDED, CARD_EDGE, REMOVED, TOOL, tint } from './look'

type Ui = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

type Options = {
  // A surface that paints: rows are tinted there; the terminal colours their text instead.
  isRich: boolean
  // The small step between things, as the pane draws it on this surface.
  xs: Space
  // One gutter, each line numbered where it is (or, removed, where it was), for the Files pane's
  // narrow room; or two, before and after, as GitHub numbers a diff.
  sides: 1 | 2
}

const MARKS = { add: '+', del: '−', same: ' ' } as const

// A diff as GitHub shows one, a row a line: its number in the file, the change's mark, the line
// cut at the row's end. Where the surface paints, an added row is green and a removed one red, its
// gutter a shade stronger, and each hunk opens on a tinted row naming the line it starts at and the
// function around it, as git names it. The terminal colours the text instead.
export function diffView({ Box, Text }: Ui, text: string, id: string, { isRich, xs, sides }: Options) {
  const rows = rowsOf(text)

  // Each line's numbers, before and after: a removed line has none after, an added one none before.
  let old = 0
  let now = 0
  const numbers = rows.map(row => {
    if (row.kind === 'hunk') {
      old = row.old
      now = row.line

      return [null, null] as const
    }
    if (row.kind === 'add') return [null, now++] as const
    if (row.kind === 'del') return [old++, null] as const

    return [old++, now++] as const
  })

  const digits = String(Math.max(0, ...numbers.flat().map(n => n ?? 0))).length
  const number = (n: number | null) => (n === null ? '' : String(n)).padStart(digits, ' ')
  const colorOf = (kind: 'add' | 'del') => (kind === 'add' ? ADDED : REMOVED)

  // The gutter: one number, where the line is now or was; or both sides'.
  const gutter = (i: number) => {
    const row = rows[i]!
    const [before, after] = numbers[i]!

    if (sides === 2) return [number(before), number(after)]

    return [number(row.kind === 'hunk' ? null : row.line)]
  }

  return (
    <Box
      key={`diffview:${id}`}
      flexDirection="column"
      {...(isRich ? ({ borderStyle: 'round', borderColor: CARD_EDGE } as const) : {})}
      paddingY={sides === 2 ? 0 : xs}
      overflow="hidden"
    >
      {rows.map((row, i) =>
        row.kind === 'hunk' ? (
          <Box
            key={`hunk:${id}:${i}`}
            gap={1}
            paddingX={1}
            paddingY={sides === 2 && isRich ? xs : 0}
            marginTop={i === 0 || sides === 2 ? undefined : xs}
            backgroundColor={sides === 2 && isRich ? tint(TOOL, '14') : undefined}
            overflow="hidden"
          >
            {gutter(i).map((n, side) => (
              <Text key={`hunk-n:${id}:${i}:${side}`} mono dimColor size="footnote">
                {n}
              </Text>
            ))}
            <Text dimColor size="footnote" wrap="truncate-end">
              {row.context ? `Line ${row.line} · ${row.context}` : `Line ${row.line}`}
            </Text>
          </Box>
        ) : (
          <Box
            key={`line:${id}:${i}`}
            gap={1}
            paddingX={sides === 2 ? 0 : 1}
            overflow="hidden"
            backgroundColor={isRich && row.kind !== 'same' ? tint(colorOf(row.kind), '1f') : undefined}
          >
            <Box
              gap={1}
              flexShrink={0}
              paddingX={sides === 2 ? 1 : 0}
              backgroundColor={sides === 2 && isRich && row.kind !== 'same' ? tint(colorOf(row.kind), '33') : undefined}
            >
              {gutter(i).map((n, side) => (
                <Text key={`line-n:${id}:${i}:${side}`} mono dimColor size="footnote">
                  {n}
                </Text>
              ))}
            </Box>
            <Text mono size="footnote" color={row.kind === 'same' ? undefined : colorOf(row.kind)} dimColor={row.kind === 'same'}>
              {MARKS[row.kind]}
            </Text>
            <Box flexShrink={1} minWidth={0} overflow="hidden">
              <Text
                mono
                size="footnote"
                wrap="truncate-end"
                color={isRich || row.kind === 'same' ? undefined : colorOf(row.kind)}
                dimColor={row.kind === 'same' && !isRich}
              >
                {/* A line cut at its end draws on one line, where spaces would collapse: its indent
                    is held in non-breaking ones. */}
                {row.text.replace(/^ +/, lead => ' '.repeat(lead.length)) || ' '}
              </Text>
            </Box>
          </Box>
        ),
      )}
    </Box>
  )
}
