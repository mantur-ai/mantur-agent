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
  /** Grace period before killing an editor that has not stopped. */
  stopTimeoutMs: number
  /** Maximum duration of one editing tool invocation. */
  toolCallTimeoutMs: number
}

/** Active editor, with credentials confined to the Host process. */
export interface EditorRuntime {
  workspace: EditingWorkspace
  token: string
  /** Stop the subprocess and await exit. @returns Completed teardown. */
  dispose(): Promise<void>
  /** Reject use after an unexpected subprocess exit. */
  assertRunning(): void
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
 * Launch one isolated editor; startup failure always stops and drains the child.
 * @param config - Validated deployment settings.
 * @param cwd - Session working directory.
 * @param sessionId - Session owning the runtime and files.
 * @param parentOrigin - Exact authenticated Mantur browser origin.
 * @returns Ready runtime with an idempotent teardown.
 */
export async function startEditor(
  config: RuntimeConfig, cwd: string | undefined, sessionId: SessionId, parentOrigin: string,
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
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let failure: Error | undefined
  let exited = false
  let cleanExit = false
  let diagnostic = ''
  // Node's spawn overload does not preserve the pipe type when an IPC descriptor is present.
  const stderr = child.stderr as Readable
  stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-8192) })
  const done = new Promise<Error>((resolve) => {
    child.once('error', (error) => { failure = error })
    child.once('close', (code, signal) => {
      cleanExit = code === 0 && signal === null
      failure ??= new Error(`Editing runtime exited (${signal ?? String(code)}): ${diagnostic.replaceAll(token, '[redacted]')}`)
      exited = true
      resolve(failure)
    })
  })
  let disposal: Promise<void> | undefined
  const dispose = () => disposal ??= (async () => {
    if (exited) return
    let stopError: Error | undefined
    if (config.runtimeMode === 'packaged' && child.connected) child.send({ type: 'mantur-cut:stop' }, (error) => {
      if (error && !exited) { stopError = error; child.kill('SIGKILL') }
    })
    else child.kill('SIGTERM')
    const timer = setTimeout(() => {
      stopError = new Error('Editing runtime did not complete shutdown before its deadline')
      child.kill('SIGKILL')
    }, config.stopTimeoutMs)
    const exitFailure = await done.finally(() => { clearTimeout(timer) })
    if (config.runtimeMode === 'packaged') {
      if (stopError) throw stopError
      if (!cleanExit) throw exitFailure
    }
  })()
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
        if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'mantur-cut:ready' || !('port' in message)) return
        const port = message.port
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) { finish(new Error('Invalid editor ready message')); return }
        finish(undefined, `http://127.0.0.1:${port}/`)
      }
      child.on('message', receive)
      void done.then((error) => { finish(error) })
    })
    return { workspace: { editorUrl, directory: paths.directory }, token, dispose,
      assertRunning() { if (exited) throw failure ?? new Error('Editing runtime stopped') },
    }
  } catch (error) {
    try { await dispose() }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Editing startup and shutdown both failed') }
    throw error
  }
}
