/** First-send project directories with durable, retryable Workspace preparation. */
import { mkdir, lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { projectDomainSpec, type ProjectRecord } from './spec.ts'
import type { PreparedProject, ProjectCreationId, ProjectRootSettings } from './types.ts'

/** The desktop supplies its OS-resolved Documents project directory. */
export interface Config {
  /** Default root; omission requires an explicit user selection before creation. */
  readonly defaultRoot?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of automatic Mantur project creation. */
    manturProjects: ManturProjectController
  }
}

/** Validate an absolute user/configuration path without creating it. */
function rootPath(path: string): string {
  if (!isAbsolute(path) || path.includes('\0')) throw new TypeError('The project root must be an absolute directory path.')
  return normalize(path)
}

/** Prepare one project per first-send identity, without creating or sending a Session. */
export class ManturProjectController extends TypertRemoteService {
  static inject = ['storageDomain', 'workspaceRegistry']
  static Config: s<Config> = s.object({ defaultRoot: s.string() })

  private domain!: Domain<typeof projectDomainSpec>
  private readonly pending = new Map<ProjectCreationId, Promise<PreparedProject>>()
  private readonly defaultRoot: string | undefined
  private stopped = false

  /**
   * @param ctx - Host context with durable storage and Workspace ownership.
   * @param config - optional desktop-resolved default project root.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'manturProjects')
    this.defaultRoot = config.defaultRoot === undefined ? undefined : rootPath(config.defaultRoot)
  }

  protected async [Service.init](): Promise<void> {
    this.domain = await this.ctx.storageDomain.open(projectDomainSpec)
    this.ctx.effect(() => async () => {
      this.stopped = true
      await Promise.allSettled([...this.pending.values()])
      await this.domain.close()
    }, 'mantur-projects: drain creation and close storage')
  }

  /**
   * Read the configured project location without creating directories.
   * @returns the selected root or an explicit unconfigured state.
   */
  @Remote
  settings(): ProjectRootSettings {
    const selected = this.domain.global.get().rootPath
    if (selected !== null) return { source: 'custom', rootPath: selected }
    if (this.defaultRoot !== undefined) return { source: 'desktop', rootPath: this.defaultRoot }
    return { source: 'unconfigured' }
  }

  /**
   * Select the root for future projects; existing directories remain untouched.
   * @param path - absolute project root selected by the user.
   * @returns the durable root selection.
   */
  @Remote
  async setRoot(path: string): Promise<ProjectRootSettings> {
    await this.domain.global.set({ rootPath: rootPath(path) })
    return this.settings()
  }

  /**
   * Create or resume the same first-send project. No Session or message is created here.
   * @param creationId - UUID retained by the client until draft transfer succeeds.
   * @param title - localized initial Workspace title, retained for this creation identity.
   * @returns its durable Workspace and deterministic Session identity.
   */
  @Remote
  prepare(creationId: ProjectCreationId, title: string): Promise<PreparedProject> {
    z.uuid().parse(creationId)
    const initialTitle = z.string().trim().min(1).parse(title)
    if (this.stopped) throw new Error('Automatic project creation is unavailable while shutting down.')
    const current = this.pending.get(creationId)
    if (current !== undefined) return current
    const attempt = this.createProject(creationId, initialTitle).finally(() => { this.pending.delete(creationId) })
    this.pending.set(creationId, attempt)
    return attempt
  }

  private async createProject(creationId: ProjectCreationId, title: string): Promise<PreparedProject> {
    const records = this.domain.table('creations')
    let record: ProjectRecord | undefined = records.get(creationId)
    if (record === undefined) {
      const settings = this.settings()
      if (settings.source === 'unconfigured') {
        throw new RemoteError('mantur-project/creation-failed', 'Select a project root before sending.', { reason: 'root-unconfigured' })
      }
      record = {
        path: join(settings.rootPath, `project-${creationId}`),
        title,
        directoryCreated: false,
      }
      await records.put(creationId, record)
    }
    if (!record.directoryCreated) {
      const parent = dirname(record.path)
      await mkdir(parent, { recursive: true })
      try {
        await mkdir(record.path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        throw new RemoteError('mantur-project/creation-failed', 'The reserved project directory already exists; it was not reused.', {
          reason: 'directory-conflict', path: record.path,
        })
      }
      record = { ...record, directoryCreated: true }
      await records.put(creationId, record)
    }
    let directoryValid: boolean
    try {
      directoryValid = (await lstat(record.path)).isDirectory()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      directoryValid = false
    }
    if (!directoryValid) {
      throw new RemoteError('mantur-project/creation-failed', 'The project directory was replaced or removed.', {
        reason: 'directory-invalid', path: record.path,
      })
    }
    const workspace = await this.ctx.workspaceRegistry.create(record.path, record.title)
    return {
      workspaceId: workspace.id,
      sessionId: brandString<SessionId>(`session-${creationId}`),
      path: workspace.path,
    }
  }
}

export default ManturProjectController
