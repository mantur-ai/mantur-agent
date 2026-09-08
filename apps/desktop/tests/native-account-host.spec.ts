/** Real Main/Node IPC and streaming transport; OS services and the remote API server are test-owned substitutes. */
import { access, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { NativeAccountStore } from '../src/auth/store.ts'
import { hostFixture } from './native-account-host-support.ts'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  if (process.platform !== 'win32') return actual
  const { EventEmitter } = await import('node:events')
  return { ...actual, execFile: ((...args: Parameters<typeof actual.execFile>) => {
    const callback = args.at(-1)
    if (typeof callback !== 'function') throw new Error('Expected Windows ACL completion callback')
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) })
    queueMicrotask(() => {
      callback(null, '', '')
      child.emit('close', 0, null)
    })
    return child
  }) as unknown as typeof actual.execFile }
})

describe('native account Main and dsh IPC', () => {
  it('reports blocked authority to the dsh child when saving logout fails', async () => {
    const b = await hostFixture((_request, response) => { response.end('unexpected') })
    await b.login()
    const write = vi.spyOn(NativeAccountStore.prototype, 'disable').mockImplementationOnce(() => { throw new Error('Isolated write failure') })
    onTestFinished(() => { write.mockRestore() })
    expect(() => b.controller.signOut()).toThrow('logout-storage')
    expect(await b.send('status').result).toMatchObject({
      ok: true, result: { authenticated: false, phase: 'failed', failure: { kind: 'logout-storage' } },
    })
    expect(await b.send('read', { path: '/api/v1/me' }).result).toMatchObject({ ok: true, result: { signedOut: true } })
    expect(b.backend.observed).toEqual([])
  })

  it('keeps explicitly skipped local commands managed and unsigned instead of consulting standalone credentials', async () => {
    const b = await hostFixture((_request, response) => { response.end('unexpected') })
    await b.controller.skip()
    const command = b.send('prepare')
    expect(await command.result).toMatchObject({ ok: true, result: { environment: { MANTURHUB_IDENTITY_MODE: 'desktop-managed' } } })
    expect(await readdir(b.root)).toEqual(['native-account'])
    expect(await b.send('read', { path: '/api/v1/me' }).result).toMatchObject({ ok: true, result: { signedOut: true } })
    await b.release(command.id)
    expect(b.backend.observed).toEqual([])
  })

  it('holds the real private descriptor until the consumer acknowledges command-tree cleanup', async () => {
    const b = await hostFixture((_request, response) => { response.end('ok') })
    await b.login()
    const command = b.send('prepare')
    const prepared = await command.result
    expect(prepared.ok, JSON.stringify({ prepared, nativeTimings: b.nativeTimings })).toBe(true)
    const result = z.object({ result: z.object({ environment: z.strictObject({
      MANTURHUB_IDENTITY_MODE: z.literal('desktop-managed'), MANTURHUB_AGENT_AUTH: z.string(),
    }) }) }).parse(prepared)
    const descriptor = result.result.environment.MANTURHUB_AGENT_AUTH
    await access(descriptor)
    expect(JSON.stringify(result)).not.toContain(b.backend.bearer())
    const closing = b.send('close')
    let done = false
    void closing.result.then(() => { done = true })
    await command.stopped
    // The child replies after its close handler has issued every immediate IPC operation.
    expect((await b.send('status').result).ok).toBe(false)
    expect(b.nativeRequests).not.toContain('mantur:account:close-scope')
    expect(done).toBe(false)
    await access(descriptor)
    await b.release(command.id)
    expect(await closing.result).toMatchObject({ ok: true })
    await expect(access(descriptor)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains Main-only bearer authentication through a complete response and removes the per-request descriptor', async () => {
    const b = await hostFixture((_request, response) => { response.end('authenticated body') })
    await b.login()
    expect(await b.send('read', { path: '/api/v1/me' }).result).toMatchObject({
      ok: true, result: { status: 200, body: 'authenticated body' },
    })
    expect(b.backend.observed).toEqual([{ path: '/api/v1/me', authorization: `Bearer ${String(b.backend.bearer())}`,
      apiKey: undefined, client: 'cli' }])
    expect(await readdir(b.root)).toEqual(['native-account'])
  })

  it('closes an unread stream on logout and still waits for a separate command cleanup receipt', async () => {
    const upstreamClosed = Promise.withResolvers<undefined>()
    const b = await hostFixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.write('first chunk')
      response.on('close', () => { upstreamClosed.resolve(undefined) })
    })
    await b.login()
    const command = b.send('prepare')
    expect((await command.result).ok).toBe(true)
    expect(await b.send('stream', { path: '/api/v1/download' }).result).toMatchObject({ ok: true, result: { body: 'first chunk' } })
    let done = false
    const logout = b.controller.signOut().then(() => { done = true })
    await command.stopped
    await upstreamClosed.promise
    expect(done).toBe(false)
    await b.release(command.id)
    await logout
    expect(await readdir(b.root)).toEqual(['native-account'])
    expect((await b.send('status').result).ok).toBe(true)
  })

  it('rejects off-origin and encoded traversal paths before a broker scope or upstream request exists', async () => {
    const b = await hostFixture((_request, response) => { response.end('unexpected') })
    await b.login()
    for (const path of ['https://other.invalid/api/v1/me', '//other.invalid/api/v1/me', '/api/v1/../me', '/api/v1/%2e%2e/me', '/api/v1/x%2fy']) {
      expect(await b.send('read', { path }).result).toMatchObject({ ok: false })
    }
    expect(b.backend.observed).toEqual([])
    expect(await readdir(b.root)).toEqual(['native-account'])
  })

  it('retains failed descriptor cleanup as failure across repeated receipts and Main shutdown', async () => {
    const b = await hostFixture((_request, response) => { response.end('ok') }, true)
    await b.login()
    const command = b.send('prepare')
    const result = z.object({ result: z.object({ environment: z.object({ MANTURHUB_AGENT_AUTH: z.string() }) }) })
      .parse(await command.result)
    await rename(result.result.environment.MANTURHUB_AGENT_AUTH, join(b.root, 'retained-test-descriptor.json'))
    await b.release(command.id)
    expect((await b.send('close').result).ok).toBe(false)
    await expect(b.host.close()).rejects.toThrow('descriptor cleanup')
    await access(join(b.root, 'retained-test-descriptor.json'))
  })
})
