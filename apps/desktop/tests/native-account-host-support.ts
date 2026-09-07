/** Real Main/child fixture shared by transport and command-consumer acceptance. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, onTestFinished, TestRunner } from 'vitest'
import { z } from 'zod'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { NativeAccountHost } from '../src/auth/host.ts'
import type { NativeAccountController } from '../src/auth/controller.ts'
import { nativeBrokerBench } from './native-account-broker-support.ts'
import { nativeTestCipher } from './native-account-test-support.ts'

const replySchema = z.strictObject({ type: z.literal('fixture:reply'), id: z.string(), ok: z.boolean(), result: z.unknown().optional(),
  failure: z.enum(['parent-timeout', 'operation-failed']).optional() })

/**
 * Close Main even when the fixture consumer's cleanup assertion fails.
 * @param drain - Release fixture commands and close the child-side connection.
 * @param close - Close Main's broker and account store after draining settles.
 * @returns Completion, or all cleanup failures without treating rejection as a receipt.
 */
export async function finishNativeHostFixture(drain: () => Promise<void>, close: () => Promise<void>): Promise<void> {
  const failures: unknown[] = []
  try { await drain() } catch (error) { failures.push(error) }
  try { await close() } catch (error) { failures.push(error) }
  if (failures.length > 0) throw new AggregateError(failures, 'Native Host fixture cleanup failed')
}

/** Shared real Main/child fixture; commands selects the real Loader and shell consumer composition. */
export async function hostFixture(
  api: (request: IncomingMessage, response: ServerResponse) => void, expectCleanupFailure = false, commands = false,
) {
  const test = TestRunner.getCurrentTest()
  if (test === undefined || test.timeout <= 0) throw new Error('Native IPC fixture requires a bounded test timeout')
  const backend = await nativeBrokerBench(api)
  const root = await mkdtemp(join(tmpdir(), 'mantur-native-host-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const entry = fileURLToPath(new URL('./fixtures/native-account-command-child.ts', import.meta.url))
  const launch = commands ? resolveExampleLaunch({ srcBin: entry, libBin: entry,
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
    configArgs: [fileURLToPath(new URL('./fixtures/native-account-commands.cordis.yml', import.meta.url))],
  }) : { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/native-account-child.ts', import.meta.url))], env: {} }
  const child = spawn(launch.command, launch.args, {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    cwd: root, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...launch.env },
  })
  const closed = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
  onTestFinished(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed })
  const ready = Promise.withResolvers<undefined>()
  const stopped = new Map<string, PromiseWithResolvers<undefined>>()
  const requests = new Map<string, PromiseWithResolvers<z.infer<typeof replySchema>>>()
  const nativeRequests: string[] = []
  const nativeRequestTimeouts: number[] = []
  const nativeTimings: Array<{ type: string; id: string; at: number; ok?: boolean }> = []
  let diagnostics = ''
  child.stderr!.on('data', (bytes: Buffer) => { diagnostics += bytes.toString() })
  child.on('message', (value: unknown) => {
    if (typeof value !== 'object' || value === null) return
    if ('type' in value && typeof value.type === 'string' && value.type.startsWith('mantur:account:')) nativeRequests.push(value.type)
    if ('type' in value && value.type === 'mantur:account:configure') {
      const configuration = z.object({ config: z.object({ requestTimeoutMs: z.number() }) }).parse(value)
      nativeRequestTimeouts.push(configuration.config.requestTimeoutMs)
    }
    if ('type' in value && typeof value.type === 'string' && value.type.startsWith('mantur:account:')
      && 'id' in value && typeof value.id === 'string') nativeTimings.push({ type: value.type, id: value.id, at: Date.now() })
    if ('type' in value && value.type === 'fixture:ipc-reply' && 'id' in value && typeof value.id === 'string'
      && 'at' in value && typeof value.at === 'number' && 'ok' in value && typeof value.ok === 'boolean') {
      nativeTimings.push({ type: 'mantur:account:reply', id: value.id, at: value.at, ok: value.ok })
    }
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
    expect(reply.ok, JSON.stringify({ failure: reply.failure, nativeTimings })).toBe(!expectCleanupFailure)
    active.delete(scope)
  }
  onTestFinished(() => finishNativeHostFixture(async () => {
    if (child.connected) {
      for (const scope of active) await release(scope)
      expect((await send('close').result).ok).toBe(!expectCleanupFailure)
    }
  }, async () => {
    if (expectCleanupFailure) await expect(host.close()).rejects.toThrow('descriptor cleanup')
    else await host.close()
  }))
  await ready.promise
  expect((await send('init', { config: { origin: backend.origin, environment: 'test', environmentLabel: 'Isolated',
    requestTimeoutMs: test.timeout, maxResponseBytes: 16_384, leaseMs: 60_000, revocationRetryMs: 60_000 } }).result).ok).toBe(true)
  const controller = await configured.promise
  const login = (): Promise<void> => controller.password({ email: 'broker@example.com', password: backend.password, consent: true })
  return { backend, root, child, controller, host, send, release, login, nativeRequests, nativeTimings, nativeRequestTimeouts }
}
