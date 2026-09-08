/** Session-owned editor subprocess and workspace directories. */
import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { createRequire } from 'node:module'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { EditingWorkspace } from './types.ts'
import { resolvePackagedResources } from '@deepseek-ai/dsh-client-ui-mantur-editing/packaged-resources'

/** Deployment settings for the pinned editor source and Node runtime. */
export interface RuntimeConfig {
  /** Explicit development checkout or packaged production server selection. */
  runtimeMode: 'development' | 'packaged'
  /** Absolute development checkout or installed editor resource directory. */
  editorRoot: string
  /** Absolute Node executable for development, or packaged Electron executable. */
  nodeExecutable: string
  /** Maximum wait for the editor's ready handshake. */
  startupTimeoutMs: number
  /** Maximum wait for editor close acknowledgement and subprocess pipes. */
  stopTimeoutMs: number
  /** Maximum duration of one editing tool invocation or editor drain request. */
  toolCallTimeoutMs: number
}

/** Acquired process, retained by its Host owner even if startup later fails. */
export interface EditorProcess {
  /** Freeze editor jobs and drain authoritative work over the owning IPC channel. @returns The retained drain result. */
  drainForShutdown(): Promise<void>
  /** Stop the drained subprocess and await close, including pipes. @returns The retained teardown result. */
  dispose(): Promise<void>
  /** Reject use after an unexpected subprocess exit. */
  assertRunning(): void
}

/** Ready editor, with credentials confined to the Host process. */
export interface EditorRuntime extends EditorProcess {
  workspace: EditingWorkspace
  token: string
}

/**
 * Create Session directories without following a project-local symlink outside the workspace.
 * @param cwd - Session header's existing working directory.
 * @param sessionId - Durable Session identity.
 * @returns Canonical editing directory and its owned subdirectories.
 */
export async function editingDirectories(
  cwd: string | undefined, sessionId: SessionId,
): Promise<{ project: string; directory: string; engine: string; media: string; exports: string }> {
  if (cwd === undefined || !isAbsolute(cwd)) throw new Error('Select a project directory before opening editing')
  const project = await realpath(cwd)
  // Session identities cross the RPC/file boundary before becoming path components.
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error('Invalid editing Session identity')
  let directory = project
  for (const part of ['剪辑', sessionId]) {
    const child = join(directory, part)
    await mkdir(child, { recursive: true, mode: 0o700 })
    if (await realpath(child) !== child) throw new Error('Editing directories must not be symbolic links')
    directory = child
  }
  const paths = { project, directory, engine: join(directory, '工程'), media: join(directory, '素材'), exports: join(directory, '导出') }
  for (const child of [paths.engine, paths.media, paths.exports]) {
    await mkdir(child, { recursive: true, mode: 0o700 })
    if (await realpath(child) !== child) throw new Error('Editing directories must not be symbolic links')
  }
  return paths
}

/**
 * Launch one isolated editor; unconfirmed startup cleanup retains the acquired process owner.
 * @param config - Validated deployment settings.
 * @param cwd - Session working directory.
 * @param sessionId - Session owning the runtime and files.
 * @param parentOrigin - Exact authenticated Mantur browser origin.
 * @param acquired - Receives the process owner before awaiting readiness, including on later startup failure.
 * @returns Ready runtime with an idempotent teardown.
 */
