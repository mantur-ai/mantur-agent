/** Browser state for the ManturHub marketplaces. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-mantur-account/client'
import type { ManturLoginAttemptId, ManturLoginStart } from '@deepseek-ai/dsh-authorization-manturhub/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ManturMarketplaceCatalog, ManturMarketplaceRecipeCatalog, ManturMarketplaceRecipeDetail,
  ManturMarketplaceRecipeQuery, ManturMarketplaceSkillDetail,
} from '@deepseek-ai/dsh-manturhub-marketplace/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Client-visible marketplace state. */
export type ManturMarketplaceState =
  | { readonly phase: 'idle' | 'loading' }
  | { readonly phase: 'failed' }
  | {
    readonly phase: 'ready'
    readonly catalog: ManturMarketplaceCatalog
    readonly detail?: ManturMarketplaceSkillDetail | undefined
    readonly detailLoading?: string | undefined
    readonly detailError?: string | undefined
    readonly installing?: string | undefined
    readonly installError?: 'auth-required' | 'local-conflict' | 'failed' | undefined
    readonly using?: string | undefined
    readonly useError?: 'no-workspace' | 'failed' | undefined
    readonly login?: ManturLoginStart | undefined
    readonly loginPhase?: 'starting' | 'authorizing' | 'failed' | 'unavailable' | undefined
  }

/** Client-visible Recipe catalog, detail, and launch state. */
export type ManturRecipeMarketplaceState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading'; readonly query: ManturMarketplaceRecipeQuery }
  | { readonly phase: 'failed'; readonly query: ManturMarketplaceRecipeQuery }
  | {
    readonly phase: 'ready'
    readonly catalog: ManturMarketplaceRecipeCatalog
    readonly query: ManturMarketplaceRecipeQuery
    readonly detail?: ManturMarketplaceRecipeDetail | undefined
    readonly detailLoading?: string | undefined
    readonly detailError?: string | undefined
    readonly launching?: string | undefined
    readonly launchError?: 'no-workspace' | 'failed' | undefined
  }

/** Locale-owned trace lines that wrap one authoritative Recipe payload. */
export interface ManturRecipeLaunchCopy {
  readonly introduction: string
  readonly identifier: string
  readonly platform: string
  readonly source?: string
}

/** Convert one generated Remote result into its value. */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (result.ok) return result.value
  throw new Error(`${result.error.code}: ${result.error.message}`)
}

/** Return a stable identity for one Recipe catalog request. */
function recipeQueryKey(query: ManturMarketplaceRecipeQuery): string {
  return JSON.stringify([
    query.page ?? 1,
    query.category ?? '',
    query.tag ?? '',
    query.query ?? '',
  ])
}

/** Root-scoped controller for catalog and detail reads. */
export class ManturMarketplaceStore {
  /** Snapshot consumed by the Skill page. */
  readonly store: SnapshotStore<ManturMarketplaceState> = createSnapshotStore({ phase: 'idle' })
  /** Snapshot consumed by the Recipe page. */
  readonly recipes: SnapshotStore<ManturRecipeMarketplaceState> = createSnapshotStore({ phase: 'idle' })
  private generation = 0
  private recipeGeneration = 0
  private loginGeneration = 0
  private loginTimer: number | undefined
  private pendingSkillSession: { readonly workspaceId: WorkspaceId; readonly sessionId: SessionId } | undefined
  private pendingRecipeSession: { readonly workspaceId: WorkspaceId; readonly sessionId: SessionId } | undefined

  /** @param ctx - client context carrying the generated marketplace Remote. */
  constructor(private readonly ctx: Context) {}

  /** Load the public catalog and local installation flags. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.set({ phase: 'loading' })
    try {
      const catalog = unwrap(await this.ctx.remote.manturMarketplace.list())
      if (generation === this.generation) this.store.set({ phase: 'ready', catalog })
    } catch {
      if (generation === this.generation) this.store.set({ phase: 'failed' })
    }
  }

  /** Load the Skill catalog only when this controller has no settled state. */
  async ensureSkillCatalog(): Promise<void> {
    if (this.store.getSnapshot().phase !== 'idle') return
    await this.load()
  }

