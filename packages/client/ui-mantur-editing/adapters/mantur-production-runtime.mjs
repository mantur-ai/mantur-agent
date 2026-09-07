/** Run the packaged editor with Session-owned writable rendering resources. */
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolvePackagedResources } from './mantur-packaged-resources.mjs'
import { installRuntimeShutdown } from './mantur-runtime-shutdown.mjs'

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
let startup
const shutdown = installRuntimeShutdown({
  drain: async () => {
    await startup
    const owner = server?.manturShutdown
    if (!owner || typeof owner.stopForShutdown !== 'function') throw new Error('Editor does not expose its authoritative shutdown owner')
    await owner.stopForShutdown()
  },
  close: async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    if (temporary) await rm(temporary, { recursive: true })
  },
})

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
  const { startEmbeddedServer } = await import(pathToFileURL(resources.server).href)
  const embedded = await startEmbeddedServer(resources.web, { port: 0, parentOrigin })
  server = embedded.server
  process.send({ type: 'mantur-cut:ready', port: embedded.port })
})()
try { await startup }
catch (error) {
  console.error(error)
  await shutdown.startupFailed(error)
  try { await shutdown.stop() } catch (cleanupError) { console.error(cleanupError) }
  process.exitCode = 1
}
