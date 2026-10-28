/** Keep taskkill callback and actual browser close separate in the cleanup experiment. */
import { expect, it } from 'vitest'
// @ts-expect-error The native diagnostic is plain JavaScript without a declaration artifact.
import { exerciseCleanupOrder } from './mantur-cut-windows-browser-cleanup-probe.mjs'

it('deletes immediately while callback and browser close are still pending', async () => {
  const callback = Promise.withResolvers<undefined>()
  const closed = Promise.withResolvers<undefined>()
  const events: string[] = []
  const operation = exerciseCleanupOrder(false, () => { events.push('taskkill'); return callback.promise },
    closed.promise, () => { events.push('delete') })
  expect(events).toEqual(['taskkill', 'delete'])
  callback.resolve(undefined)
  closed.resolve(undefined)
  await operation
})

it('does not treat the taskkill callback as actual browser process and stdio closure', async () => {
  const callback = Promise.withResolvers<undefined>()
  const closed = Promise.withResolvers<undefined>()
  let removed = false
  const operation = exerciseCleanupOrder(true, () => callback.promise, closed.promise, () => { removed = true })
  callback.resolve(undefined)
  await Promise.resolve()
  expect(removed).toBe(false)
  closed.resolve(undefined)
  await operation
  expect(removed).toBe(true)
})

it('retains a deletion exception after observing the owned browser closure', async () => {
  const failure = new Error('owned directory could not be removed')
  const operation = exerciseCleanupOrder(false, () => Promise.resolve(), Promise.resolve(), () => { throw failure })
  await expect(operation).rejects.toBe(failure)
})
