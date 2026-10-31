import { expect, test } from 'claude-code/testing'

import { rowsOf } from '../hooks/diff'

const lines = (...all: string[]) => all.join('\n')

test('a diff of several hunks numbers each from its own header', () => {
  const text = lines(
    '@@ -3,3 +3,4 @@ import',
    ' a',
    '+b',
    ' c',
    ' d',
    '@@ -40,3 +41,2 @@ function run() {',
    ' x',
    '-y',
    ' z',
  )

  expect(rowsOf(text)).toEqual([
    { kind: 'hunk', line: 3, context: 'import' },
    { kind: 'same', line: 3, text: 'a' },
    { kind: 'add', line: 4, text: 'b' },
    { kind: 'same', line: 5, text: 'c' },
    { kind: 'same', line: 6, text: 'd' },
    { kind: 'hunk', line: 41, context: 'function run() {' },
    { kind: 'same', line: 41, text: 'x' },
    { kind: 'del', line: 41, text: 'y' },
    { kind: 'same', line: 42, text: 'z' },
  ])
})

test('a removed line keeps its old number, an added or kept one its new, across a run of changes', () => {
  const text = lines('@@ -10,6 +10,6 @@', ' k1', '-o1', '-o2', '+n1', '+n2', '+n3', ' k2', '-o3', ' k3')

  expect(rowsOf(text)).toEqual([
    { kind: 'hunk', line: 10, context: '' },
    { kind: 'same', line: 10, text: 'k1' },
    { kind: 'del', line: 11, text: 'o1' },
    { kind: 'del', line: 12, text: 'o2' },
    { kind: 'add', line: 11, text: 'n1' },
    { kind: 'add', line: 12, text: 'n2' },
    { kind: 'add', line: 13, text: 'n3' },
    // Old 13, new 14: the kept line's number is where it is now.
    { kind: 'same', line: 14, text: 'k2' },
    { kind: 'del', line: 14, text: 'o3' },
    { kind: 'same', line: 15, text: 'k3' },
  ])
})

test('a header without counts, and a new file from line 0, still number from the right line', () => {
  expect(rowsOf(lines('@@ -1 +1 @@', '-a', '+b'))).toEqual([
    { kind: 'hunk', line: 1, context: '' },
    { kind: 'del', line: 1, text: 'a' },
    { kind: 'add', line: 1, text: 'b' },
  ])
  expect(rowsOf(lines('@@ -0,0 +1,2 @@', '+one', '+two'))).toEqual([
    { kind: 'hunk', line: 1, context: '' },
    { kind: 'add', line: 1, text: 'one' },
    { kind: 'add', line: 2, text: 'two' },
  ])
})

test('the indent every line shares is taken off, over every hunk', () => {
  const text = lines('@@ -1,2 +1,2 @@', '     if (a) {', '-      b()', '+      c()', '@@ -9 +9 @@', '-    }', '+    })')

  expect(rowsOf(text).map(row => (row.kind === 'hunk' ? '@@' : row.text))).toEqual(['@@', 'if (a) {', '  b()', '  c()', '@@', '}', '})'])
})

test('one line with no indent keeps every line as it is', () => {
  const text = lines('@@ -1,2 +1,2 @@', '     a', '-top', '+    b')

  expect(rowsOf(text).map(row => (row.kind === 'hunk' ? '@@' : row.text))).toEqual(['@@', '    a', 'top', '    b'])
})

test('a blank line, or one of spaces only, neither counts for the shared indent nor breaks', () => {
  // git prints an empty kept line as a lone space; a line of spaces shorter than the indent.
  const text = lines('@@ -1,4 +1,4 @@', '     a', ' ', '   ', '-    b', '+    c')

  expect(rowsOf(text)).toEqual([
    { kind: 'hunk', line: 1, context: '' },
    { kind: 'same', line: 1, text: 'a' },
    { kind: 'same', line: 2, text: '' },
    { kind: 'same', line: 3, text: '' },
    { kind: 'del', line: 4, text: 'b' },
    { kind: 'add', line: 4, text: 'c' },
  ])
})

