/** Exercise the new Windows media binaries through one isolated packaged editor export. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This media smoke requires native Windows x64')
const { values } = parseArgs({ options: { app: { type: 'string' }, output: { type: 'string' } } })
if (!values.app || !values.output) throw new Error('Use --app <unpacked application directory> --output <fresh evidence directory>')
const app = await realpath(resolve(values.app))
const output = resolve(values.output)
await mkdir(dirname(output), { recursive: true })
await mkdir(output)
const evidence = await realpath(output)
const resources = join(app, 'resources')
const editorRoot = join(resources, 'mantur-cut')
const appRoot = join(resources, 'app')
const electron = join(app, 'ManTur Agent.exe')
const launcher = join(appRoot, 'node_modules/@deepseek-ai/dsh-client-ui-mantur-editing/adapters/mantur-production-runtime.mjs')
const manifest = JSON.parse(await readFile(join(editorRoot, 'manifest.json'), 'utf8'))
assert.equal(manifest.platform, 'win32')
assert.equal(manifest.arch, 'x64')
assert.equal(JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8')).version, '1.0.0')
const project = join(evidence, 'workspace')
const engine = join(project, '剪辑/windows-native/工程')
const media = join(project, '剪辑/windows-native/素材')
const exports = join(project, '剪辑/windows-native/导出')
const home = join(evidence, 'home')
const temporary = join(evidence, 'tmp')
for (const path of [engine, media, exports, home, temporary]) await mkdir(path, { recursive: true })
await writeFile(join(engine, 'settings.env'), '', { flag: 'wx' })
const systemRoot = process.env.SystemRoot
if (!systemRoot) throw new Error('Native media smoke requires SystemRoot')
const environment = {
  SystemRoot: systemRoot, PATH: join(systemRoot, 'System32'),
  HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'),
  LOCALAPPDATA: join(home, 'AppData/Local'), TEMP: temporary, TMP: temporary,
}
await mkdir(environment.APPDATA, { recursive: true })
await mkdir(environment.LOCALAPPDATA, { recursive: true })
const report = { scope: 'WINDOWS_NATIVE_INPUTS_ONLY', gui: false, app, evidence, commands: [], ok: false }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
report.sourceSha256 = hash(await readFile(join(editorRoot, 'SOURCE/source.json')))
report.buildInfoSha256 = hash(await readFile(join(editorRoot, 'BUILD_INFO.json')))

function stopTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  const result = spawnSync(join(systemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', timeout: 15_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Test-owned process-tree cleanup failed: ${result.stderr || result.stdout}`)
}

async function command(label, executable, args, extraEnvironment = {}) {
  const child = spawn(executable, args, { env: { ...environment, ...extraEnvironment }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks = []
  const errors = []
  let bytes = 0
  let failure
  let rejectCommand
  const done = new Promise((resolveDone, reject) => {
    rejectCommand = reject
    child.once('error', reject)
    child.once('close', (code, signal) => resolveDone({ code, signal }))
  })
  let closeTimer
  const stopAfterFailure = error => {
    if (failure) return
    failure = error
    try {
      stopTree(child)
      closeTimer = setTimeout(() => rejectCommand(new Error(`${label} did not close after test-owned cleanup`)), 5_000)
    } catch (cleanupError) { rejectCommand(cleanupError) }
  }
  const timer = setTimeout(() => stopAfterFailure(new Error(`${label} exceeded its native smoke deadline`)), 90_000)
  const collect = (collection, chunk) => {
    bytes += chunk.length
    if (bytes > 32 * 1024 * 1024) stopAfterFailure(new Error(`${label} exceeded its output budget`))
    else collection.push(chunk)
  }
  child.stdout.on('data', chunk => collect(chunks, chunk))
  child.stderr.on('data', chunk => collect(errors, chunk))
  let status
  try { status = await done } finally { clearTimeout(timer); clearTimeout(closeTimer) }
  const stdout = Buffer.concat(chunks)
  await writeFile(join(evidence, `${label}.stderr.txt`), Buffer.concat(errors))
  report.commands.push({ label, executable, args, ...status })
  if (failure) throw failure
  if (status.code !== 0) throw new Error(`${label} exited with ${status.code}: ${Buffer.concat(errors).toString('utf8')}`)
  return stdout
}

const parent = createServer((_request, response) => { response.writeHead(404).end() })
await new Promise((resolveListening, reject) => { parent.once('error', reject); parent.listen(0, '127.0.0.1', resolveListening) })
const parentOrigin = `http://127.0.0.1:${parent.address().port}`
const token = randomBytes(32).toString('hex')
const diagnostics = join(evidence, 'native-diagnostics')
await mkdir(diagnostics)
const trace = fileURLToPath(new URL('./mantur-cut-windows-smoke-trace.cjs', import.meta.url))
report.diagnostics = { directory: diagnostics, traceSha256: hash(await readFile(trace)), environmentExcluded: true }
const editor = spawn(electron, ['--require', trace, launcher], {
  cwd: engine, env: {
    ...environment, ELECTRON_RUN_AS_NODE: '1', MANTUR_CUT_RESOURCES: editorRoot,
    OPENCHATCUT_DATA_DIR: engine, OPENCHATCUT_MCP_TOKEN: token,
    MANTUR_CUT_MEDIA_DIR: media, MANTUR_CUT_EXPORT_DIR: exports, MANTUR_CUT_PROJECT_DIR: project,
    MANTUR_CUT_PARENT_ORIGIN: parentOrigin, MANTUR_CUT_DRAIN_TIMEOUT_MS: '10000', MANTUR_CUT_STOP_TIMEOUT_MS: '10000',
    MANTUR_CUT_SMOKE_TRACE_DIRECTORY: diagnostics,
  }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
const editorLog = createWriteStream(join(evidence, 'editor.log'), { flags: 'wx' })
editor.stdout.pipe(editorLog, { end: false })
editor.stderr.pipe(editorLog, { end: false })
let editorFailure
editor.once('error', error => { editorFailure = error })
const editorClosed = new Promise(resolveClosed => editor.once('close', (code, signal) => resolveClosed({ code, signal })))
try {
  const origin = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => finish(new Error('Packaged editor startup timed out')), 45_000)
    const receive = message => {
      if (message?.type === 'mantur-cut:startup-result' && !message.ok) finish(new Error(String(message.error).replaceAll(token, '[task-token]')))
      if (message?.type !== 'mantur-cut:ready') return
      if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) { finish(new Error('Invalid packaged editor port')); return }
      finish(undefined, `http://127.0.0.1:${message.port}`)
    }
    const finish = (error, value) => {
      clearTimeout(timer)
      editor.off('message', receive)
      if (error) reject(error); else resolveReady(value)
    }
    editor.on('message', receive)
    void editorClosed.then(() => finish(editorFailure ?? new Error('Packaged editor exited before ready')))
  })
  const privateDirectories = (await readdir(engine)).filter(name => name.startsWith('.mantur-runtime-'))
  assert.equal(privateDirectories.length, 1)
  const privateMedia = join(engine, privateDirectories[0], 'native-media')
  const ffmpeg = join(privateMedia, 'bin/ffmpeg.exe')
  const ffprobe = join(privateMedia, 'bin/ffprobe.exe')
  report.executedMedia = {}
  for (const path of [ffmpeg, ffprobe, join(privateMedia, 'compositor/remotion.exe')]) report.executedMedia[path] = hash(await readFile(path))
  const input = join(temporary, 'red.mp4')
  await command('synthetic-input', ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input])
  const inputBytes = await readFile(input)
  report.input = { file: input, bytes: inputBytes.length, sha256: hash(inputBytes) }
  const uploadResponse = await fetch(`${origin}/upload?name=red.mp4&assetId=red&ifAbsent=1`, {
    method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'none', 'Content-Type': 'video/mp4' },
    body: inputBytes, signal: AbortSignal.timeout(30_000),
  })
  report.uploadStatus = uploadResponse.status
  if (!uploadResponse.ok) throw new Error(await uploadResponse.text())
  const uploaded = await uploadResponse.json()
  report.upload = uploaded
  assert.equal(uploaded.created, true)
  assert.equal(uploaded.bytes, inputBytes.length)
  assert.equal(uploaded.contentHash, report.input.sha256)
  assert.equal(uploaded.path, '/media/uploads/red.mp4')
  const state = {
    id: 'windows-native', name: 'Windows native smoke', order: 0, fps: 30, width: 64, height: 64,
    selectedId: null, trackOrder: ['v1'], tracks: { v1: { kind: 'video' } },
    items: [{ id: 'red', kind: 'video', track: 'v1', sourceAssetId: 'red', name: 'red', src: uploaded.path, volume: 1, width: 64, height: 64, startFrame: 0, durationInFrames: 30 }],
  }
  const response = await fetch(`${origin}/export`, {
    method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'none', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, format: 'video', codec: 'h264', name: 'Windows媒体验证' }), signal: AbortSignal.timeout(180_000),
  })
  report.exportStatus = response.status
  if (!response.ok) throw new Error(await response.text())
  const bytes = Buffer.from(await response.arrayBuffer())
  const video = join(evidence, 'Windows媒体验证.mp4')
  await writeFile(video, bytes, { flag: 'wx' })
  report.output = { file: video, bytes: bytes.length, sha256: hash(bytes) }
  const probe = JSON.parse((await command('output-probe', ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', video])).toString('utf8'))
  await writeFile(join(evidence, 'ffprobe.json'), JSON.stringify(probe, null, 2) + '\n')
  const videoStream = probe.streams.find(stream => stream.codec_type === 'video')
  const audioStream = probe.streams.find(stream => stream.codec_type === 'audio')
  assert.equal(videoStream.codec_name, 'h264')
  assert.equal(videoStream.width, 64)
  assert.equal(videoStream.height, 64)
  assert.equal(Number(videoStream.nb_frames), 30)
  assert.equal(audioStream.codec_name, 'aac')
  assert.equal(Number(audioStream.sample_rate), 48000)
  await command('output-decode', ffmpeg, ['-nostdin', '-v', 'error', '-xerror', '-i', video, '-f', 'null', '-'])
  const metadataProbe = join(evidence, 'compositor-probe.cjs')
  await writeFile(metadataProbe, `const { createRequire } = require('node:module');\nconst renderer = createRequire(process.argv[2])('@remotion/renderer');\nrenderer.getVideoMetadata(process.argv[3], { binariesDirectory: process.argv[4], logLevel: 'error' }).then(value => console.log(JSON.stringify(value)), error => { console.error(error); process.exitCode = 1; });\n`, { flag: 'wx' })
  const metadata = JSON.parse((await command('compositor-probe', electron, [metadataProbe, join(editorRoot, 'runtime/package.json'), video, join(privateMedia, 'compositor')], { ELECTRON_RUN_AS_NODE: '1' })).toString('utf8'))
  assert.equal(metadata.codec, 'h264')
  assert.equal(metadata.width, 64)
  assert.equal(metadata.height, 64)
  assert.equal(metadata.fps, 30)
  assert.equal(metadata.audioCodec, 'aac')
  assert(Math.abs(metadata.durationInSeconds - 1) < 0.05)
  report.compositorMetadata = metadata
  report.ok = true
} catch (error) {
  report.error = error.stack ?? String(error)
  if (error.cause) report.errorCause = { name: error.cause.name, code: error.cause.code, message: String(error.cause.message ?? error.cause).slice(0, 1024) }
  process.exitCode = 1
} finally {
  let stopTimer
  let forcedCloseTimer
  try {
    if (editor.connected) editor.send({ type: 'mantur-cut:stop' })
    const stop = await Promise.race([editorClosed, new Promise(resolveTimeout => { stopTimer = setTimeout(() => resolveTimeout(null), 15_000) })])
    if (stop === null) {
      stopTree(editor)
      const close = await Promise.race([
        editorClosed,
        new Promise((_, reject) => { forcedCloseTimer = setTimeout(() => reject(new Error('Test-owned editor pipes did not close after cleanup')), 5_000) }),
      ])
      report.fixtureCleanup = { forcedTestOwnedTree: true, close }
    } else report.fixtureCleanup = { forcedTestOwnedTree: false, close: stop }
  } catch (error) { report.cleanupError = String(error); process.exitCode = 1; report.ok = false }
  finally {
    clearTimeout(stopTimer)
    clearTimeout(forcedCloseTimer)
    // A descendant can retain stdio after the main process exits; close only this fixture's readers.
    editor.stdout.unpipe(editorLog)
    editor.stderr.unpipe(editorLog)
    editor.stdout.destroy()
    editor.stderr.destroy()
    if (editor.connected) editor.disconnect()
  }
  editorLog.end()
  await finished(editorLog)
  await new Promise((resolveClosed, reject) => parent.close(error => error ? reject(error) : resolveClosed()))
  report.shutdownScope = 'API fixture cleanup only; does not assert installed GUI or automatic update behavior'
  await writeFile(join(evidence, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
