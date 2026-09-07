/** Fixture cleanup ordering and retained failures, independent of OS descriptor latency. */
import { expect, it, vi } from 'vitest'
import { finishNativeHostFixture } from './native-account-host-support.ts'

it('waits for consumer cleanup before closing Main', async () => {
  const drained = Promise.withResolvers<undefined>()
  const close = vi.fn(async () => {})
  const finishing = finishNativeHostFixture(() => drained.promise, close)
  expect(close).not.toHaveBeenCalled()
  drained.resolve(undefined)
  await finishing
  expect(close).toHaveBeenCalledOnce()
})

it('still closes Main and retains a failed consumer cleanup assertion', async () => {
  const failure = new Error('consumer cleanup was not acknowledged')
  const close = vi.fn(async () => {})
  const result = await finishNativeHostFixture(() => Promise.reject(failure), close).catch((error: unknown) => error)
  expect(close).toHaveBeenCalledOnce()
  expect(result).toMatchObject({ errors: [failure] })
})

it('retains both consumer and Main cleanup failures', async () => {
  const consumer = new Error('consumer cleanup failed')
  const main = new Error('Main cleanup failed')
  await expect(finishNativeHostFixture(() => Promise.reject(consumer), () => Promise.reject(main)))
    .rejects.toMatchObject({ errors: [consumer, main] })
})

it('does not turn a Main shutdown rejection into fixture success', async () => {
  const failure = new Error('Main cleanup failed')
  await expect(finishNativeHostFixture(async () => {}, () => Promise.reject(failure)))
    .rejects.toMatchObject({ errors: [failure] })
})
