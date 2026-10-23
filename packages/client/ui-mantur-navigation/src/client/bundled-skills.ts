/** Updated homepage catalog and version-preserving input references. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ManturBundledSkillsUpdateResult } from '@deepseek-ai/dsh-manturhub-marketplace/types'

/** Available verified resources and the latest per-skill update outcomes. */
export type BundledSkillsState = ManturBundledSkillsUpdateResult & {
  readonly phase: 'idle' | 'loading' | 'failed' | 'ready'
}

/** Own one cancellable update request for the mounted navigation plugin. */
export class BundledSkills {
  /** Observable catalog discovery state for the mounted homepage. */
  readonly store = createSnapshotStore<BundledSkillsState>({ phase: 'idle', skills: [], updates: [] })
  private pending: AbortController | undefined
  private disposed = false

  /** @param read - Host update operation that checks the active marketplace and verifies immutable resources. */
  constructor(private readonly read: (signal: AbortSignal) => Promise<ManturBundledSkillsUpdateResult>) {}

  /**
   * Check and update recommended skills and publish their loading result.
   * @returns After publication, or immediately when a read is active or the owner is disposed.
   */
  async load(): Promise<void> {
    if (this.disposed || this.pending !== undefined) return
    const request = new AbortController()
    this.pending = request
    const previous = this.store.getSnapshot()
    this.store.set({ ...previous, phase: 'loading' })
    try {
      const result = await this.read(request.signal)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Disposal can run while the catalog read is awaited.
      if (!this.disposed) this.store.set({ ...result, phase: 'ready' })
    } catch {
      // The UI exposes a retryable discovery error; teardown does not publish late state.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Disposal can run while the catalog read is awaited.
      if (!this.disposed) this.store.set({ ...previous, phase: 'failed' })
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

/**
 * Format an offline Skill reference in the Host's invocation syntax.
 * @param reference - Exact resource identity, including version and digest.
 * @returns Locale-independent clipboard and submission text.
 */
export function bundledSkillClipboard(reference: string): string {
  return `/mantur-builtin:${reference}`
}
