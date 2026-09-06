/** Electron Main account owner and child-process IPC; command release receipts follow real Host-side tree cleanup. */
import type { ChildProcess } from 'node:child_process'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import { NativeCommandBroker } from './broker.ts'
import { NativeAccountController } from './controller.ts'
import { withNativeBrokerDescriptor } from './descriptor.ts'
import { NativeHttpClient } from './http.ts'
import { NativeAccountStore, type NativeCipher } from './store.ts'
import type { NativeSecrets } from './protocol.ts'

type MessageId = Branded<'NativeHostMessageId'>
type ScopeId = Branded<'NativeHostScopeId'>
const messageId = z.uuid().transform(value => value as MessageId)
const scopeId = z.uuid().transform(value => value as ScopeId)
const configSchema = z.strictObject({
  origin: z.url(), environment: z.enum(['production', 'test']), environmentLabel: z.string().min(1).max(80),
  requestTimeoutMs: z.number().int().min(1).max(2_147_483_647), maxResponseBytes: z.number().int().positive(),
  leaseMs: z.number().int().positive(), revocationRetryMs: z.number().int().min(1).max(2_147_483_647),
})
const requestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('mantur:account:configure'), id: messageId, config: configSchema }),
  z.strictObject({ type: z.literal('mantur:account:status'), id: messageId }),
  z.strictObject({ type: z.literal('mantur:account:open-scope'), id: messageId, scopeId }),
  z.strictObject({ type: z.literal('mantur:account:close-scope'), id: messageId, scopeId }),
])

/** Main installation attributes cannot be selected by a renderer or command. */
export interface NativeAccountHostOptions {
  readonly child: ChildProcess
  readonly userData: string
  readonly cipher: NativeCipher
  readonly deviceName: string
  readonly platform: NativeSecrets['platform']
  readonly openBrowser: (url: string) => Promise<void>
  readonly onController: (controller: NativeAccountController | undefined) => void
  readonly onSnapshot: () => void
}

interface Scope {
  readonly abort: AbortController
  readonly release: PromiseWithResolvers<undefined>
  readonly done: Promise<void>
}

/** Owns one configured deployment for one supervised dsh child; a deployment change requires an explicit application restart. */
export class NativeAccountHost {
  private controller: NativeAccountController | undefined
  private store: NativeAccountStore | undefined
  private broker: NativeCommandBroker | undefined
  private configured: z.infer<typeof configSchema> | undefined
  private readonly scopes = new Map<ScopeId, Scope>()
  private readonly failedScopes = new Set<ScopeId>()
  private timer: ReturnType<typeof setInterval> | undefined
  private unsubscribe: (() => void) | undefined
  private closing = false
  private closed: Promise<void> | undefined

  /**
   * @param options - Electron-owned child process, profile storage, OS cipher and browser opener.
   */
  constructor(private readonly options: NativeAccountHostOptions) {
    options.child.on('message', this.receive)
    options.child.on('disconnect', this.disconnected)
  }

  /** Reject new work and wait for every existing command receipt before closing the account store. */
  close(): Promise<void> {
    this.closing = true
    if (this.timer !== undefined) clearInterval(this.timer)
    this.unsubscribe?.()
    this.options.onController(undefined)
    this.closed ??= (async () => {
      const broker = this.broker?.close()
      void broker?.catch(() => { /* close reports failure; an IPC disconnect cannot confirm descendant cleanup. */ })
      // A dead IPC channel cannot attest that orphan descendants have exited.
      if (!this.options.child.connected && this.scopes.size > 0) throw new Error('Native command cleanup cannot be confirmed after Host disconnect')
      await broker
      await this.controller?.close()
      if (this.failedScopes.size > 0) throw new Error('Native command descriptor cleanup failed')
      this.options.child.removeListener('message', this.receive)
      this.options.child.removeListener('disconnect', this.disconnected)
    })()
    return this.closed
  }

  private readonly disconnected = (): void => {
    for (const scope of this.scopes.values()) scope.abort.abort()
  }

  private readonly receive = (input: unknown): void => {
    const request = requestSchema.safeParse(input)
    if (!request.success) return
    void this.dispatch(request.data).catch(() => {
      this.reply(request.data.id, false, { kind: 'unavailable' })
    })
  }

  private reply(id: MessageId, ok: boolean, value: unknown): void {
    if (!this.options.child.connected) return
    this.options.child.send({ type: 'mantur:account:reply', id, ok, value }, () => {
      // The requesting Host owns lost-reply recovery; neither a device secret nor a raw IPC error is logged.
    })
  }

