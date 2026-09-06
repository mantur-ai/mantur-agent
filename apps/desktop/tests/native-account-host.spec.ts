/** Real Main/Node IPC and streaming transport; only the OS cipher and remote API server are test-owned substitutes. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { NativeAccountHost } from '../src/auth/host.ts'
import type { NativeAccountController } from '../src/auth/controller.ts'
import { nativeBrokerBench } from './native-account-broker-support.ts'
import { nativeTestCipher } from './native-account-test-support.ts'

const replySchema = z.strictObject({ type: z.literal('fixture:reply'), id: z.string(), ok: z.boolean(), result: z.unknown().optional() })

async function hostFixture(api: (request: IncomingMessage, response: ServerResponse) => void, expectCleanupFailure = false) {
  const backend = await nativeBrokerBench(api)
  const root = await mkdtemp(join(tmpdir(), 'mantur-native-host-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/native-account-child.ts', import.meta.url))], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  })
  const closed = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
  onTestFinished(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed })
  const ready = Promise.withResolvers<undefined>()
  const stopped = new Map<string, PromiseWithResolvers<undefined>>()
  const requests = new Map<string, PromiseWithResolvers<z.infer<typeof replySchema>>>()
  const nativeRequests: string[] = []
  let diagnostics = ''
  child.stderr!.on('data', (bytes: Buffer) => { diagnostics += bytes.toString() })
  child.on('message', (value: unknown) => {
    if (typeof value !== 'object' || value === null) return
    if ('type' in value && typeof value.type === 'string' && value.type.startsWith('mantur:account:')) nativeRequests.push(value.type)
    if ('type' in value && value.type === 'fixture:ready') ready.resolve(undefined)
    if ('type' in value && value.type === 'fixture:stopped' && 'scope' in value && typeof value.scope === 'string') {
      stopped.get(value.scope)?.resolve(undefined)
    }
    const reply = replySchema.safeParse(value)
    if (!reply.success) return
    requests.get(reply.data.id)?.resolve(reply.data)
    requests.delete(reply.data.id)
  })
  child.on('error', (error) => { ready.reject(error) })
  child.on('exit', () => {
    const error = new Error(`Native IPC fixture exited before reply: ${diagnostics}`)
    ready.reject(error)
    for (const request of requests.values()) request.reject(error)
  })
  const configured = Promise.withResolvers<NativeAccountController>()
  const host = new NativeAccountHost({ child, userData: root, cipher: nativeTestCipher(), deviceName: 'Isolated native Host',
    platform: process.platform === 'win32' ? 'windows' : 'macos', openBrowser: async () => { throw new Error('No browser in this fixture') },
    onController: (controller) => { if (controller !== undefined) configured.resolve(controller) }, onSnapshot: () => {} })
  const active = new Set<string>()
  const send = (kind: string, fields: object = {}) => {
    const id = randomUUID()
    const result = Promise.withResolvers<z.infer<typeof replySchema>>()
    requests.set(id, result)
    const stop = Promise.withResolvers<undefined>()
    if (kind === 'prepare') { stopped.set(id, stop); active.add(id) }
    child.send({ kind, id, ...fields }, (error) => { if (error !== null) result.reject(error) })
    return { id, result: result.promise, stopped: stop.promise }
  }
  const release = async (scope: string): Promise<void> => {
    const reply = await send('release', { scope }).result
    expect(reply.ok).toBe(!expectCleanupFailure)
    active.delete(scope)
  }
  onTestFinished(async () => {
    if (child.connected) {
      for (const scope of active) await release(scope)
      expect((await send('close').result).ok).toBe(!expectCleanupFailure)
    }
    if (expectCleanupFailure) await expect(host.close()).rejects.toThrow('descriptor cleanup')
    else await host.close()
  })
  await ready.promise
  expect((await send('init', { config: { origin: backend.origin, environment: 'test', environmentLabel: 'Isolated',
    requestTimeoutMs: 10_000, maxResponseBytes: 16_384, leaseMs: 60_000, revocationRetryMs: 60_000 } }).result).ok).toBe(true)
  const controller = await configured.promise
  const login = (): Promise<void> => controller.password({ email: 'broker@example.com', password: backend.password, consent: true })
  return { backend, root, child, controller, host, send, release, login, nativeRequests }
}

describe('native account Main and dsh IPC', () => {
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
    const result = z.object({ result: z.object({ environment: z.strictObject({
      MANTURHUB_IDENTITY_MODE: z.literal('desktop-managed'), MANTURHUB_AGENT_AUTH: z.string(),
    }) }) }).parse(await command.result)
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
