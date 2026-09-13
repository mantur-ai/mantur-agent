/** Native-only persistence of complete composer documents, independent of the browser origin. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { DesktopDraftBridge, DraftCheckpoint, DraftDocument, PersistedDraft, PersistedDraftImage } from '../contract/draft-persistence.ts'
import type { SessionInputShell } from './facade.ts'

/** Image registry operations needed to checkpoint and restore already selected files. */
export interface DraftImages {
  capture(ids: DraftDocument['imageIds']): Promise<PersistedDraftImage[]>
  restore(images: PersistedDraftImage[]): Promise<DraftDocument['imageIds']>
}

/** One native renderer owns a single revision sequence for all composer owners. */
export class DraftPersistence {
  private checkpoint: DraftCheckpoint = { format: 1, revision: 0, drafts: [] }
  private readonly shells = new Map<string, SessionInputShell>()
  private ownerRevision = 0
  private readonly ready: Promise<void>
  private pending: Promise<void> = Promise.resolve()
  private readonly blockedOwners = new Set<string>()
  private readonly shellSubscriptions = new Map<string, () => void>()
  private readonly initializing = new Set<string>()
  private scheduled = false
  private releases: (() => void)[] | undefined
  private checkRestart: (() => void) | undefined
  private cancelRestartWait: (() => void) | undefined
  private readonly off: (() => void)[]
  private error: unknown
  private disposed = false
  private recoveryRequired = false

  /**
   * @param bridge - Native capability.
   * @param images - Browser image registry.
   * @param submissionFailed - Localized restart refusal after a failed submission.
   */
  constructor(
    private readonly bridge: DesktopDraftBridge,
    private readonly images: DraftImages,
    private readonly submissionFailed: () => string,
    private readonly onError: (error: unknown) => void = () => {},
  ) {
    this.ready = bridge.load().then((checkpoint) => { this.checkpoint = checkpoint })
    void this.ready.catch((error: unknown) => { this.error = error; this.onError(error) })
    this.off = [bridge.onPrepare(() => this.prepare()), bridge.onRelease(() => { this.release() })]
  }

  /**
   * Restore one owner before enabling editing and observe subsequent complete draft changes.
   * @param owner - `unassigned` or `session:` followed by the actual Session id.
   * @param shell - Composer whose lifecycle is owned by the caller.
   * @returns completion after restoration or an explicit failure without replacing live input.
   */
  async attachDraft(owner: string, shell: SessionInputShell): Promise<void> {
    if (this.disposed) throw new Error('Draft persistence is closed')
    if (this.shells.has(owner) || this.initializing.has(owner)) throw new Error('Draft owner is already attached')
    this.cancelRestartWait?.()
    this.ownerRevision += 1
    shell.useNativeDraftPersistence()
    const unlock = shell.lockDraft()
    this.shells.set(owner, shell)
    this.initializing.add(owner)
    try {
      await this.ready
      if (!this.owns(owner, shell)) throw new Error('Draft owner was detached during restoration')
      let legacy: string | undefined
      if (owner.startsWith('session:') && typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(`dsh.conversation.${owner.slice(8)}`)
        if (raw !== null) {
          const value: unknown = JSON.parse(raw)
          if (typeof value !== 'object' || value === null || !('draft' in value) || typeof value.draft !== 'string') throw new Error('Invalid current-origin draft')
          if (value.draft !== '') legacy = value.draft
        }
      }
      const saved = this.checkpoint.drafts.find(draft => draft.owner === owner)
      if (saved !== undefined) {
        const imageIds = await this.images.restore(saved.images)
        if (!this.owns(owner, shell)) throw new Error('Draft owner was detached during restoration')
        shell.restoreDraft({ ...saved, imageIds }, legacy)
      }
      if (saved === undefined && legacy !== undefined) { unlock(); shell.setDraft(legacy) }
      if (this.releases !== undefined) this.releases.push(shell.lockDraft())
      this.shellSubscriptions.set(owner, shell.state.subscribe(() => { this.schedule() }))
    } catch (error) {
      if (this.owns(owner, shell)) this.blockedOwners.add(owner)
      this.error = error
      throw error
    } finally { this.initializing.delete(owner); unlock(); this.checkRestart?.() }
  }