  /**
   * Reuse the current Recipe catalog when it represents the requested query.
   * @param query - page and optional category, tag, and text filters.
   */
  async ensureRecipeCatalog(query: ManturMarketplaceRecipeQuery = {}): Promise<void> {
    const key = recipeQueryKey(query)
    const current = this.recipes.getSnapshot()
    if (current.phase !== 'idle'
      && recipeQueryKey(current.query) === key) return
    await this.loadRecipes(query)
  }

  /**
   * Load one public Recipe page with server-side filters.
   * @param query - page and optional category, tag, and text filters.
   */
  async loadRecipes(query: ManturMarketplaceRecipeQuery = {}): Promise<void> {
    const generation = ++this.recipeGeneration
    this.recipes.set({ phase: 'loading', query })
    try {
      const catalog = unwrap(await this.ctx.remote.manturMarketplace.listRecipes(query))
      if (generation === this.recipeGeneration) {
        this.recipes.set({ phase: 'ready', catalog, query })
      }
    } catch {
      if (generation === this.recipeGeneration) {
        this.recipes.set({ phase: 'failed', query })
      }
    }
  }

  /**
   * Load the selected Recipe's public detail.
   * @param slug - Recipe selected from the current catalog page.
   */
  async openRecipeDetail(slug: string): Promise<void> {
    const current = this.recipes.getSnapshot()
    if (current.phase !== 'ready') return
    const generation = ++this.recipeGeneration
    this.recipes.set({ ...current, detail: undefined, detailError: undefined, detailLoading: slug })
    try {
      const detail = unwrap(await this.ctx.remote.manturMarketplace.recipeDetail(slug))
      if (generation === this.recipeGeneration) {
        this.recipes.set({ ...current, detail, detailLoading: undefined })
      }
    } catch {
      if (generation === this.recipeGeneration) {
        this.recipes.set({ ...current, detailError: slug, detailLoading: undefined })
      }
    }
  }

  /** Close the selected Recipe and retain the current catalog page. */
  closeRecipeDetail(): void {
    const current = this.recipes.getSnapshot()
    if (current.phase !== 'ready') return
    ++this.recipeGeneration
    this.recipes.set({ phase: 'ready', catalog: current.catalog, query: current.query })
  }