  private async dispatch(request: z.infer<typeof requestSchema>): Promise<void> {
    if (request.type === 'mantur:account:close-scope') {
      if (this.failedScopes.has(request.scopeId)) throw new Error('Native command descriptor cleanup previously failed')
      const scope = this.scopes.get(request.scopeId)
      if (scope === undefined) { this.reply(request.id, true, {}); return }
      scope.abort.abort()
      scope.release.resolve(undefined)
      try { await scope.done }
      catch (error) { if (!(error instanceof Error) || error.name !== 'AbortError') throw error }
      this.reply(request.id, true, {})
      return
    }
    if (this.closing) throw new Error('Native account Host is closing')
    if (request.type === 'mantur:account:configure') {
      this.configure(request.config)
      this.reply(request.id, true, this.controller?.getSnapshot())
      return
    }
    const controller = this.controller
    if (controller === undefined || this.configured === undefined || this.store === undefined) throw new Error('Native account Host is not configured')
    if (request.type === 'mantur:account:status') {
      this.reply(request.id, true, controller.getSnapshot())
      return
    }
    const active = this.store.records(this.configured.origin).find(record => record.phase === 'active')
    if (active === undefined || active.metadata.credential === undefined || active.metadata.credential.expiresAt <= Date.now()) {
      // Skip permits local tools, while managed CLI requests remain denied without a descriptor; no standalone key is read.
      this.reply(request.id, true, { kind: 'signed-out', environment: { MANTURHUB_IDENTITY_MODE: 'desktop-managed' } })
      return
    }
    this.openScope(request.id, request.scopeId)
  }

  private configure(config: z.infer<typeof configSchema>): void {
    if (this.configured !== undefined) {
      if (JSON.stringify(this.configured) !== JSON.stringify(config)) throw new Error('Changing native account deployment requires restart')
      return
    }
    const http = new NativeHttpClient({ origin: config.origin, environment: config.environment,
      timeoutMs: config.requestTimeoutMs, maxResponseBytes: config.maxResponseBytes }, fetch)
    const store = new NativeAccountStore(this.options.userData, this.options.cipher)
    const controller = new NativeAccountController(store, http, {
      environment: config.environment, deviceName: this.options.deviceName, platform: this.options.platform,
      now: Date.now, openBrowser: this.options.openBrowser,
    })
    this.store = store
    this.controller = controller
    this.broker = new NativeCommandBroker(controller, { ...config, origin: http.origin, now: Date.now }, fetch)
    this.configured = { ...config, origin: http.origin }
    this.unsubscribe = controller.subscribe(() => {
      this.options.onSnapshot()
      if (this.options.child.connected) this.options.child.send({ type: 'mantur:account:changed', snapshot: controller.getSnapshot() }, () => {})
    })
    this.options.onController(controller)
    this.options.onSnapshot()
    const retry = (): void => {
      void controller.retryRevocations().catch(() => {
        // The encrypted record remains pending; snapshot pendingRevocations reports unconfirmed remote cleanup.
      })
    }
    retry()
    this.timer = setInterval(retry, config.revocationRetryMs)
    this.timer.unref()
  }

  private openScope(id: MessageId, scopeId: ScopeId): void {
    if (this.scopes.has(scopeId) || this.broker === undefined) throw new Error('Native command scope cannot be admitted')
    const release = Promise.withResolvers<undefined>()
    const abortScope = new AbortController()
    let replied = false
    const done = this.broker.run(abortScope.signal, async (descriptor, lifetime) => {
      await withNativeBrokerDescriptor(this.options.userData, descriptor, lifetime, async (environment) => {
        const abort = (): void => {
          if (this.options.child.connected) this.options.child.send({ type: 'mantur:account:stop-scope', scopeId }, () => {})
        }
        lifetime.addEventListener('abort', abort, { once: true })
        try {
          lifetime.throwIfAborted()
          this.reply(id, true, { kind: 'authorized', environment, descriptor })
          replied = true
          await release.promise
        } finally { lifetime.removeEventListener('abort', abort) }
      })
    })
    this.scopes.set(scopeId, { release, done, abort: abortScope })
    void done.catch((error: unknown) => {
      if (!replied) this.reply(id, false, { kind: 'unavailable' })
      else if (!(error instanceof Error) || error.name !== 'AbortError') this.failedScopes.add(scopeId)
    })
      .finally(() => { this.scopes.delete(scopeId) })
  }
}
