import type { EngineInterface } from 'claude-code'

import { sessionDir } from './disk'
import { backslashed, isWindowsPath } from './paths'

// The apps a file's ⋯ can open it in, the editors installed on the host, found once a session.
// On macOS an editor is its app, which need not have put its command on the PATH (VS Code's
// `code` waits for a step most never take); on Linux it is its command. Windows offers none yet:
// its editors' commands are `.cmd` scripts, which a command run without a shell cannot start.

export type Editor = { name: string; app: string; cli: string }

const EDITORS: Editor[] = [
  { name: 'VS Code', app: 'Visual Studio Code', cli: 'code' },
  { name: 'Cursor', app: 'Cursor', cli: 'cursor' },
  { name: 'Windsurf', app: 'Windsurf', cli: 'windsurf' },
  { name: 'Zed', app: 'Zed', cli: 'zed' },
  { name: 'Sublime Text', app: 'Sublime Text', cli: 'subl' },
  { name: 'WebStorm', app: 'WebStorm', cli: 'webstorm' },
  { name: 'IntelliJ IDEA', app: 'IntelliJ IDEA', cli: 'idea' },
  { name: 'Xcode', app: 'Xcode', cli: 'xed' },
]

// Which system the host is, told by the session's folder on Windows (`C:\…`), else by `uname`.
export type Host = { system: 'mac' | 'windows' | 'other'; editors: Editor[] }

// Kept for the module's life: a reload looks again, so an editor installed since shows up then.
let found: Promise<Host> | null = null

function succeeds($: EngineInterface, argv: string[]) {
  return $.process
    .run(argv, { timeoutMs: 5000 })
    .then(out => out.exitCode === 0)
    .catch(() => false)
}

// `open -Ra` asks Launch Services whether the app is there, and opens nothing.
export function hostOf($: EngineInterface): Promise<Host> {
  found ??= (async () => {
    if (isWindowsPath(await sessionDir($).catch(() => ''))) return { system: 'windows' as const, editors: [] }

    const out = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => null)
    const isMac = out?.stdout.trim() === 'Darwin'
    const has = await Promise.all(
      EDITORS.map(one => succeeds($, isMac ? ['open', '-Ra', one.app] : ['which', one.cli])),
    )

    return { system: isMac ? ('mac' as const) : ('other' as const), editors: EDITORS.filter((_, i) => has[i]) }
  })()

  return found
}

// The file in `editor`, on the host: by its app on macOS, by its command elsewhere.
export function openIn($: EngineInterface, host: Host, editor: Editor, abs: string) {
  return succeeds($, host.system === 'mac' ? ['open', '-a', editor.app, abs] : [editor.cli, abs])
}

// The app that shows a file in its folder on the host, by name: none on Linux, which has no one
// file manager to ask.
export const folderApp = (host: Host) => (host.system === 'mac' ? 'Finder' : host.system === 'windows' ? 'Explorer' : null)

// The file selected in a window of its folder: Finder's, or Explorer's. Explorer takes the path
// only with `\`, and exits 1 whether or not it opened one, so it counts as done once it starts.
export function showInFolder($: EngineInterface, host: Host, abs: string) {
  if (host.system === 'windows') {
    return $.process
      .run(['explorer', `/select,${backslashed(abs)}`], { timeoutMs: 5000 })
      .then(() => true)
      .catch(() => false)
  }

  return succeeds($, ['open', '-R', abs])
}
