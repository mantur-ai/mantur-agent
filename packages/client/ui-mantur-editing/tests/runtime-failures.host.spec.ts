import { EventEmitter } from 'node:events'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { editingDirectories, startEditor, type EditorProcess, type EditorRuntime, type RuntimeConfig } from '../src/runtime.ts'

type Spawn = (executable: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => FakeChild

const harness = vi.hoisted(() => ({
  spawn: vi.fn<Spawn>(),
  packaged: vi.fn(() => ({})),
  writeError: undefined as NodeJS.ErrnoException | undefined,
}))

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: harness.spawn,
}))

vi.mock('@deepseek-ai/dsh-client-ui-mantur-editing/packaged-resources', () => ({
  resolvePackagedResources: harness.packaged,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async writeFile(...args: Parameters<typeof actual.writeFile>) {
      const error = harness.writeError
      harness.writeError = undefined
      if (error !== undefined) throw error
      return actual.writeFile(...args)
    },
  }
})

type Send = (message: unknown, callback?: (error?: Error | null) => void) => void

interface FakeChild extends EventEmitter {
  connected: boolean
  stderr: EventEmitter
  send: ReturnType<typeof vi.fn<Send>>
}

const roots: string[] = []
const runtimes: EditorRuntime[] = []

afterEach(async () => {
  vi.useRealTimers()
  harness.spawn.mockReset()
  harness.packaged.mockClear()
  harness.writeError = undefined
  await Promise.allSettled(runtimes.splice(0).map(runtime => runtime.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mantur-runtime-errors-'))
  roots.push(root)
  return root
}

function child(send: Send = (_message, callback) => { callback?.() }): FakeChild {
  const value = new EventEmitter() as FakeChild
  value.connected = true
  value.stderr = new EventEmitter()
  value.send = vi.fn(send)
  return value
}

async function config(): Promise<RuntimeConfig> {
  return {
    runtimeMode: 'development', editorRoot: await temp(), nodeExecutable: process.execPath,
    startupTimeoutMs: 1000, stopTimeoutMs: 1000, toolCallTimeoutMs: 1000,
  }
}

async function spawned(promise: Promise<unknown>): Promise<FakeChild> {
  await vi.waitFor(() => { expect(harness.spawn).toHaveBeenCalledOnce() })
  const value = harness.spawn.mock.results[0]?.value as FakeChild
  expect(value).toBeDefined()
  void promise.catch(() => {})
  return value
}

async function ready(
  value: FakeChild,
  pending: Promise<EditorRuntime>,
  acquired?: EditorProcess[],
): Promise<EditorRuntime> {
  value.emit('message', { type: 'mantur-cut:ready', port: 5300 })
  const runtime = await pending
  runtimes.push(runtime)
  expect(acquired === undefined || acquired[0] !== undefined).toBe(true)
  return runtime
}

function finishPhase(value: FakeChild, request: 'drain' | 'stop', ok = true, error?: string): void {
  value.emit('message', { type: `mantur-cut:${request}-result`, ok, ...(error === undefined ? {} : { error }) })
}

it('rejects a linked top-level editing directory and a non-EEXIST settings failure', async () => {
  const project = await temp()
  const outside = await temp()
  await symlink(outside, join(project, '剪辑'))
  await expect(editingDirectories(project, 'linked' as SessionId)).rejects.toThrow('symbolic')

  const writeError = new Error('settings disk failed') as NodeJS.ErrnoException
  writeError.code = 'EIO'
  harness.writeError = writeError
  await expect(startEditor(await config(), await temp(), 'settings' as SessionId, 'http://127.0.0.1:5298'))
    .rejects.toThrow('settings disk failed')
  expect(harness.spawn).not.toHaveBeenCalled()
})

it('preserves an existing private settings file', async () => {
  const value = child((message) => {
    if ((message as { type?: string }).type === 'mantur-cut:drain') finishPhase(value, 'drain')
    else if ((message as { type?: string }).type === 'mantur-cut:stop') {
      finishPhase(value, 'stop')
      value.emit('close', 0, null)
    }
  })
  harness.spawn.mockReturnValue(value)
  const runtimeConfig = await config()
  const project = await temp()
  const paths = await editingDirectories(project, 'existing-settings' as SessionId)
  await fsPromises.writeFile(join(paths.engine, 'settings.env'), 'existing')
  const pending = startEditor(runtimeConfig, project, 'existing-settings' as SessionId, 'http://127.0.0.1:5298')
  await spawned(pending)
  await ready(value, pending)
})

it('launches the packaged adapter from the private engine directory', async () => {
  const value = child((message) => {
    if ((message as { type?: string }).type === 'mantur-cut:drain') finishPhase(value, 'drain')
    else if ((message as { type?: string }).type === 'mantur-cut:stop') {
      finishPhase(value, 'stop')
      value.emit('close', 0, null)
    }
  })
  harness.spawn.mockReturnValue(value)
  const runtimeConfig = { ...await config(), runtimeMode: 'packaged' as const }
  const pending = startEditor(runtimeConfig, await temp(), 'packaged' as SessionId, 'http://127.0.0.1:5298')
  await spawned(pending)
  const runtime = await ready(value, pending)
  const [executable, args, options] = harness.spawn.mock.calls[0]!
  expect(harness.packaged).toHaveBeenCalledWith(runtimeConfig.editorRoot)
  expect(executable).toBe(process.execPath)
  expect(args[0]).toContain('mantur-production-runtime.mjs')
  expect(options.cwd).toContain('/工程')
  expect(options.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', MANTUR_CUT_RESOURCES: runtimeConfig.editorRoot })
  await runtime.dispose()
})

it('validates startup messages and redacts startup diagnostics', async () => {
  let index = 0
  for (const message of [
    { type: 'mantur-cut:ready', port: 0 },
    { type: 'mantur-cut:ready', port: 1.5 },
    { type: 'mantur-cut:ready', port: 65536 },
    { type: 'mantur-cut:startup-result' },
    { type: 'mantur-cut:startup-result', error: 'startup secret' },
  ]) {
    const value = child((request) => {
      if ((request as { type?: string }).type === 'mantur-cut:drain') finishPhase(value, 'drain')
      else if ((request as { type?: string }).type === 'mantur-cut:stop') {
        finishPhase(value, 'stop')
        value.emit('close', 0, null)
      }
    })
    harness.spawn.mockReturnValueOnce(value)
    const pending = startEditor(await config(), await temp(), `startup-${String(index++)}` as SessionId, 'http://127.0.0.1:5298')
    await spawned(pending)
    value.emit('message', null)
    value.emit('message', {})
    value.emit('message', { type: 'other' })
    value.emit('message', message)
    await expect(pending).rejects.toThrow(message.type === 'mantur-cut:ready' ? 'Invalid editor ready message' : message.error ?? 'startup failed')
    harness.spawn.mockClear()
  }
})

it('rejects malformed, failed, disconnected and throwing shutdown phases', async () => {
  const cases: Array<{ send: (owner: FakeChild) => Send; expected: string }> = [
    { expected: 'Invalid editor shutdown result', send: owner => (message) => {
      const request = (message as { type: string }).type.endsWith('drain') ? 'drain' : 'stop'
      owner.emit('message', null)
      owner.emit('message', {})
      owner.emit('message', { type: 'other' })
      finishPhase(owner, request, false)
    } },
    { expected: 'remote drain failed', send: owner => (message) => {
      const request = (message as { type: string }).type.endsWith('drain') ? 'drain' : 'stop'
      finishPhase(owner, request, false, 'remote drain failed')
    } },
    { expected: 'send callback failed', send: () => (_message, callback) => { callback?.(new Error('send callback failed')) } },
    { expected: 'thrown send failure', send: () => () => { throw new Error('thrown send failure') } },
    { expected: 'plain send failure', send: () => () => { throw 'plain send failure' } },
  ]
  let index = 0
  for (const entry of cases) {
    const value = child()
    value.send = vi.fn(entry.send(value))
    harness.spawn.mockReturnValueOnce(value)
    const pending = startEditor(await config(), await temp(), `phase-${String(index++)}` as SessionId, 'http://127.0.0.1:5298')
    await spawned(pending)
    const runtime = await ready(value, pending)
    await expect(runtime.drainForShutdown()).rejects.toThrow(entry.expected)
    harness.spawn.mockClear()
  }

  const disconnected = child()
  harness.spawn.mockReturnValueOnce(disconnected)
  const pending = startEditor(await config(), await temp(), 'disconnected' as SessionId, 'http://127.0.0.1:5298')
  await spawned(pending)
  const runtime = await ready(disconnected, pending)
  disconnected.connected = false
  await expect(runtime.drainForShutdown()).rejects.toThrow('IPC disconnected')
})

it('reports a shutdown phase deadline', async () => {
  const hanging = child()
  harness.spawn.mockReturnValue(hanging)
  const waiting = startEditor({ ...await config(), toolCallTimeoutMs: 60_000 }, await temp(), 'phase-timeout' as SessionId, 'http://127.0.0.1:5298')
  await spawned(waiting)
  const hangingRuntime = await ready(hanging, waiting)
  vi.useFakeTimers()
  const deadline = expect(hangingRuntime.drainForShutdown()).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(60_000)
  await deadline
})

it('reports exit, process failure, close failure and close timeout independently', async () => {
  const exited = child()
  harness.spawn.mockReturnValueOnce(exited)
  let pending = startEditor(await config(), await temp(), 'exited' as SessionId, 'http://127.0.0.1:5298')
  await spawned(pending)
  let runtime = await ready(exited, pending)
  expect(() => { runtime.assertRunning() }).not.toThrow()
  exited.emit('exit', 0, null)
  expect(() => { runtime.assertRunning() }).toThrow('exited')
  await expect(runtime.drainForShutdown()).rejects.toThrow('before shutdown')
  harness.spawn.mockClear()

  const failed = child()
  harness.spawn.mockReturnValueOnce(failed)
  pending = startEditor(await config(), await temp(), 'failed' as SessionId, 'http://127.0.0.1:5298')
  await spawned(pending)
  runtime = await ready(failed, pending)
  failed.emit('error', new Error('process failed'))
  expect(() => { runtime.assertRunning() }).toThrow('process failed')
  await expect(runtime.drainForShutdown()).rejects.toThrow('process failed')
  harness.spawn.mockClear()

  const dirty = child((message) => {
    const request = (message as { type: string }).type.endsWith('drain') ? 'drain' : 'stop'
    finishPhase(dirty, request)
    if (request === 'stop') dirty.emit('close', 1, 'SIGTERM')
  })
  harness.spawn.mockReturnValueOnce(dirty)
  pending = startEditor(await config(), await temp(), 'dirty' as SessionId, 'http://127.0.0.1:5298')
  await spawned(pending)
  runtime = await ready(dirty, pending)
  await expect(runtime.dispose()).rejects.toThrow('SIGTERM')
  harness.spawn.mockClear()

  vi.useFakeTimers()
  const hanging = child((message) => {
    const request = (message as { type: string }).type.endsWith('drain') ? 'drain' : 'stop'
    finishPhase(hanging, request)
  })
  harness.spawn.mockReturnValueOnce(hanging)
  pending = startEditor({ ...await config(), stopTimeoutMs: 60_000 }, await temp(), 'hanging' as SessionId, 'http://127.0.0.1:5298')
  await spawned(pending)
  runtime = await ready(hanging, pending)
  const disposal = expect(runtime.dispose()).rejects.toThrow('close timed out')
  await vi.advanceTimersToNextTimerAsync()
  await disposal
})

it('reports startup and cleanup failures together', async () => {
  const value = child((message) => {
    if ((message as { type?: string }).type === 'mantur-cut:drain') finishPhase(value, 'drain', false, 'cleanup failed')
  })
  harness.spawn.mockReturnValueOnce(value)
  const pending = startEditor(await config(), await temp(), 'double-failure' as SessionId, 'http://127.0.0.1:5298')
  await spawned(pending)
  value.emit('message', { type: 'mantur-cut:startup-result', error: 'startup failure' })
  await expect(pending).rejects.toThrow('startup failure')
})

it('keeps the original startup failure when the process already closed cleanly', async () => {
  const value = child()
  harness.spawn.mockReturnValueOnce(value)
  const pending = startEditor(await config(), await temp(), 'closed-startup' as SessionId, 'http://127.0.0.1:5298')
  await spawned(pending)
  value.emit('message', { type: 'mantur-cut:startup-result', error: 'startup rejected' })
  value.emit('close', 0, null)
  await expect(pending).rejects.toThrow('startup rejected')
})
