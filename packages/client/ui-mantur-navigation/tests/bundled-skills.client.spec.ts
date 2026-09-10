/** Local catalog ownership: no online substitute, overlapping load or late publication. */
import { expect, it, vi } from 'vitest'
import { BundledSkills } from '../src/client/bundled-skills.ts'

it('shares a pending discovery and publishes the local result', async () => {
  const pending = Promise.withResolvers<[]>()
  const read = vi.fn(() => pending.promise)
  const subject = new BundledSkills(read)
  try {
    const first = subject.load()
    await subject.load()
    expect(read).toHaveBeenCalledOnce()
    expect(subject.store.getSnapshot()).toEqual({ phase: 'loading' })
    pending.resolve([])
    await first
    expect(subject.store.getSnapshot()).toEqual({ phase: 'ready', skills: [] })
  } finally { subject.dispose() }
})

it('exposes failure and retries only on an explicit load', async () => {
  const read = vi.fn<() => Promise<[]>>().mockRejectedValueOnce(new Error('Missing manifest')).mockResolvedValueOnce([])
  const subject = new BundledSkills(read)
  try {
    await subject.load()
    expect(subject.store.getSnapshot()).toEqual({ phase: 'failed' })
    expect(read).toHaveBeenCalledOnce()
    await subject.load()
    expect(subject.store.getSnapshot()).toEqual({ phase: 'ready', skills: [] })
  } finally { subject.dispose() }
})

it.each([true, false])('cancels on teardown without publishing a late success=%s', async (success) => {
  const pending = Promise.withResolvers<[]>()
  const read = vi.fn((_signal: AbortSignal) => pending.promise)
  const subject = new BundledSkills(read)
  const load = subject.load()
  subject.dispose()
  expect(read.mock.calls[0]![0].aborted).toBe(true)
  if (success) pending.resolve([])
  else pending.reject(new Error('Aborted'))
  await load
  expect(subject.store.getSnapshot()).toEqual({ phase: 'loading' })
  await subject.load()
  expect(read).toHaveBeenCalledOnce()
})
