// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { AccountBalanceClient } from '../src/client/balance.ts'
import type { NativeAccountViewState } from '../src/client/native-account.ts'

function account(name = 'Artist'): NativeAccountViewState {
  return { online: true, snapshot: { phase: 'signed-in', busy: false, authenticated: true,
    skipped: false, pendingRevocations: 0, account: { displayName: name, expiresAt: 1_999_999_999_999 } } }
}

describe('sidebar Mantou balance', () => {
  it('reads a genuine zero, coalesces refreshes and refreshes after focus', async () => {
    const source = createSnapshotStore(account())
    const read = vi.fn(async () => ({ ok: true as const, value: { status: 'available' as const, balance: 0 } }))
    const client = new AccountBalanceClient(read, 5000)
    const stop = client.connect(source)
    try {
      await client.refresh()
      expect(read).toHaveBeenCalledTimes(1)
      expect(client.store.getSnapshot()).toEqual({ phase: 'ready', balance: 0 })
      window.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(2) })
      expect(client.store.getSnapshot()).toEqual({ phase: 'ready', balance: 0 })
    } finally { stop() }
    window.dispatchEvent(new Event('focus'))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('removes the old balance during a failed refresh and recovers explicitly', async () => {
    const source = createSnapshotStore(account())
    const read = vi.fn(async (): Promise<{ ok: true; value: { status: 'available'; balance: number } } | { ok: false }> =>
      ({ ok: true, value: { status: 'available', balance: 123.45 } }))
    const client = new AccountBalanceClient(read, 5000)
    const stop = client.connect(source)
    try {
      await vi.waitFor(() => { expect(client.store.getSnapshot().phase).toBe('ready') })
      read.mockResolvedValueOnce({ ok: false })
      await client.refresh()
      expect(client.store.getSnapshot()).toEqual({ phase: 'failed' })
      read.mockRejectedValueOnce(new Error('secret upstream diagnostic'))
      await client.refresh()
      expect(client.store.getSnapshot()).toEqual({ phase: 'failed' })
      await client.refresh()
      expect(client.store.getSnapshot()).toEqual({ phase: 'ready', balance: 123.45 })
    } finally { stop() }
  })

  it('discards pending results after logout, account replacement and disposal', async () => {
    const pending = Promise.withResolvers<{ ok: true; value: { status: 'available'; balance: number } }>()
    const source = createSnapshotStore(account())
    const read = vi.fn().mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ ok: true, value: { status: 'available', balance: 7 } })
    const client = new AccountBalanceClient(read, 5000)
    const stop = client.connect(source)
    source.set({ online: true, snapshot: { phase: 'signed-out', busy: false, authenticated: false, skipped: true, pendingRevocations: 0 } })
    expect(client.store.getSnapshot()).toEqual({ phase: 'signed-out' })
    await client.refresh()
    expect(read).toHaveBeenCalledTimes(1)
    source.set(account('Another artist'))
    await vi.waitFor(() => { expect(client.store.getSnapshot()).toEqual({ phase: 'ready', balance: 7 }) })
    stop()
    pending.resolve({ ok: true, value: { status: 'available', balance: 999 } })
    await pending.promise
    expect(client.store.getSnapshot()).toEqual({ phase: 'ready', balance: 7 })
  })

  it('reports unavailable identity without requesting another account', () => {
    const source = createSnapshotStore<NativeAccountViewState>({ online: true, failure: { kind: 'unavailable' } })
    const read = vi.fn()
    const client = new AccountBalanceClient(read, 5000)
    const stop = client.connect(source)
    expect(client.store.getSnapshot()).toEqual({ phase: 'failed' })
    expect(read).not.toHaveBeenCalled()
    stop()
  })
})

it('automatically updates and recovers, pauses when hidden, and clears the timer on disposal', async () => {
  vi.useFakeTimers()
  const source = createSnapshotStore(account())
  const read = vi.fn().mockResolvedValue({ ok: true, value: { status: 'available', balance: 10 } })
  const client = new AccountBalanceClient(read, 5000)
  const stop = client.connect(source)
  try {
    await vi.advanceTimersByTimeAsync(0)
    read.mockResolvedValueOnce({ ok: true, value: { status: 'available', balance: 9 } })
    await vi.advanceTimersByTimeAsync(5000)
    expect(client.store.getSnapshot()).toEqual({ phase: 'ready', balance: 9 })
    read.mockResolvedValueOnce({ ok: false })
    await vi.advanceTimersByTimeAsync(5000)
    expect(client.store.getSnapshot()).toEqual({ phase: 'failed' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(client.store.getSnapshot()).toEqual({ phase: 'ready', balance: 10 })
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await vi.advanceTimersByTimeAsync(10000)
    expect(read).toHaveBeenCalledTimes(4)
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(5)
    stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(read).toHaveBeenCalledTimes(5)
    expect(vi.getTimerCount()).toBe(0)
  } finally { stop(); vi.restoreAllMocks(); vi.useRealTimers() }
})

it('keeps the confirmed number marked as refreshing without overlapping timer requests', async () => {
  vi.useFakeTimers()
  const pending = Promise.withResolvers<{ ok: true; value: { status: 'available'; balance: number } }>()
  const read = vi.fn().mockResolvedValueOnce({ ok: true, value: { status: 'available', balance: 20 } })
    .mockReturnValue(pending.promise)
  const client = new AccountBalanceClient(read, 5000)
  const stop = client.connect(createSnapshotStore(account()))
  try {
    await vi.advanceTimersByTimeAsync(15000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(client.store.getSnapshot()).toEqual({ phase: 'refreshing', balance: 20 })
    pending.resolve({ ok: true, value: { status: 'available', balance: 19 } })
    await vi.advanceTimersByTimeAsync(0)
    expect(client.store.getSnapshot()).toEqual({ phase: 'ready', balance: 19 })
  } finally { stop(); vi.useRealTimers() }
})


it('clears balance when the Host reports logout and ignores an old account transport failure', async () => {
  const old = Promise.withResolvers<{ ok: true; value: { status: 'signed-out' } }>()
  const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ ok: true, value: { status: 'signed-out' } })
  const source = createSnapshotStore(account('Old'))
  const client = new AccountBalanceClient(read, 5000)
  const stop = client.connect(source)
  try {
    source.set(account('New'))
    await vi.waitFor(() => { expect(client.store.getSnapshot()).toEqual({ phase: 'signed-out' }) })
    old.reject(new Error('old account request failed'))
    await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(2) })
    expect(client.store.getSnapshot()).toEqual({ phase: 'signed-out' })
  } finally { stop() }
})