  private owns(owner: string, shell: SessionInputShell): boolean {
    return !this.disposed && this.shells.get(owner) === shell
  }

  /**
   * Detach a disposed composer without deleting its durable checkpoint.
   * @param owner - The detached stable draft owner.
   */
  detachDraft(owner: string): void {
    this.shellSubscriptions.get(owner)?.()
    this.shellSubscriptions.delete(owner)
    if (this.shells.delete(owner)) this.ownerRevision += 1
    this.blockedOwners.delete(owner)
    this.cancelRestartWait?.()
  }

  /**
   * Persist a stable identity before an automatic project preparation may reach the Host.
   * @returns - The durably recorded project preparation identity.
   */
  async prepareIdentity(): Promise<string> {
    const shell = this.shells.get('unassigned')
    if (shell === undefined) throw new Error('Unassigned draft is not attached')
    const release = shell.lockDraft()
    try {
      await this.save()
      return await this.enqueue(async () => {
        const draft = this.checkpoint.drafts.find(item => item.owner === 'unassigned')
        if (draft === undefined) throw new Error('Unassigned draft is not attached')
        if (draft.prepareId !== undefined) return draft.prepareId
        const prepareId = randomUUID()
        await this.commit(this.checkpoint.drafts.map(item => item === draft ? { ...item, prepareId } : item))
        return prepareId
      })
    } finally { release() }
  }

  /**
   * Commit both owners in one revision before an already-validated synchronous memory transfer.
   * @param targetSessionId - Real destination Session id, already attached and empty.
   * @param move - Synchronous memory move with no further business validation or asynchronous work.
   * @param beforeCommit - Final synchronous check; rejection leaves the transfer uncommitted.
   * @returns the committed destination owner and checkpoint revision.
   */
  async commitTransfer(targetSessionId: string, move: () => void, beforeCommit?: () => void): Promise<{ owner: string; revision: number }> {
    const owner = `session:${targetSessionId}`
    const source = this.shells.get('unassigned')
    const target = this.shells.get(owner)
    if (source === undefined || target === undefined) throw new Error('Both draft owners must be attached')
    const releases: (() => void)[] = []
    try {
      releases.push(source.lockDraft())
      releases.push(target.lockDraft())
      const empty = target.captureDraft()
      if (target.snapshot.draft !== '' || empty.imageIds.length !== 0) throw new Error('Transfer destination is not empty')
      await this.save()
      return await this.enqueue(async () => {
        const saved = this.checkpoint.drafts.find(item => item.owner === 'unassigned')
        if (saved === undefined) throw new Error('Source draft has not been saved')
        const { prepareId: _prepareId, ...content } = saved
        const drafts = this.checkpoint.drafts.filter(item => item.owner !== 'unassigned' && item.owner !== owner)
        drafts.push({ ...content, owner }, { owner: 'unassigned', editor: empty.editor, occurrenceIds: [], nextOccurrenceId: 0, images: [] })
        await this.commit(drafts, beforeCommit)
        for (const release of releases.splice(0)) release()
        try { move() }
        catch (error) { this.recoveryRequired = true; throw new Error(`Draft transfer was saved to ${owner}, but memory transfer failed; reload to recover: ${String(error)}`) }
        return { owner, revision: this.checkpoint.revision }
      })
    } finally { for (const release of releases) release() }
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const work = this.pending.then(action)
    this.pending = work.then(() => {}, (error: unknown) => { this.error = error; this.onError(error) })
    return work
  }

