/** Main accepts only its own successful save receipt, never process exit or an old reply. */
import { ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { requestUpdateSave } from '../src/update-save.ts'
import { prepareDesktopUpdate } from '../src/prepare-update.ts'

function childFixture() {
  const child = new ChildProcess()
  Object.defineProperty(child, 'connected', { value: true, writable: true })
  const send = vi.fn((_message: unknown) => true)
  Object.defineProperty(child, 'send', { value: send })
  return { child, send, id: () => (send.mock.calls[0]![0] as { id: string }).id }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('accepts only the current request and removes its observers afterwards', async () => {
  const { child, id } = childFixture()
  let saved = false
  const pending = requestUpdateSave({ child, timeoutMs: 1000 }).then((value) => { saved = true; return value })
  child.emit('message', { type: 'mantur:update:prepared', id: '00000000-0000-0000-0000-000000000000', ok: true, checkpoints: [] })
  await Promise.resolve(undefined)
  expect(saved).toBe(false)
  const checkpoints = [{ sessionId: 'session-one', nextSeq: 4 }]
  child.emit('message', { type: 'mantur:update:prepared', id: id(), ok: true, checkpoints })
  expect(await pending).toEqual(checkpoints)
  expect(child.listenerCount('message')).toBe(0)
})

it.each(['exit', 'disconnect', 'error'] as const)('rejects %s without a receipt', async (event) => {
  const { child } = childFixture()
  const pending = requestUpdateSave({ child, timeoutMs: 1000 })
  const rejected = expect(pending).rejects.toThrow()
  child.emit(event, ...(event === 'error' ? [new Error('transport failed')] : [0, null]))
  await rejected
  expect(child.listenerCount('message')).toBe(0)
})

it('keeps Host failure as installation failure', async () => {
  const { child, id } = childFixture()
  const pending = requestUpdateSave({ child, timeoutMs: 1000 })
  const rejected = expect(pending).rejects.toThrow('writer close failed')
  child.emit('message', { type: 'mantur:update:prepared', id: id(), ok: false, error: 'writer close failed' })
  await rejected
})

it('ignores late success after the bounded wait expires', async () => {
  vi.useFakeTimers()
  const { child, id } = childFixture()
  const pending = requestUpdateSave({ child, timeoutMs: 25 })
  const rejected = expect(pending).rejects.toThrow('deadline')
  await vi.advanceTimersByTimeAsync(25)
  await rejected
  child.emit('message', { type: 'mantur:update:prepared', id: id(), ok: true, checkpoints: [] })
  expect(child.listenerCount('message')).toBe(0)
})

it('cancels before sending or while awaiting a receipt', async () => {
  const { child, send } = childFixture()
  const before = new AbortController()
  before.abort()
  await expect(requestUpdateSave({ child, timeoutMs: 1000, signal: before.signal })).rejects.toThrow('cancelled')
  expect(send).not.toHaveBeenCalled()
  const during = new AbortController()
  const pending = requestUpdateSave({ child, timeoutMs: 1000, signal: during.signal })
  const rejected = expect(pending).rejects.toThrow('cancelled')
  during.abort()
  await rejected
  expect(child.listenerCount('message')).toBe(0)
})

it('keeps the account channel open through save and waits for actual Host exit', async () => {
  const receipt = Promise.withResolvers<undefined>()
  const exit = Promise.withResolvers<undefined>()
  const order: string[] = []
  let done = false
  const prepared = prepareDesktopUpdate({
    saveDrafts: async () => { order.push('drafts') }, releaseDrafts: () => { order.push('release') },
    saveHost: async () => { order.push('save'); await receipt.promise },
    closeAccount: async () => { order.push('account') },
    stopHost: async () => { order.push('stop'); await exit.promise }, cancelled: () => false,
  }).then(() => { done = true })
  try {
    await Promise.resolve(undefined); await Promise.resolve(undefined)
    expect(order).toEqual(['drafts', 'save'])
    expect(done).toBe(false)
    receipt.resolve(undefined)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(order).toEqual(['drafts', 'save', 'account', 'stop'])
    expect(done).toBe(false)
    exit.resolve(undefined)
    await prepared
    expect(done).toBe(true)
  } finally { receipt.resolve(undefined); exit.resolve(undefined); await prepared }
})

it.each(['drafts', 'save', 'account', 'stop'] as const)('does not install after %s fails', async (stage) => {
  const release = vi.fn()
  const run = async (name: string) => { if (stage === name) throw new Error(name) }
  await expect(prepareDesktopUpdate({
    saveDrafts: () => run('drafts'), releaseDrafts: release, saveHost: () => run('save'),
    closeAccount: () => run('account'), stopHost: () => run('stop'), cancelled: () => false,
  })).rejects.toThrow(stage)
  expect(release).toHaveBeenCalledOnce()
})

it.each(['before', 'drafts', 'save', 'stop'] as const)('cancels preparation at %s without releasing an install', async (stage) => {
  let cancelled = stage === 'before'
  const visited: string[] = []
  const run = async (name: string) => { visited.push(name); if (stage === name) cancelled = true }
  const release = vi.fn()
  await expect(prepareDesktopUpdate({
    saveDrafts: () => run('drafts'), releaseDrafts: release, saveHost: () => run('save'),
    closeAccount: () => run('account'), stopHost: () => run('stop'), cancelled: () => cancelled,
  })).rejects.toThrow('cancelled')
  if (stage === 'before') expect(visited).toEqual([])
  if (stage === 'save') expect(visited).toEqual(['drafts', 'save'])
  expect(release).toHaveBeenCalledOnce()
})

it('rejects invalid deadlines and synchronous IPC send failure', async () => {
  const { child, send } = childFixture()
  for (const timeoutMs of [0, -1, 0.5, 2_147_483_648, NaN]) {
    await expect(requestUpdateSave({ child, timeoutMs })).rejects.toThrow('timeout')
  }
  expect(send).not.toHaveBeenCalled()
  send.mockImplementation(() => { throw new Error('send failed') })
  await expect(requestUpdateSave({ child, timeoutMs: 1_000 })).rejects.toThrow('send failed')
  expect(child.listenerCount('message')).toBe(0)
})
