import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { hostOf, openIn } from '../../hooks/editors'

const PROJECT = 'C:\\proj'
const FILE = `${PROJECT}\\100% done & a^b.ts`

type Init = { cwd?: string; env?: Record<string, string>; timeoutMs?: number }

// $.process.run as the engine documents it: by argv with no shell, the env over the host's, resolved
// once the child exits and its output is read whole, killed and rejected at the timeout.
const run = (argv: readonly string[], init: Init = {}) =>
  new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const started = Date.now()
    const child = spawn(argv[0]!, argv.slice(1), { cwd: init.cwd ?? PROJECT, env: { ...process.env, ...init.env }, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => (stdout += data))
    child.stderr.on('data', data => (stderr += data))
    child.on('exit', code => console.log(`  exit ${code} after ${Date.now() - started} ms: ${JSON.stringify(argv)}`))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`still running after ${init.timeoutMs} ms (output not closed): ${JSON.stringify(argv)}`))
    }, init.timeoutMs ?? 30000)
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      console.log(`  output closed after ${Date.now() - started} ms`)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })

const $ = {
  session: { cwd: async () => PROJECT },
  process: { run },
  fs: { read: async (path: string) => readFileSync(path, 'utf8') },
}

mkdirSync(PROJECT, { recursive: true })
writeFileSync(FILE, 'export const x = 1\n')

const host = await hostOf($ as never)
console.log('host:', JSON.stringify(host, null, 2))

const code = host.editors.find(one => one.cli === 'code')
if (!code) throw new Error('VS Code not found')

const opened = await openIn($ as never, host, code, FILE.replace(/\\/g, '/'))
console.log('openIn:', opened)
if (!opened) throw new Error('openIn failed')

// The app VS Code's script started, and the file it was handed, whole.
await new Promise(done => setTimeout(done, 5000))
const ps = await run(['powershell', '-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Code.exe'\" | ForEach-Object { $_.CommandLine }"])
console.log(ps.stdout)
if (!ps.stdout.includes(FILE)) throw new Error('No Code.exe was handed the file whole')
console.log('VS Code started with the file whole')