export async function startEditor(
  config: RuntimeConfig, cwd: string | undefined, sessionId: SessionId, parentOrigin: string,
  acquired?: (process: EditorProcess) => void,
): Promise<EditorRuntime> {
  if (config.runtimeMode === 'packaged') resolvePackagedResources(config.editorRoot)
  const paths = await editingDirectories(cwd, sessionId)
  // An empty private keystore prevents the upstream dev config from importing checkout credentials.
  try { await writeFile(join(paths.engine, 'settings.env'), '', { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const token = randomBytes(32).toString('hex')
  const adapter = config.runtimeMode === 'packaged' ? 'mantur-production-runtime.mjs' : 'mantur-runtime.mjs'
  const launcher = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-ui-mantur-editing/package.json').replace(/package\.json$/, `adapters/${adapter}`)
  const child = spawn(config.nodeExecutable, [launcher], {
    cwd: config.runtimeMode === 'packaged' ? paths.engine : config.editorRoot,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      ...(config.runtimeMode === 'packaged' ? {
        ELECTRON_RUN_AS_NODE: '1', SystemRoot: process.env.SystemRoot,
        MANTUR_CUT_RESOURCES: config.editorRoot,
      } : {}),
      OPENCHATCUT_DEV_PROFILE_ID: randomUUID(), OPENCHATCUT_DATA_DIR: paths.engine,
      OPENCHATCUT_MCP_TOKEN: token, MANTUR_CUT_MEDIA_DIR: paths.media, MANTUR_CUT_EXPORT_DIR: paths.exports,
      MANTUR_CUT_PROJECT_DIR: paths.project,
      MANTUR_CUT_PARENT_ORIGIN: parentOrigin,
      MANTUR_CUT_DRAIN_TIMEOUT_MS: String(config.toolCallTimeoutMs), MANTUR_CUT_STOP_TIMEOUT_MS: String(config.stopTimeoutMs),
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let failure: Error | undefined
  let exited = false
  let closed = false
  let cleanExit = false
  let diagnostic = ''
  // Node's spawn overload does not preserve the pipe type when an IPC descriptor is present.
  const stderr = child.stderr as Readable
  stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-8192) })
  const done = new Promise<Error>((resolve) => {
    child.once('error', (error) => { failure = error })
    child.once('exit', () => { exited = true })
    child.once('close', (code, signal) => {
      cleanExit = code === 0 && signal === null && failure === undefined
      failure ??= new Error(`Editing runtime exited (${signal ?? String(code)}): ${diagnostic.replaceAll(token, '[redacted]')}`)
      exited = true
      closed = true
      resolve(failure)
    })
  })
  function phase(request: 'drain' | 'stop', timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (exited || failure) { reject(failure ?? new Error('Editing runtime exited before shutdown completed')); return }
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.off('message', receive)
        if (error) reject(error)
        else resolve()
      }
      const receive = (message: unknown) => {
        if (typeof message !== 'object' || message === null || !('type' in message)
          || message.type !== `mantur-cut:${request}-result`) return
        if ('ok' in message && message.ok === true) finish()
        else {
          const detail = 'error' in message && typeof message.error === 'string' ? message.error : 'Invalid editor shutdown result'
          finish(new Error(detail.replaceAll(token, '[redacted]')))
        }
      }
      const timer = setTimeout(() => {
        finish(new Error(`Editing runtime ${request} timed out; completion is unconfirmed`))
      }, timeoutMs)
      child.on('message', receive)
      void done.then((error) => { finish(error) })
      if (!child.connected) { finish(new Error('Editing runtime IPC disconnected before shutdown completed')); return }
      try { child.send({ type: `mantur-cut:${request}` }, (error) => { if (error) finish(error) }) }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  let draining: Promise<void> | undefined
  let disposal: Promise<void> | undefined
  const drainForShutdown = () => draining ??= phase('drain', config.toolCallTimeoutMs)
  const dispose = () => disposal ??= (async () => {
    await drainForShutdown()
    await phase('stop', config.stopTimeoutMs)
    let timer: NodeJS.Timeout | undefined
    try {
      const exitFailure = await Promise.race([
        done,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { reject(new Error('Editing runtime close timed out; process or pipes remain unconfirmed')) }, config.stopTimeoutMs)
        }),
      ])
      if (!cleanExit) throw exitFailure
    } finally { clearTimeout(timer) }
  })()
  const owned: EditorProcess = {
    drainForShutdown, dispose,
    assertRunning() { if (exited || failure) throw failure ?? new Error('Editing runtime exited') },
  }
  acquired?.(owned)
  try {
    const editorUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Editing runtime startup timed out')) }, config.startupTimeoutMs)
      const finish = (error?: Error, url?: string) => {
        clearTimeout(timer)
        child.off('message', receive)
        if (error) reject(error)
        else if (url) resolve(url)
      }
      const receive = (message: unknown) => {
        if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'mantur-cut:startup-result') {
          const detail = 'error' in message && typeof message.error === 'string' ? message.error : 'Editing runtime startup failed'
          finish(new Error(detail.replaceAll(token, '[redacted]')))
          return
        }
        if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'mantur-cut:ready' || !('port' in message)) return
        const port = message.port
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) { finish(new Error('Invalid editor ready message')); return }
        finish(undefined, `http://127.0.0.1:${port}/`)
      }
      child.on('message', receive)
      void done.then((error) => { finish(error) })
    })
    return { ...owned, workspace: { editorUrl, directory: paths.directory }, token }
  } catch (error) {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- The child close event can arrive while startup is awaited.
    try { if (!closed) await dispose() }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Editing startup and shutdown both failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    throw error
  }
}
