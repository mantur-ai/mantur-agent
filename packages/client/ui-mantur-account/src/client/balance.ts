/** Fresh account balance observation; account changes invalidate every pending result. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ManturBalanceStatus } from '@deepseek-ai/dsh-authorization-manturhub/types'
import type { NativeAccountViewState } from './native-account.ts'

/** Display state never substitutes zero or a previous account's balance for a failed read. */
export type AccountBalanceState = { readonly phase: 'loading' | 'signed-out' | 'failed' }
  | { readonly phase: 'ready' | 'refreshing'; readonly balance: number }

type BalanceReply = { ok: true; value: ManturBalanceStatus } | { ok: false }

/** One native account observer shared by expanded and collapsed sidebar views. */
export class AccountBalanceClient {
  /** Current balance display state. */
  readonly store = createSnapshotStore<AccountBalanceState>({ phase: 'loading' })
  private accountKey: string | null | undefined
  private sequence = 0
  private pending = false
  private disposed = false

  /** @param read - Secret-free Host balance request. @param intervalMs - Host-validated polling cadence. */
  constructor(private readonly read: () => Promise<BalanceReply>, private readonly intervalMs: number) {}

  /**
   * Observe account changes and refresh while the page is visible.
   * @param account - Main's current account metadata.
   * @returns listener and timer cleanup, invalidating pending replies.
   */
  connect(account: SnapshotStore<NativeAccountViewState>): () => void {
    const changed = () => {
      const state = account.getSnapshot()
      const key = state.snapshot === undefined ? undefined : state.snapshot.authenticated
        ? JSON.stringify(state.snapshot.account) : null
      if (key === this.accountKey) {
        if (key === undefined && state.failure !== undefined) this.store.set({ phase: 'failed' })
        return
      }
      this.accountKey = key
      ++this.sequence
      this.pending = false
      this.store.set({ phase: key === null ? 'signed-out' : 'loading' })
      if (key !== undefined && key !== null) void this.refresh()
    }
    const off = account.subscribe(changed)
    const refresh = () => { if (document.visibilityState !== 'hidden') void this.refresh() }
    const timer = window.setInterval(refresh, this.intervalMs)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    changed()
    return () => {
      this.disposed = true
      ++this.sequence
      off()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }

  /** Read automatically while visible and on focus or reconnection; concurrent triggers share one request. */
  async refresh(): Promise<void> {
    if (this.disposed || this.pending || this.accountKey == null) return
    this.pending = true
    const sequence = ++this.sequence
    const previous = this.store.getSnapshot()
    this.store.set(previous.phase === 'ready' ? { phase: 'refreshing', balance: previous.balance } : { phase: 'loading' })
    try {
      const result = await this.read()
      if (sequence !== this.sequence) return
      this.store.set(!result.ok ? { phase: 'failed' } : result.value.status === 'signed-out'
        ? { phase: 'signed-out' } : { phase: 'ready', balance: result.value.balance })
    } catch {
      // Transport details are not product copy; the sidebar exposes a retryable failure.
      if (sequence === this.sequence) this.store.set({ phase: 'failed' })
    } finally {
      if (sequence === this.sequence) this.pending = false
    }
  }
}
