import type { EngineInterface } from 'claude-code'

// The apps a file's ⋯ can open it in, the editors installed on the host, found once a session.
// On macOS an editor is its app, which need not have put its command on the PATH (VS Code's
// `code` waits for a step most never take); elsewhere it is its command.

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

export type Host = { isMac: boolean; editors: Editor[] }

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
    const out = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => null)
    const isMac = out?.stdout.trim() === 'Darwin'
    const has = await Promise.all(
      EDITORS.map(one => succeeds($, isMac ? ['open', '-Ra', one.app] : ['which', one.cli])),
    )

    return { isMac, editors: EDITORS.filter((_, i) => has[i]) }
  })()

  return found
}

// The file in `editor`, on the host: by its app on macOS, by its command elsewhere.
export function openIn($: EngineInterface, host: Host, editor: Editor, abs: string) {
  return succeeds($, host.isMac ? ['open', '-a', editor.app, abs] : [editor.cli, abs])
}

// The file selected in a Finder window of its folder.
export function showInFinder($: EngineInterface, abs: string) {
  return succeeds($, ['open', '-R', abs])
}
