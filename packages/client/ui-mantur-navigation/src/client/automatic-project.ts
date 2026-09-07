/** First-send policy using the Host project owner and ordinary Session creation. */
import type { ClientRemote, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConversationDraftPreparation, IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ProjectCreationId, ProjectRootSettings } from '@deepseek-ai/dsh-mantur-projects/types'
import type {} from '@deepseek-ai/dsh-mantur-projects/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ProjectKey } from './project-locales.ts'

/** Project location and preparation status, independent of a fabricated Session. */
export interface AutomaticProjectState {
  readonly settings: ProjectRootSettings | undefined
  readonly loading: boolean
  readonly choosing: boolean
  readonly preparing: boolean
  readonly error: string | null
}

/** Inputs owned by the active Mantur client composition. */
export interface AutomaticProjectDeps {
  readonly remote: ClientRemote['manturProjects']
  readonly sessions: Pick<ISessions, 'create'>
  readonly workspace: Pick<UiWorkspace, 'pickDirectory'>
  readonly persistence: IConversation['draftPersistence']
  readonly text: (key: ProjectKey) => string
}

/** Uses the native draft checkpoint's identity until its complete draft reaches a real Session. */
export class AutomaticProjectController implements ConversationDraftPreparation {
  /** Browser-visible location and preparation state; it contains no fabricated Host entities. */
  readonly store = createSnapshotStore<AutomaticProjectState>({
    settings: undefined, loading: true, choosing: false, preparing: false, error: null,
  })
  private disposed = false
  private preparing = 0
  private settingsGeneration = 0

  /** @param deps - real Host operations, native draft persistence and localized error copy. */
  constructor(private readonly deps: AutomaticProjectDeps) {}

  /** Read the location without creating a directory or Session. */
  async load(): Promise<void> {
    if (this.store.getSnapshot().choosing || this.disposed) return
    const generation = ++this.settingsGeneration
    this.publish({ loading: true, error: null })
    try {
      const result = await this.deps.remote.settings()
      if (generation !== this.settingsGeneration) return
      if (!result.ok) throw new Error(this.deps.text('settingsFailed'))
      this.publish({ settings: result.value, loading: false })
    } catch {
      // A failed settings read has no usable fresh location.
      if (generation === this.settingsGeneration) this.publish({ settings: undefined, loading: false, error: this.deps.text('settingsFailed') })
    }
  }

  /** Open the Host-native picker; cancellation does not change the root. */
  async chooseRoot(): Promise<void> {
    if (this.store.getSnapshot().choosing || this.disposed) return
    this.publish({ choosing: true, error: null })
    try {
      const path = await this.deps.workspace.pickDirectory()
      if (path === null || this.isDisposed()) return
      this.settingsGeneration += 1
      const result = await this.deps.remote.setRoot(path)
      if (!result.ok) throw new Error(this.deps.text('selectionFailed'))
      this.publish({ settings: result.value, loading: false })
    } catch {
      // A failed root-save transport can leave its commit status unknown.
      this.publish({ settings: undefined, loading: false, error: this.deps.text('selectionFailed') })
    } finally {
      this.publish({ choosing: false })
    }
  }

  /**
   * Prepare a directory and real Session; draft transfer and send belong to ConversationDrafts.
   * @param signal - stops subsequent steps when the originating draft is abandoned.
   * @returns the same Session on a retry of the durable draft's creation identity.
   */
  async prepare(signal: AbortSignal): Promise<SessionId> {
    signal.throwIfAborted()
    this.preparing += 1
    this.publish({ preparing: true, error: null })
    try {
      const id = await this.creationId()
      signal.throwIfAborted()
      const result = await this.deps.remote.prepare(id, `${this.deps.text('newProject')} ${id.slice(0, 8)}`)
      signal.throwIfAborted()
      if (!result.ok) throw this.creationFailure(result.error)
      let sessionId: SessionId
      try {
        sessionId = await this.deps.sessions.create({
          workspaceId: result.value.workspaceId, sessionId: result.value.sessionId,
        })
      } catch {
        // Session creation or attachment did not complete; the retained identity is retryable.
        throw new Error(this.deps.text('sessionFailed'))
      }
      signal.throwIfAborted()
      return sessionId
    } catch (error) {
      if (!signal.aborted) this.publish({ error: error instanceof Error ? error.message : this.deps.text('createFailed') })
      throw error
    } finally {
      this.preparing -= 1
      this.publish({ preparing: this.preparing > 0 })
    }
  }

  /** Stop publishing state after the owning plugin unloads. */
  dispose(): void {
    this.disposed = true
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  private async creationId(): Promise<ProjectCreationId> {
    try {
      if (this.deps.persistence === undefined) throw new Error('Native draft persistence is unavailable')
      return await this.deps.persistence.prepareIdentity() as ProjectCreationId
    } catch {
      // No Host entity may be created without a durably acknowledged retry identity.
      throw new Error(this.deps.text('storageFailed'))
    }
  }

  private creationFailure(error: RemoteFailure): Error {
    if (error.code === 'mantur-project/creation-failed') {
      const key = {
        'root-unconfigured': 'rootRequired',
        'directory-conflict': 'directoryConflict',
        'directory-invalid': 'directoryInvalid',
      } as const
      return new Error(this.deps.text(key[error.details.reason]))
    }
    return new Error(this.deps.text('createFailed'))
  }

  private publish(update: Partial<AutomaticProjectState>): void {
    if (!this.disposed) this.store.set({ ...this.store.getSnapshot(), ...update })
  }
}
