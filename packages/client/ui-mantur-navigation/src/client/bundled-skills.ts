/** Offline homepage catalog and version-preserving input references. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ManturBundledSkill } from '@deepseek-ai/dsh-manturhub-marketplace/types'

/** Local resource discovery is independent of marketplace login and installation state. */
export type BundledSkillsState =
  | { readonly phase: 'idle' | 'loading' | 'failed' }
  | { readonly phase: 'ready'; readonly skills: readonly ManturBundledSkill[] }

/** Own one cancellable local discovery request for the mounted navigation plugin. */
export class BundledSkills {
  readonly store = createSnapshotStore<BundledSkillsState>({ phase: 'idle' })
  private pending: AbortController | undefined
  private disposed = false

  /** @param read - local Host catalog reader; this operation must not consult the online marketplace. */
  constructor(private readonly read: (signal: AbortSignal) => Promise<readonly ManturBundledSkill[]>) {}

  /** @returns after publication, or immediately when a read is already active or the owner is disposed. */
  async load(): Promise<void> {
    if (this.disposed || this.pending !== undefined) return
    const request = new AbortController()
    this.pending = request
    this.store.set({ phase: 'loading' })
    try {
      const skills = await this.read(request.signal)
      if (!this.disposed) this.store.set({ phase: 'ready', skills })
    } catch {
      // The UI exposes a retryable discovery error; teardown does not publish late state.
      if (!this.disposed) this.store.set({ phase: 'failed' })
    } finally {
      this.pending = undefined
    }
  }

  /** Cancel the owned read and prevent late responses from updating an unmounted plugin. */
  dispose(): void {
    this.disposed = true
    this.pending?.abort()
  }
}