  /**
   * Start a new Session in the current Workspace and submit the Recipe's authoritative payload.
   * @param copy - localized trace lines prepared by the active Recipe page.
   * @returns whether the Host accepted the first durable user message.
   */
  async startRecipe(copy: ManturRecipeLaunchCopy): Promise<boolean> {
    const current = this.recipes.getSnapshot()
    if (current.phase !== 'ready' || current.detail === undefined || current.launching !== undefined) return false
    const detail = current.detail
    const sessions = this.ctx.get('sessions')
    const workspaces = this.ctx.get('workspaces')
    if (sessions === undefined || workspaces === undefined) throw new Error('Recipe launch services are unavailable')
    const currentSessionId = sessions.list.getSnapshot().current
    const workspace = currentSessionId === undefined
      ? undefined
      : workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(currentSessionId))
    if (workspace === undefined) {
      this.recipes.set({ ...current, launchError: 'no-workspace' })
      return false
    }
    this.recipes.set({ ...current, launching: detail.slug, launchError: undefined })
    try {
      if (this.pendingRecipeSession !== undefined
        && this.pendingRecipeSession.workspaceId !== workspace.workspaceId) {
        await workspaces.archiveSession(this.pendingRecipeSession.sessionId)
        this.pendingRecipeSession = undefined
      }
      const sessionId = this.pendingRecipeSession?.sessionId
        ?? await sessions.create({ workspaceId: workspace.workspaceId })
      this.pendingRecipeSession = { workspaceId: workspace.workspaceId, sessionId }
      const binding = sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`Recipe session "${sessionId}" resolved no binding`)
      const conversation = binding.ctx.get('conversation')
      if (conversation === undefined) throw new Error('Recipe conversation service is unavailable')
      await conversation.send([
        copy.introduction,
        copy.identifier,
        copy.platform,
        ...(copy.source === undefined ? [] : [copy.source]),
        '',
        detail.agentPayload,
      ].join('\n'))
      sessions.open(sessionId)
      this.pendingRecipeSession = undefined
      const latest = this.recipes.getSnapshot()
      if (latest.phase === 'ready') this.recipes.set({ ...latest, launching: undefined, launchError: undefined })
      return true
    } catch {
      const latest = this.recipes.getSnapshot()
      if (latest.phase === 'ready') this.recipes.set({ ...latest, launching: undefined, launchError: 'failed' })
      return false
    }
  }

  /**
   * Load the selected Skill's public detail.
   * @param slug - Catalog slug selected by the user.
   */
  async openDetail(slug: string): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.phase !== 'ready') return
    const generation = ++this.generation
    this.store.set({ phase: 'ready', catalog: current.catalog, detailLoading: slug })
    try {
      const detail = unwrap(await this.ctx.remote.manturMarketplace.detail(slug))
      if (generation === this.generation) this.store.set({ phase: 'ready', catalog: current.catalog, detail })
    } catch {
      if (generation === this.generation) {
        this.store.set({ phase: 'ready', catalog: current.catalog, detailError: slug })
      }
    }
  }

  /** Close the current detail without refetching the catalog. */
  closeDetail(): void {
    const current = this.store.getSnapshot()
    if (current.phase !== 'ready') return
    ++this.generation
    this.store.set({ phase: 'ready', catalog: current.catalog })
  }

  /**
   * Install one selected Skill, preserving explicit authentication and conflict failures.
   * @param slug - Catalog slug approved by the user.
   */
  async install(slug: string): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.phase !== 'ready' || current.installing !== undefined) return
    if (!current.catalog.signedIn) {
      this.store.set({ ...current, installError: 'auth-required' })
      return
    }
    this.store.set({ ...current, installing: slug, installError: undefined })
    const result = await this.ctx.remote.manturMarketplace.installSkill(slug)
    const pending = this.store.getSnapshot()
    if (pending.phase !== 'ready' || pending.installing !== slug) return
    if (!result.ok) {
      const installError = result.error.code === 'mantur-marketplace/auth-required'
        ? 'auth-required'
        : result.error.code === 'mantur-marketplace/local-conflict'
          ? 'local-conflict'
          : 'failed'
      this.store.set({
        ...pending,
        installing: undefined,
        installError,
        catalog: installError === 'auth-required'
          ? { ...pending.catalog, signedIn: false }
          : pending.catalog,
      })
      return
    }
    const skills = pending.catalog.skills.map(skill => skill.slug === slug
      ? { ...skill, installed: true }
      : skill)
    const newlyInstalled = pending.catalog.skills.some(skill => skill.slug === slug && !skill.installed)
    this.store.set({
      ...pending,
      installing: undefined,
      installError: undefined,
      catalog: {
        ...pending.catalog,
        skills,
        installedCount: pending.catalog.installedCount + (newlyInstalled ? 1 : 0),
      },
      ...(pending.detail?.slug === slug ? { detail: { ...pending.detail, installed: true } } : {}),
    })
  }

  /**
   * Start a default-named Session in the current Workspace with an installed Skill command as its draft.
   * @param slug - Installed Skill selected by the user.
   * @returns whether the draft is ready in the newly opened Session.
   */
  async startSkill(slug: string): Promise<boolean> {
    const current = this.store.getSnapshot()
    const skill = current.phase === 'ready'
      ? current.catalog.skills.find(candidate => candidate.slug === slug)
      : undefined
    if (current.phase !== 'ready' || skill?.installed !== true || current.using !== undefined) return false
    const sessions = this.ctx.get('sessions')
    const workspaces = this.ctx.get('workspaces')
    if (sessions === undefined || workspaces === undefined) throw new Error('Skill launch services are unavailable')
    const currentSessionId = sessions.list.getSnapshot().current
    const workspace = currentSessionId === undefined
      ? undefined
      : workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(currentSessionId))
    if (workspace === undefined) {
      this.store.set({ ...current, useError: 'no-workspace' })
      return false
    }
    this.store.set({ ...current, using: slug, useError: undefined })
    try {
      if (this.pendingSkillSession !== undefined
        && this.pendingSkillSession.workspaceId !== workspace.workspaceId) {
        await workspaces.archiveSession(this.pendingSkillSession.sessionId)
        this.pendingSkillSession = undefined
      }
      const sessionId = this.pendingSkillSession?.sessionId
        ?? await sessions.create({ workspaceId: workspace.workspaceId })
      this.pendingSkillSession = { workspaceId: workspace.workspaceId, sessionId }
      const binding = sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`Skill session "${sessionId}" resolved no binding`)
      const conversation = binding.ctx.get('conversation')
      if (conversation === undefined) throw new Error('Skill conversation service is unavailable')
      conversation.input.for(binding.ctx).setDraft(`/${slug}`)
      sessions.open(sessionId)
      this.pendingSkillSession = undefined
      const latest = this.store.getSnapshot()
      if (latest.phase === 'ready') this.store.set({ ...latest, using: undefined, useError: undefined })
      return true
    } catch {
      const latest = this.store.getSnapshot()
      if (latest.phase === 'ready') this.store.set({ ...latest, using: undefined, useError: 'failed' })
      return false
    }
  }

  /** Open the Host-selected account flow; login never repeats installation or changes the current project. */
  async startLogin(): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.phase !== 'ready' || current.loginPhase === 'starting' || current.loginPhase === 'authorizing') return
    const generation = ++this.loginGeneration
    this.clearLoginTimer()
    this.store.set({ ...current, installError: undefined, loginPhase: 'starting', login: undefined })
    let failurePhase: 'failed' | 'unavailable' = 'unavailable'
    try {
      const identity = await this.ctx.remote.manturAccount.identityMode()
      const selected = this.store.getSnapshot()
      if (generation !== this.loginGeneration || selected.phase !== 'ready') return
      if (!identity.ok) throw new Error('Mantur account identity mode is unavailable')
      if (identity.value === 'desktop-managed') {
        const request = this.ctx.bail('mantur/native-account-open')
        if (request === undefined) throw new Error('Native account dialog is unavailable')
        const outcome = await request
        const latest = this.store.getSnapshot()
        if (generation !== this.loginGeneration || latest.phase !== 'ready') return
        this.store.set({ ...latest, loginPhase: undefined,
          catalog: { ...latest.catalog, signedIn: outcome === 'authenticated' || latest.catalog.signedIn } })
        return
      }
      failurePhase = 'failed'
      const result = await this.ctx.remote.manturAccount.startLogin()
      const latest = this.store.getSnapshot()
      if (generation !== this.loginGeneration || latest.phase !== 'ready') return
      if (!result.ok) {
        this.store.set({ ...latest, loginPhase: 'failed' })
        return
      }
      this.store.set({ ...latest, login: result.value, loginPhase: 'authorizing' })
      this.scheduleLoginPoll(result.value.attemptId, generation)
    } catch {
      const latest = this.store.getSnapshot()
      if (generation === this.loginGeneration && latest.phase === 'ready') this.store.set({ ...latest, loginPhase: failurePhase })
    }
  }

  /** Cancel the login attempt started from this marketplace. */
  async cancelLogin(): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.phase !== 'ready' || current.login === undefined) return
    ++this.loginGeneration
    this.clearLoginTimer()
    const result = await this.ctx.remote.manturAccount.cancelLogin(current.login.attemptId)
    const latest = this.store.getSnapshot()
    if (latest.phase !== 'ready') return
    this.store.set(result.ok
      ? { ...latest, login: undefined, loginPhase: undefined }
      : { ...latest, loginPhase: 'failed' })
  }

  /** Make in-flight Remote settlements stale. */
  dispose(): void {
    ++this.generation
    ++this.recipeGeneration
    ++this.loginGeneration
    this.clearLoginTimer()
  }

  private scheduleLoginPoll(attemptId: ManturLoginAttemptId, generation: number): void {
    this.loginTimer = window.setTimeout(() => { void this.pollLogin(attemptId, generation) }, 750)
  }

  private async pollLogin(attemptId: ManturLoginAttemptId, generation: number): Promise<void> {
    const result = await this.ctx.remote.manturAccount.loginProgress(attemptId)
    const current = this.store.getSnapshot()
    if (generation !== this.loginGeneration || current.phase !== 'ready') return
    if (!result.ok) {
      this.store.set({ ...current, loginPhase: 'failed' })
      return
    }
    if (result.value.status === 'pending') {
      this.scheduleLoginPoll(attemptId, generation)
    } else if (result.value.status === 'authorized') {
      this.store.set({
        ...current,
        catalog: { ...current.catalog, signedIn: true },
        installError: undefined,
        login: undefined,
        loginPhase: undefined,
      })
    } else if (result.value.status === 'cancelled') {
      this.store.set({ ...current, login: undefined, loginPhase: undefined })
    } else {
      this.store.set({ ...current, loginPhase: 'failed' })
    }
  }

  private clearLoginTimer(): void {
    if (this.loginTimer === undefined) return
    window.clearTimeout(this.loginTimer)
    this.loginTimer = undefined
  }
}
