/** Offline homepage catalog and version-preserving input references. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ManturBundledSkill } from '@deepseek-ai/dsh-manturhub-marketplace/types'

/** Local resource discovery is independent of marketplace login and installation state. */
export type BundledSkillsState =
  | { readonly phase: 'idle' | 'loading' | 'failed' }
  | { readonly phase: 'ready'; readonly skills: readonly ManturBundledSkill[] }

/** Own one cancellable local discovery request for the mounted navigation plugin. */
export class BundledSkills {
  /** Observable catalog discovery state for the mounted homepage. */
  readonly store = createSnapshotStore<BundledSkillsState>({ phase: 'idle' })
  private pending: AbortController | undefined
  private disposed = false

  /** @param read - local Host catalog reader; this operation must not consult the online marketplace. */
  constructor(private readonly read: (signal: AbortSignal) => Promise<readonly ManturBundledSkill[]>) {}

  /**
   * Discover local skills and publish their loading result.
   * @returns After publication, or immediately when a read is active or the owner is disposed.
   */
  async load(): Promise<void> {
    if (this.disposed || this.pending !== undefined) return
    const request = new AbortController()
    this.pending = request
    this.store.set({ phase: 'loading' })
    try {
      const skills = await this.read(request.signal)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Disposal can run while the catalog read is awaited.
      if (!this.disposed) this.store.set({ phase: 'ready', skills })
    } catch {
      // The UI exposes a retryable discovery error; teardown does not publish late state.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Disposal can run while the catalog read is awaited.
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

/**
 * Format an offline Skill reference in the Host's invocation syntax.
 * @param reference - Exact resource identity, including version and digest.
 * @returns Locale-independent clipboard and submission text.
 */
export function bundledSkillClipboard(reference: string): string {
  return `/mantur-builtin:${reference}`
}
