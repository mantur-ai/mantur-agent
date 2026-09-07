/** Renderer account state; Main owns authorization, persistence and every credentialed operation. */
import { z } from 'zod'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  NativeAccountAction, NativeAccountBridge, NativeAccountProblem, NativeAccountPublication,
  NativeAccountReply, NativeAccountSnapshot,
} from '@deepseek-ai/dsh-authorization-manturhub/types'

const problem = z.strictObject({ kind: z.string().max(100), code: z.string().max(100).optional(),
  retryAfterMs: z.number().int().nonnegative().optional() })
const timestamp = z.number().refine(value => !Number.isNaN(new Date(value).getTime()))
const snapshot = z.strictObject({
  phase: z.enum(['idle', 'signed-out', 'authorizing', 'signed-in', 'pending-activation', 'link-required', 'failed']),
  busy: z.boolean(), authenticated: z.boolean(), skipped: z.boolean(), pendingRevocations: z.number().int().nonnegative(),
  account: z.strictObject({ email: z.email(), expiresAt: timestamp }).optional(),
  attempt: z.strictObject({ userCode: z.string(), verificationUrl: z.url(), expiresAt: timestamp }).optional(),
  failure: problem.optional(),
}).refine(value => !value.authenticated || value.account !== undefined) satisfies z.ZodType<NativeAccountSnapshot>
const publication = z.strictObject({ revision: z.number().int().nonnegative(), snapshot }) satisfies z.ZodType<NativeAccountPublication>
const reply = z.strictObject({ ok: z.boolean(), revision: z.number().int().nonnegative(), snapshot: snapshot.optional(),
  failure: problem.optional(), codeExpirySeconds: z.number().int().positive().optional() }) satisfies z.ZodType<NativeAccountReply>

declare global {
  interface Window { manturAccount?: NativeAccountBridge }
}

/** Secret-free render data; submitted form values are never copied into this store. */
export interface NativeAccountViewState {
  readonly snapshot?: NativeAccountSnapshot | undefined
  readonly operation?: NativeAccountAction['kind'] | undefined
  readonly failure?: NativeAccountProblem | undefined
  readonly online: boolean
}

/** A form may clear its transient inputs after success without retaining the original request. */
export interface NativeAccountOutcome {
  readonly ok: boolean
  readonly codeExpirySeconds?: number
}

/** Own the preload listener, one UI operation and the protocol's two-second poll schedule. */
export class NativeAccountClient {
  /** Latest accepted Main metadata and local IPC status. */
  readonly store = createSnapshotStore<NativeAccountViewState>({ online: navigator.onLine })
  private revision = -1
  private sequence = 0
  private disposed = false
  private timer: number | undefined

  /** @param bridge - Explicit desktop capability; absence is an error, never a request to use legacy credentials. */
  constructor(private readonly bridge: NativeAccountBridge | undefined) {}

  /**
   * Subscribe before requesting state, so a late initial reply cannot replace a newer event.
   * @returns listener and timer cleanup; Main retains ownership across a renderer reload.
   */
  connect(): () => void {
    const unsubscribe = this.bridge?.subscribe((value) => {
      const parsed = publication.safeParse(value)
      if (!parsed.success) { this.fail({ kind: 'protocol' }); return }
      this.accept(parsed.data)
    })
    const online = () => {
      this.store.set({ ...this.store.getSnapshot(), online: navigator.onLine })
      const state = this.store.getSnapshot()
      if (state.online && state.snapshot !== undefined && state.snapshot.pendingRevocations > 0
        && state.operation === undefined && !state.snapshot.busy) void this.run({ kind: 'retry-revocations' })
    }
    window.addEventListener('online', online)
    window.addEventListener('offline', online)
    void this.run({ kind: 'refresh' })
    return () => {
      this.disposed = true
      ++this.sequence
      this.clearTimer()
      unsubscribe?.()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', online)
    }
  }

  /**
   * Submit one explicit action. Skip and cancellation supersede a pending form request.
   * @param action - Fixed Main operation; never retained in the observable state.
   * @returns success and, only for a successful code request, its server-confirmed lifetime.
   */
  async run(action: NativeAccountAction): Promise<NativeAccountOutcome> {
    if (this.disposed) return { ok: false }
    const before = this.store.getSnapshot()
    const cancelling = action.kind === 'skip' || action.kind === 'sign-out'
    if ((before.operation !== undefined || before.snapshot?.busy === true) && !cancelling) return { ok: false }
    if (this.bridge === undefined) { this.fail({ kind: 'unavailable' }); return { ok: false } }
    const sequence = ++this.sequence
    this.clearTimer()
    this.store.set({ ...before, operation: action.kind, failure: undefined })
    try {
      const parsed = reply.safeParse(await this.bridge.invoke(action))
      if (sequence !== this.sequence) return { ok: false }
      if (!parsed.success || (parsed.data.ok && parsed.data.snapshot === undefined)) {
        this.fail({ kind: 'protocol' })
        return { ok: false }
      }
      const result = parsed.data
      if (result.snapshot !== undefined) this.accept({ revision: result.revision, snapshot: result.snapshot })
      if (!result.ok) {
        this.fail(result.snapshot?.failure ?? result.failure ?? { kind: 'protocol' })
        return { ok: false }
      }
      return { ok: true, ...(result.codeExpirySeconds === undefined ? {} : { codeExpirySeconds: result.codeExpirySeconds }) }
    } catch {
      // IPC rejection details may contain internal paths; only the fixed classification reaches the view.
      if (sequence === this.sequence) this.fail({ kind: 'transport' })
      return { ok: false }
    } finally {
      if (sequence === this.sequence) {
        this.store.set({ ...this.store.getSnapshot(), operation: undefined })
        this.schedulePoll()
      }
    }
  }

  private accept(value: NativeAccountPublication): void {
    if (this.disposed || value.revision <= this.revision) return
    this.revision = value.revision
    this.store.set({ ...this.store.getSnapshot(), snapshot: value.snapshot, failure: value.snapshot.failure })
    if (this.store.getSnapshot().operation === undefined) { this.clearTimer(); this.schedulePoll() }
  }

  private fail(failure: NativeAccountProblem): void {
    if (!this.disposed) { this.clearTimer(); this.store.set({ ...this.store.getSnapshot(), failure }) }
  }

  private schedulePoll(): void {
    const state = this.store.getSnapshot()
    const current = state.snapshot
    if (state.failure !== undefined || current?.busy === true || current?.attempt === undefined
      || (current.phase !== 'authorizing' && current.phase !== 'link-required')) return
    if (current.attempt.expiresAt <= Date.now()) { this.fail({ kind: 'expired' }); return }
    this.timer = window.setTimeout(() => { this.timer = undefined; void this.run({ kind: 'poll' }) }, 2_000)
  }

  private clearTimer(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer)
    this.timer = undefined
  }
}
