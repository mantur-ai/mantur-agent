/** Erasable-TS IPC fixture exercising the actual dsh-side native connection, without Cordis or external accounts. */
import { z } from 'zod'
import { NativeAccountConnection, type NativeCommandLease } from '../../../../packages/credentials/authorization-manturhub/src/native.ts'

const inputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('init'), id: z.string(), config: z.strictObject({
    origin: z.url(), environment: z.enum(['production', 'test']), environmentLabel: z.string(),
    requestTimeoutMs: z.number(), maxResponseBytes: z.number(), leaseMs: z.number(), revocationRetryMs: z.number(),
  }) }),
  z.strictObject({ kind: z.literal('status'), id: z.string() }),
  z.strictObject({ kind: z.literal('prepare'), id: z.string() }),
  z.strictObject({ kind: z.literal('close'), id: z.string() }),
  z.strictObject({ kind: z.literal('release'), id: z.string(), scope: z.string() }),
  z.strictObject({ kind: z.enum(['read', 'stream']), id: z.string(), path: z.string() }),
])
let connection: NativeAccountConnection | undefined
const leases = new Map<string, NativeCommandLease>()
const streams = new Set<ReadableStreamDefaultReader<Uint8Array>>()

async function run(input: z.infer<typeof inputSchema>): Promise<unknown> {
  if (input.kind === 'init') {
    connection = new NativeAccountConnection(input.config)
    return await connection.status()
  }
  if (connection === undefined) throw new Error('Fixture is not initialized')
  if (input.kind === 'close') { await connection.close(); return {} }
  if (input.kind === 'status') return await connection.status()
  if (input.kind === 'prepare') {
    const lease = await connection.prepare(new AbortController().signal)
    leases.set(input.id, lease)
    const stopped = (): void => { process.send?.({ type: 'fixture:stopped', scope: input.id }) }
    lease.signal.addEventListener('abort', stopped, { once: true })
    if (lease.signal.aborted) stopped()
    return { environment: lease.environment }
  }
  if (input.kind === 'release') {
    const lease = leases.get(input.scope)
    if (lease === undefined) throw new Error('Unknown fixture lease')
    await lease.release()
    leases.delete(input.scope)
    return {}
  }
  const response = await connection.requestApi(input.path, undefined, new AbortController().signal)
  if (response === undefined) return { signedOut: true }
  if (input.kind === 'read') return { status: response.status, body: await response.text() }
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('Expected streaming response')
  streams.add(reader)
  const first = await reader.read()
  void reader.closed.catch(() => {}).finally(() => { streams.delete(reader); reader.releaseLock() })
  return { status: response.status, body: new TextDecoder().decode(first.value) }
}

process.on('message', (value) => {
  const parsed = inputSchema.safeParse(value)
  if (!parsed.success) return
  void run(parsed.data).then(
    (result) => { process.send?.({ type: 'fixture:reply', id: parsed.data.id, ok: true, result }) },
    () => { process.send?.({ type: 'fixture:reply', id: parsed.data.id, ok: false }) },
  )
})
process.send?.({ type: 'fixture:ready' })
