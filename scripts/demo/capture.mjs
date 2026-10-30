// Draws each frame record.tsx printed on page.html in headless Chrome, and saves it as a PNG.
//
//     node scripts/demo/capture.mjs <recording.txt> <frames dir>
//
// Chrome is the installed one (CHROME names another), run with a throwaway profile. The frames
// dir gets 0000.png onwards and frames.json, each frame's time in ms.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [recording, outDir] = process.argv.slice(2)
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333
const here = dirname(fileURLToPath(import.meta.url))

const frames = []
const trees = {}
for (const line of readFileSync(recording, 'utf8').split('\n')) {
  if (line.startsWith('FRAME ')) frames.push(JSON.parse(line.slice(6)))
  else if (line.startsWith('TREE ')) {
    const rest = line.slice(5)
    const at = rest.indexOf(' ')
    trees[rest.slice(0, at)] = JSON.parse(rest.slice(at + 1))
  }
}
if (!frames.length) throw new Error(`no frames in ${recording}`)

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'files-pane-demo-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1000,800', '--hide-scrollbars',
  '--force-device-scale-factor=1', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank',
], { stdio: 'ignore' })
const exited = new Promise(resolve => chrome.on('exit', resolve))

let version
for (let i = 0; i < 50 && !version; i++) {
  await new Promise(resolve => setTimeout(resolve, 200))
  version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.json()).catch(() => null)
}
if (!version) throw new Error(`Chrome did not start: ${CHROME}`)

// The DevTools protocol, over the socket Chrome opened.
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data)
  pending.get(msg.id)?.(msg)
  pending.delete(msg.id)
})
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, msg => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
    ws.send(JSON.stringify({ id: n, method, params, sessionId }))
  })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const page = (method, params) => send(method, params, sessionId)
await page('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false })
await page('Page.enable')
await page('Page.navigate', { url: `file://${join(here, 'page.html')}` })
await new Promise(resolve => setTimeout(resolve, 1000))
await page('Runtime.evaluate', { expression: `window.TREES = ${JSON.stringify(trees)}; document.fonts.ready.then(() => true)`, awaitPromise: true })

for (const [i, frame] of frames.entries()) {
  const shown = await page('Runtime.evaluate', { expression: `show(${JSON.stringify(frame)}, TREES[${frame.tree}])`, returnByValue: true })
  if (shown.exceptionDetails) throw new Error(JSON.stringify(shown.exceptionDetails))
  const { data } = await page('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1000, height: 800, scale: 1 } })
  writeFileSync(join(outDir, `${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'))
}
writeFileSync(join(outDir, 'frames.json'), JSON.stringify(frames.map(frame => frame.time)))

ws.close()
chrome.kill()
await exited
rmSync(profile, { recursive: true, force: true })
console.log(`${frames.length} frames in ${outDir}`)
