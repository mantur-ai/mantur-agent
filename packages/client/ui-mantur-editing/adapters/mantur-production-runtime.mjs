/** Run the packaged editor with Session-owned writable rendering resources. */
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolvePackagedResources } from './mantur-packaged-resources.mjs'

const resources = resolvePackagedResources(process.env.MANTUR_CUT_RESOURCES)
const resourceRoot = await realpath(process.env.MANTUR_CUT_RESOURCES)
const parentOrigin = process.env.MANTUR_CUT_PARENT_ORIGIN
const parent = new URL(parentOrigin)
if (parent.origin !== parentOrigin || parent.protocol !== 'http:'
  || !['127.0.0.1', 'localhost', '[::1]'].includes(parent.hostname)) {
  throw new Error('Packaged editor requires the exact Mantur loopback origin')
}
if (!process.send) throw new Error('Packaged editor requires its owning Host IPC channel')
const engine = await realpath(process.cwd())
if (await realpath(process.env.OPENCHATCUT_DATA_DIR) !== engine) throw new Error('Packaged editor must start in its Session data directory')

let server
let temporary
let stopping = false
let shutdown
let startup
let startupFailure
const stop = () => shutdown ??= (async () => {
  stopping = true
  try {
    // Startup owns copies and server acquisition even when cancellation arrives first.
    try { await startup } catch { /* Startup reports its own failure; cleanup must still run. */ }
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  } finally {
    if (temporary) await rm(temporary, { recursive: true })
  }
})()
const requestStop = () => {
  void stop().then(() => process.exit(startupFailure ? 1 : 0), error => { console.error(error); process.exit(1) })
}
process.once('SIGTERM', requestStop)
process.once('SIGINT', requestStop)
process.once('disconnect', requestStop)
process.on('message', message => { if (message?.type === 'mantur-cut:stop') requestStop() })

startup = (async () => {
  temporary = await mkdtemp(join(engine, '.mantur-runtime-'))
  const home = join(temporary, 'home')
  const temp = join(temporary, 'tmp')
  await mkdir(home, { mode: 0o700 })
  await mkdir(temp, { mode: 0o700 })
  const renderBundle = join(temporary, 'remotion-bundle')
  const compositor = join(temporary, 'compositor')
  const copyOptions = { recursive: true, dereference: true, filter: async source => {
    const local = relative(resourceRoot, await realpath(source))
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error('Packaged render resource link escapes its installation')
    return true
  } }
  await cp(resources.remotionBundle, renderBundle, copyOptions)
  await cp(resources.compositor, compositor, copyOptions)
  Object.assign(process.env, {
    HOME: home, USERPROFILE: home, TMPDIR: temp, TEMP: temp, TMP: temp,
    CC_REMOTION_BUNDLE: renderBundle, CC_REMOTION_BINARIES_DIR: compositor,
    CC_BROWSER_EXECUTABLE: resources.browserExecutable,
    OPENCHATCUT_FFMPEG: resources.ffmpeg, OPENCHATCUT_FFPROBE: resources.ffprobe,
    OPENCHATCUT_WHISPER_CLI: resources.whisperCli,
  })
  if (stopping) return
  const { startEmbeddedServer } = await import(pathToFileURL(resources.server).href)
  const embedded = await startEmbeddedServer(resources.web, { port: 0, parentOrigin })
  server = embedded.server
  if (!stopping) process.send({ type: 'mantur-cut:ready', port: embedded.port })
})().catch(error => { startupFailure = error; throw error })
try { await startup }
catch (error) {
  console.error(error)
  try { await stop() } catch (cleanupError) { console.error(cleanupError) }
  process.exit(1)
}
