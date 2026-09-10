/** Real execFile cancellation must not finish before its owned child's close event. */
import { execFile, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { runNativeCommand } from '../src/runner.ts'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile: vi.fn(actual.execFile) }
})
afterEach(() => { vi.restoreAllMocks() })

it.skipIf(process.platform === 'win32')('keeps an aborted request pending until the real signal-handling child closes', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  const callbackObserved = Promise.withResolvers<undefined>()
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    // The runner owns this utf8 overload; wrapping its callback only exposes the abort/close ordering.
    const callback = args[3] as (...values: unknown[]) => void
    args[3] = (...values: unknown[]) => { callback(...values); callbackObserved.resolve(undefined) }
    return Reflect.apply(actual.execFile, undefined, args) as ChildProcess
  })
  const controller = new AbortController()
  let settled = false
  const result = runNativeCommand(process.execPath, ['-e',
    'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); process.stdout.write("ready")',
  ], controller.signal).catch((error: unknown) => error).finally(() => { settled = true })
  const child = vi.mocked(execFile).mock.results[0]!.value as ChildProcess
  const closed = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
  try {
    await once(child.stdout!, 'data')
    controller.abort()
    await callbackObserved.promise
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(() => process.kill(child.pid!, 0)).not.toThrow()
  } finally {
    child.kill('SIGKILL')
    await closed
    await result
  }
  expect(await result).toMatchObject({ code: 'ABORT_ERR' })
  expect(settled).toBe(true)
  expect(() => process.kill(child.pid!, 0)).toThrow()
})
