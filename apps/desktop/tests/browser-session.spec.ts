/** Desktop restarts remove port-specific connection cookies without erasing other browser data. */
import type { Cookie } from 'electron'
import { expect, it, vi } from 'vitest'
import { clearDesktopConnectionCookies } from '../src/browser-session.ts'

const cookie = (suffix: string, overrides: Partial<Cookie> = {}): Cookie => ({
  name: `dsh-auth-${suffix.repeat(43)}`, value: 'old-connection', domain: '127.0.0.1', path: '/',
  secure: false, httpOnly: true, session: false, sameSite: 'strict', ...overrides,
})

it('retires accumulated local Host cookies and preserves unrelated cookies', async () => {
  const owned = Array.from({ length: 61 }, (_, i) => cookie('A', { name: `dsh-auth-${String(i).padStart(43, 'A')}` }))
  const store = { get: vi.fn(async () => [...owned, cookie('B', { domain: 'hub.mantur.ai' }),
    cookie('C', { name: 'other-app' }), cookie('D', { path: '/other-app' }), cookie('E', { name: 'dsh-auth-not-a-hash' })]),
  remove: vi.fn(async () => {}) }
  await expect(clearDesktopConnectionCookies(store)).resolves.toBe(61)
  expect(store.get).toHaveBeenCalledExactlyOnceWith({ domain: '127.0.0.1' })
  expect(store.remove.mock.calls).toEqual(owned.map(entry => ['http://127.0.0.1/', entry.name]))
})

it('waits for every removal and exposes failures instead of continuing with oversized headers', async () => {
  const pending = Promise.withResolvers<undefined>()
  const store = { get: vi.fn(async () => [cookie('A')]), remove: vi.fn(() => pending.promise) }
  const settled = vi.fn()
  const result = clearDesktopConnectionCookies(store).then(settled)
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  pending.resolve(undefined)
  await result
  expect(settled).toHaveBeenCalledWith(1)
  store.remove.mockRejectedValueOnce(new Error('cookie store unavailable'))
  await expect(clearDesktopConnectionCookies(store)).rejects.toThrow('cookie store unavailable')
})
