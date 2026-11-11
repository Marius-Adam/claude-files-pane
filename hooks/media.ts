import type { Picture } from '../types'

// Pictures as the file pane previews them: which files are pictures, what a picture's header says
// of its type and size, and an SVG to draw a raster picture with on the surfaces that draw SVG.

// The pictures the file pane previews, by their name.
const PICTURE = /\.(svg|png|jpe?g|gif|webp)$/i

export const isPicture = (path: string) => PICTURE.test(path)

export const isSvg = (path: string) => /\.svg$/i.test(path)

// An Svg element takes at most this many characters of markup.
export const SVG_CHARS = 131072

// What wrapping a raster picture in an SVG adds around its base64: the root, the image, the type.
const WRAP_CHARS = 300

// A raster picture past this many bytes on the disk is described, never read.
export const PICTURE_BYTES = 10 * 1024 * 1024

// The raster picture a file's first bytes say it is, with its pixels' width and height (0 when the
// header gives none within what was read), or null when they are no picture the pane knows.
export function headerOf(bytes: Uint8Array): { type: 'png' | 'jpeg' | 'gif' | 'webp'; width: number; height: number } | null {
  const at = (i: number) => bytes[i] ?? 0
  const be16 = (i: number) => (at(i) << 8) | at(i + 1)
  const le16 = (i: number) => at(i) | (at(i + 1) << 8)
  const be32 = (i: number) => ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0
  const le24 = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16)
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n))

  // A PNG: its signature, then the IHDR chunk, whose first eight bytes are its width and height.
  if (at(0) === 0x89 && ascii(1, 3) === 'PNG') return { type: 'png', width: be32(16), height: be32(20) }

  if (ascii(0, 4) === 'GIF8') return { type: 'gif', width: le16(6), height: le16(8) }

  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4)

    if (chunk === 'VP8 ') return { type: 'webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const [b0, b1, b2, b3] = [at(21), at(22), at(23), at(24)]

      return { type: 'webp', width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
    }
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + le24(24), height: 1 + le24(27) }

    return { type: 'webp', width: 0, height: 0 }
  }

  // A JPEG: its segments one after another until a start of frame, which holds the size. The
  // markers C4, C8 and CC share the range but start no frame.
  if (at(0) === 0xff && at(1) === 0xd8) {
    let i = 2

    while (i + 9 < bytes.length && at(i) === 0xff) {
      const marker = at(i + 1)

      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpeg', width: be16(i + 7), height: be16(i + 5) }
      }
      i += 2 + be16(i + 2)
    }

    return { type: 'jpeg', width: 0, height: 0 }
  }

  return null
}

// The bytes the base64 of a file's start holds: its first `chars` characters, cut to whole groups.
export function bytesOf(base64: string, chars = base64.length): Uint8Array {
  const binary = atob(base64.slice(0, chars - (chars % 4)))
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  return bytes
}

// An SVG file's markup as an Svg element takes it: from its `<svg` on, past any XML declaration,
// doctype or comment before it, with the SVG namespace, which a picture drawn as an image needs.
// Null when it holds no `<svg`.
export function markupOf(text: string): string | null {
  const start = text.search(/<svg[\s>]/i)

  if (start < 0) return null

  const markup = text.slice(start).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd()

  return /^<svg[^>]*\sxmlns=/i.test(markup) ? markup : markup.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
}

// A raster picture wrapped in an SVG, for the surfaces that draw SVG and no raster; null when the
// picture's bytes were not read or would not fit in what an Svg element takes.
export function wrapped(picture: Extract<Picture, { kind: 'raster' }>): string | null {
  const { base64, type, width, height } = picture

  if (base64 === null || !width || !height || base64.length + WRAP_CHARS > SVG_CHARS) return null

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<image width="${width}" height="${height}" href="data:image/${type};base64,${base64}"/></svg>`
  )
}

// A picture a Markdown file shows on a line of its own, `![alt](src)`, with an optional title.
const PICTURE_LINE = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\s*$/

// A Markdown file cut into its text and the pictures on lines of their own, in order; only a
// picture on the disk is cut out (a web address stays in the text, which draws it as a link), at
// most `most` of them, and none inside a fenced block. `dir` is the file's folder, `root` the
// folder a path from `/` starts at.
export type Piece = { text: string } | { alt: string; path: string }

export function piecesOf(markdown: string, dir: string, root: string, most = 8): Piece[] {
  const pieces: Piece[] = []
  let text: string[] = []
  let fence: string | null = null
  let count = 0

  for (const line of markdown.split('\n')) {
    const opens = line.match(/^\s*(```|~~~)/)?.[1]

    if (opens) fence = fence === null ? opens : fence === opens ? null : fence

    const found = fence === null && count < most ? line.match(PICTURE_LINE) : null
    const src = found?.[2]

    if (!found || !src || /^[a-z][a-z\d+.-]*:|^\/\//i.test(src) || !isPicture(src.replace(/[?#].*$/, ''))) {
      text.push(line)
      continue
    }

    if (text.join('').trim()) pieces.push({ text: text.join('\n') })
    text = []
    count++

    const path = safeDecode(src.replace(/[?#].*$/, ''))

    pieces.push({ alt: found[1] ?? '', path: resolved(path.startsWith('/') ? root : dir, path.replace(/^\/+/, '')) })
  }

  if (text.join('').trim()) pieces.push({ text: text.join('\n') })

  return pieces
}

const safeDecode = (path: string) => {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

// `path` from `dir`, its `.` and `..` folded away; never above the drive or the root.
export function resolved(dir: string, path: string): string {
  const parts = `${dir}/${path}`.split('/')
  const out: string[] = []

  for (const [i, part] of parts.entries()) {
    if (part === '..') {
      if (out.length > 1) out.pop()
    } else if (part !== '.' && (part !== '' || i === 0)) out.push(part)
  }

  return out.join('/')
}