test('a tab reads as two spaces, and counts as such for the shared indent', () => {
  const text = lines('@@ -1,2 +1,2 @@', ' \t\tif (a)', '-\t\t\tb()\t// x', '+    \tc()')

  expect(rowsOf(text).map(row => (row.kind === 'hunk' ? '@@' : row.text))).toEqual(['@@', 'if (a)', '  b()  // x', '  c()'])
})

test('`\\ No newline at end of file` is no row, and moves no number', () => {
  const text = lines('@@ -1,2 +1,3 @@', ' a', '-b', '\\ No newline at end of file', '+b', '+c', '\\ No newline at end of file')

  expect(rowsOf(text)).toEqual([
    { kind: 'hunk', line: 1, context: '' },
    { kind: 'same', line: 1, text: 'a' },
    { kind: 'del', line: 2, text: 'b' },
    { kind: 'add', line: 2, text: 'b' },
    { kind: 'add', line: 3, text: 'c' },
  ])
})

// git ends its output with a newline. diffOf trims it before the pane gets the text, but rowsOf
// takes "a unified diff", and `git diff` as it prints one should not grow a phantom kept line.
test('the newline git ends its output with makes no row', () => {
  const text = '@@ -1,2 +1,2 @@\n a\n-b\n+c\n'

  expect(rowsOf(text)).toEqual([
    { kind: 'hunk', line: 1, context: '' },
    { kind: 'same', line: 1, text: 'a' },
    { kind: 'del', line: 2, text: 'b' },
    { kind: 'add', line: 2, text: 'c' },
  ])
})

test('nothing to show is no rows', () => {
  expect(rowsOf('')).toEqual([])
})

// Again past what diffOf hands the pane: `git diff` whole, its file header first. Its `---` and
// `+++` lines are not a removed and an added line.
test("git's file header before the first hunk makes no rows", () => {
  const text = lines('diff --git a/x.ts b/x.ts', 'index 1a2b3c4..5d6e7f8 100644', '--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-a', '+b')

  expect(rowsOf(text)).toEqual([
    { kind: 'hunk', line: 1, context: '' },
    { kind: 'del', line: 1, text: 'a' },
    { kind: 'add', line: 1, text: 'b' },
  ])
})

test('a deleted file, its new side empty, opens on line 1 and numbers its lines where they were', () => {
  expect(rowsOf(lines('@@ -1,2 +0,0 @@', '-one', '-two'))).toEqual([
    { kind: 'hunk', line: 1, context: '' },
    { kind: 'del', line: 1, text: 'one' },
    { kind: 'del', line: 2, text: 'two' },
  ])
})

test('a kept blank line printed as nothing, its space stripped, is still a line', () => {
  const text = lines('@@ -1,3 +1,3 @@', ' a', '', '-b', '+c')

  expect(rowsOf(text)).toEqual([
    { kind: 'hunk', line: 1, context: '' },
    { kind: 'same', line: 1, text: 'a' },
    { kind: 'same', line: 2, text: '' },
    { kind: 'del', line: 3, text: 'b' },
    { kind: 'add', line: 3, text: 'c' },
  ])
})

test("a second file's header ends the hunk before it, and adds no rows of its own", () => {
  const text = lines('@@ -1 +1 @@', '-a', '+b', 'diff --git a/y.ts b/y.ts', '--- a/y.ts', '+++ b/y.ts', '@@ -5 +5 @@', '-c', '+d', '')

  expect(rowsOf(text)).toEqual([
    { kind: 'hunk', line: 1, context: '' },
    { kind: 'del', line: 1, text: 'a' },
    { kind: 'add', line: 1, text: 'b' },
    { kind: 'hunk', line: 5, context: '' },
    { kind: 'del', line: 5, text: 'c' },
    { kind: 'add', line: 5, text: 'd' },
  ])
})