  private schedule(): void {
    this.checkRestart?.()
    if (this.scheduled || this.disposed || this.releases !== undefined) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (this.disposed || [...this.shells.values()].some(shell => !shell.isDraftSettled())) return
      void this.save().catch((error: unknown) => { this.error = error })
    })
  }

  /** Save current settled drafts; concurrent callers join the serialized revision sequence. */
  save(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready
      if (this.disposed) throw new Error('Draft persistence is closed')
      if (this.recoveryRequired) throw new Error('Reload is required to recover the committed draft transfer')
      if (this.blockedOwners.size !== 0) throw new Error('A draft could not be restored; reload or resolve the conflict before saving')
      if (this.initializing.size !== 0) throw new Error('Draft restoration has not finished')
      const documents = [...this.shells].map(([owner, shell]) => ({ owner, shell, document: shell.captureDraft() }))
      const replacements = await Promise.all(documents.map(async ({ owner, document }): Promise<PersistedDraft> => {
        const previous = this.checkpoint.drafts.find(draft => draft.owner === owner)
        return { owner, editor: document.editor, occurrenceIds: document.occurrenceIds,
          nextOccurrenceId: document.nextOccurrenceId, images: await this.images.capture(document.imageIds),
          ...(previous?.prepareId === undefined ? {} : { prepareId: previous.prepareId }) }
      }))
      for (const { shell, document } of documents) {
        if (JSON.stringify(shell.captureDraft()) !== JSON.stringify(document)) throw new Error('Draft changed while saving; retry with the current draft')
      }
      const capturedOwners = new Set(documents.map(({ owner }) => owner))
      const next = this.checkpoint.drafts.filter(draft => !capturedOwners.has(draft.owner)).concat(replacements)
      if (JSON.stringify(next) !== JSON.stringify(this.checkpoint.drafts)) await this.commit(next)
      this.error = undefined
    })
  }

  private async commit(drafts: PersistedDraft[], beforeCommit?: () => void): Promise<void> {
    const candidate: DraftCheckpoint = { format: 1, revision: this.checkpoint.revision + 1, drafts }
    beforeCommit?.()
    let revision: number
    try { revision = await this.bridge.save(candidate) }
    catch (error) {
      const committed = await this.bridge.load()
      if (JSON.stringify(committed) !== JSON.stringify(candidate)) throw error
      revision = committed.revision
    }
    if (revision !== candidate.revision) throw new Error('Draft save receipt does not match the requested revision')
    this.checkpoint = candidate
  }

  private lockSettledDrafts(releases: (() => void)[], failures: ReadonlyMap<SessionInputShell, number>): Promise<void> {
    return new Promise((resolve, reject) => {
      const clear = () => {
        this.checkRestart = undefined
        this.cancelRestartWait = undefined
      }
      this.cancelRestartWait = () => {
        clear()
        reject(new Error('Draft save preparation was cancelled'))
      }
      this.checkRestart = () => {
        if ([...failures].some(([shell, revision]) => shell.submissionFailureRevision !== revision)) {
          clear()
          reject(new Error(this.submissionFailed()))
          return
        }
        if (this.initializing.size !== 0 || [...this.shells.values()].some(shell => !shell.isRestartSettled())) return
        // Stop observation before locking: each lock publishes input state synchronously.
        clear()
        try {
          for (const shell of this.shells.values()) releases.push(shell.lockDraft())
          resolve()
        } catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
      }
      this.checkRestart()
    })
  }

  /**
   * Wait for submissions and project preparation, then atomically lock composers and save their settled drafts.
   * @returns - The committed checkpoint revision; cancellation rejects without releasing a newer request's locks.
   */
  async prepare(): Promise<number> {
    if (this.releases !== undefined) throw new Error('Draft save is already preparing a restart')
    const releases: (() => void)[] = []
    this.releases = releases
    const ownerRevision = this.ownerRevision
    const failures = new Map([...this.shells.values()].map(shell => [shell, shell.submissionFailureRevision]))
    try {
      await this.ready
      if (this.releases !== releases) throw new Error('Draft save preparation was cancelled')
      if (this.ownerRevision !== ownerRevision) throw new Error('Draft save preparation was cancelled')
      await this.lockSettledDrafts(releases, failures)
      await this.save()
      if (this.releases !== releases) throw new Error('Draft save preparation was cancelled')
      if (this.error !== undefined) throw this.error instanceof Error ? this.error : new Error('Draft checkpoint failed')
      return this.checkpoint.revision
    } catch (error) {
      if (this.releases === releases) this.release()
      throw error
    }
  }

  /** Release a cancelled or failed restart's input locks. */
  release(): void {
    this.cancelRestartWait?.()
    const releases = this.releases
    this.releases = undefined
    for (const release of releases ?? []) release()
    this.schedule()
  }

  /** Remove native listeners and input locks when the UI plugin unloads. */
  dispose(): void {
    this.disposed = true
    this.release()
    for (const off of this.off.splice(0)) off()
    for (const off of this.shellSubscriptions.values()) off()
    this.shellSubscriptions.clear()
  }
}
