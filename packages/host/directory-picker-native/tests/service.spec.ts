/** Registration/capability behavior of the native backend (the seam's cordis half). */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { NativeCommandCleanupError } from '@deepseek-ai/dsh-native-command'
import NativeDirectoryPicker from '../src/index.ts'
import { pickNativeDirectory } from '../src/native-picker.ts'

vi.mock('../src/native-picker.ts', () => ({ pickNativeDirectory: vi.fn() }))
const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.resetAllMocks()
})

async function harness() {
  const ctx = new Context()
  roots.push(ctx)
  const fiber = ctx.plugin(NativeDirectoryPicker)
  await fiber.await()
  const capability = ctx.directoryPicker.capability()
  if (capability.kind !== 'native') throw new Error('expected native capability')
  return { ctx, fiber, capability }
}

describe('NativeDirectoryPicker', () => {
  it('freezes captured capabilities and joins every accepted pick, including an already-aborted caller', async () => {
    const first = Promise.withResolvers<string | null>()
    const second = Promise.withResolvers<string | null>()
    vi.mocked(pickNativeDirectory).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { capability } = await harness()
    const caller = new AbortController()
    const one = capability.pick(caller.signal).catch((error: unknown) => error)
    const two = capability.pick(new AbortController().signal).catch((error: unknown) => error)
    caller.abort()
    const stopping = capability.stopForShutdown()
    let stopped = false
    void stopping.then(() => { stopped = true })
    try {
      expect(capability.stopForShutdown()).toBe(stopping)
      expect(vi.mocked(pickNativeDirectory).mock.calls.every(([signal]) => signal.aborted)).toBe(true)
      await expect(capability.pick(new AbortController().signal)).rejects.toThrow('is stopping')
      expect(pickNativeDirectory).toHaveBeenCalledTimes(2)
      expect(stopped).toBe(false)
      first.reject(new Error('caller abort after process close'))
      await one
      expect(stopped).toBe(false)
    } finally {
      first.reject(new Error('test cleanup'))
      second.reject(new Error('service abort after process close'))
      await Promise.all([one, two, stopping])
    }
    expect(stopped).toBe(true)
  })

  it('joins pending picks through the plugin disposer', async () => {
    const childClosed = Promise.withResolvers<string | null>()
    vi.mocked(pickNativeDirectory).mockReturnValueOnce(childClosed.promise)
    const { fiber, capability } = await harness()
    const pick = capability.pick(new AbortController().signal).catch((error: unknown) => error)
    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    try {
      await vi.waitFor(() => { expect(vi.mocked(pickNativeDirectory).mock.calls[0]![0].aborted).toBe(true) })
      expect(disposed).toBe(false)
    } finally {
      childClosed.reject(new Error('closed'))
      await Promise.all([pick, disposal])
    }
    await expect(capability.stopForShutdown()).resolves.toBeUndefined()
  })

  it('retains cleanup failures across repeated stops and disposal', async () => {
    const failure = new NativeCommandCleanupError('termination refused')
    vi.mocked(pickNativeDirectory).mockRejectedValueOnce(failure)
    const { capability, fiber } = await harness()
    await expect(capability.pick(new AbortController().signal)).rejects.toBe(failure)
    const stop = capability.stopForShutdown()
    await expect(stop).rejects.toMatchObject({ errors: [failure] })
    await fiber.dispose()
    expect(capability.stopForShutdown()).toBe(stop)
    await expect(capability.stopForShutdown()).rejects.toMatchObject({ errors: [failure] })
  })

  it('keeps cancellation, selection and cleaned business failures separate from stopping', async () => {
    const { capability } = await harness()
    const aborted = AbortSignal.abort(new Error('caller already cancelled'))
    await expect(capability.pick(aborted)).rejects.toBe(aborted.reason)
    expect(pickNativeDirectory).not.toHaveBeenCalled()
    vi.mocked(pickNativeDirectory).mockResolvedValueOnce(null).mockResolvedValueOnce('/selected')
      .mockRejectedValueOnce(new Error('chooser unavailable'))
    await expect(capability.pick(new AbortController().signal)).resolves.toBeNull()
    await expect(capability.pick(new AbortController().signal)).resolves.toBe('/selected')
    await expect(capability.pick(new AbortController().signal)).rejects.toThrow('chooser unavailable')
    await expect(capability.stopForShutdown()).resolves.toBeUndefined()
  })

  it('does not cancel a different picker instance', async () => {
    const otherClosed = Promise.withResolvers<string | null>()
    vi.mocked(pickNativeDirectory).mockReturnValueOnce(otherClosed.promise)
    const first = await harness()
    const other = await harness()
    const picked = other.capability.pick(new AbortController().signal)
    try {
      await first.capability.stopForShutdown()
      expect(vi.mocked(pickNativeDirectory).mock.calls[0]![0].aborted).toBe(false)
    } finally {
      otherClosed.resolve('/other')
      await picked
    }
  })

  it('registers ctx.directoryPicker with a stable native capability and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(NativeDirectoryPicker)
    await fiber.await()
    const picker = ctx.get('directoryPicker')
    expect(picker).toBeInstanceOf(NativeDirectoryPicker)
    const capability = picker!.capability()
    expect(capability.kind).toBe('native')
    // Stability: consumers may capture the capability object across calls.
    expect(picker!.capability()).toBe(capability)
    await fiber.dispose()
    expect(ctx.get('directoryPicker')).toBeUndefined()
  })
})
