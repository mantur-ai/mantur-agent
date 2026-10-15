/** ManturHub marketplace Host Remote. */

import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { readManturHubJson } from '@deepseek-ai/dsh-authorization-manturhub'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  ManturMarketplaceCatalog, ManturMarketplaceInstallResult, ManturMarketplaceSkill,
  ManturMarketplaceRecipe, ManturMarketplaceRecipeCatalog, ManturMarketplaceRecipeDetail,
  ManturMarketplaceRecipeQuery, ManturMarketplaceSkillDetail,
  ManturBundledSkill, ManturInstalledSkill,
} from './types.ts'
import { installSkill, type InstallerConfig } from './installer.ts'
import { loadBundledSkill, readBundledCatalog } from './bundled-catalog.ts'
import { bundledSkillReference, parseBundledSkillReference } from './bundled-manifest.ts'
import { updateBundledSkills } from './bundled-updates.ts'
import { SkillPreferences } from './skill-preferences.ts'
import type {} from '@deepseek-ai/dsh-skill'
import { registerBundledInvocations } from './bundled-invocation.ts'

export type * from './types.ts'

/** Marketplace Host configuration. */
export interface Config {
  /** Read-only App resource directory containing the pinned Skill manifest. */
  readonly bundledSkillDir?: string
  /** Harness home containing the live user Skill directory. */
  readonly dshHome?: string
  /** Maximum JSON bytes accepted per response and retained across Skill catalog pages. */
  readonly maxMetadataBytes?: number
  /** Maximum compressed bytes accepted for one Skill bundle. */
  readonly maxBundleBytes?: number
  /** Maximum files accepted from one Skill archive. */
  readonly maxFiles?: number
  /** Maximum total uncompressed bytes accepted from one Skill archive. */
  readonly maxUnpackedBytes?: number
  /** Timeout for catalog, detail, and public download requests. */
  readonly metadataTimeoutMs?: number
  /** Timeout for an approved off-origin package download. */
  readonly downloadTimeoutMs?: number
}

interface ResolvedConfig extends InstallerConfig {
  readonly bundledSkillDir?: string
  readonly maxMetadataBytes: number
}

const defaultMaxMetadataBytes = 1024 * 1024
const defaultMaxBundleBytes = 100 * 1024 * 1024
const defaultMaxFiles = 20_000
const defaultMaxUnpackedBytes = 500 * 1024 * 1024
const defaultMetadataTimeoutMs = 30_000
const defaultDownloadTimeoutMs = 120_000
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const recipeSlugPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const recipePageSize = 15

const skillSchema = z.object({
  code: z.string().regex(slugPattern),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  skillVersion: z.string().min(1),
  triggers: z.array(z.string()),
  coverUrl: z.url().optional().nullable(),
})
const detailSchema = skillSchema.extend({
  dependencies: z.array(z.string()),
  readme: z.string().optional().nullable(),
})
const catalogSchema = z.object({
  records: z.array(skillSchema),
  total: z.number().int().nonnegative(),
  pageNum: z.number().int().positive(),
  pages: z.number().int().nonnegative(),
})
const gatewaySchema = z.object({ code: z.literal(0), success: z.literal(true).optional(), data: z.unknown() })

const recipeSchema = z.object({
  code: z.string().regex(recipeSlugPattern),
  name: z.string().min(1),
  summary: z.string(),
  category: z.enum(['video', 'image', 'script']),
  tags: z.array(z.string()),
  coverUrl: z.string().min(1),
  sampleUrl: z.string().min(1),
  sampleKind: z.enum(['VIDEO', 'IMAGE', 'video', 'image']).transform(value => value.toLowerCase() as 'video' | 'image'),
  targetOperatorCode: z.string().min(1).nullable(),
  publishedAt: z.iso.datetime({ offset: true, local: true }),
})
const recipeCatalogSchema = z.object({
  records: z.array(recipeSchema),
  total: z.number().int().nonnegative(),
  pageNum: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pages: z.number().int().nonnegative(),
})
const recipeDetailSchema = recipeSchema.omit({ summary: true }).extend({
  description: z.string(),
  usage: z.string().nullable(),
  inputSchema: z.record(z.string(), z.json()),
  steps: z.array(z.object({ operatorCode: z.string().min(1), note: z.string().nullable() })),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the browser-safe ManturHub marketplaces. */
    manturMarketplace: ManturHubMarketplace
  }
}

/** Return whether the exact Skill directory already exists locally. */
async function isInstalled(skillsRoot: string, slug: string): Promise<boolean> {
  try {
    await lstat(join(skillsRoot, slug))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Project server metadata and local installation state onto the browser wire. */
async function projectSkill(
  value: z.infer<typeof skillSchema>,
  skillsRoot: string,
): Promise<ManturMarketplaceSkill> {
  return {
    slug: value.code,
    name: value.name,
    description: value.description,
    category: value.category,
    version: value.skillVersion,
    triggers: value.triggers,
    ...(value.coverUrl === undefined || value.coverUrl === null
      ? {} : { logoUrl: value.coverUrl }),
    installed: await isInstalled(skillsRoot, value.code),
  }
}

/** Resolve a public ManturHub URL against the response origin. */
function publicUrl(value: string, responseUrl: string): string {
  const url = new URL(value, responseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
    throw new Error('ManturHub public URL must use HTTP(S) without credentials')
  }
  return url.href
}

/** Project a published Recipe into browser-owned field names and absolute media URLs. */
function projectRecipe(value: z.infer<typeof recipeSchema>, responseUrl: string): ManturMarketplaceRecipe {
  return {
    slug: value.code,
    title: value.name,
    summary: value.summary,
    category: value.category,
    tags: value.tags,
    coverUrl: publicUrl(value.coverUrl, responseUrl),
    sampleUrl: publicUrl(value.sampleUrl, responseUrl),
    sampleKind: value.sampleKind,
    operatorId: value.targetOperatorCode,
    costEstimate: null,
    priceDumplings: null,
    author: null,
    copies: null,
    publishedAt: value.publishedAt,
  }
}

/** Host service for catalog reads and local Skill installation. */
export class ManturHubMarketplace extends TypertRemoteService {
  static inject = ['manturAccount']

  static Config: s<Config> = s.object({
    bundledSkillDir: s.string(),
    dshHome: s.string(),
    maxMetadataBytes: s.number().step(1).min(1024).default(defaultMaxMetadataBytes),
    maxBundleBytes: s.number().step(1).min(1024).default(defaultMaxBundleBytes),
    maxFiles: s.number().step(1).min(1).default(defaultMaxFiles),
    maxUnpackedBytes: s.number().step(1).min(1024).default(defaultMaxUnpackedBytes),
    metadataTimeoutMs: s.number().step(1).min(1).default(defaultMetadataTimeoutMs),
    downloadTimeoutMs: s.number().step(1).min(1).default(defaultDownloadTimeoutMs),
  })

  private readonly preferences: SkillPreferences
  private readonly config: ResolvedConfig
  private readonly updateAbort = new AbortController()
  private readonly bundledUpdatesRoot: string
  private installTail: Promise<void> = Promise.resolve()

  /**
   * @param ctx - Host context carrying the ManturHub account provider.
   * @param config - storage and response limits.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'manturMarketplace', { namespace: 'manturMarketplace' })
    const dshHome = resolveDshHome(config.dshHome)
    this.config = {
      ...(config.bundledSkillDir === undefined ? {} : { bundledSkillDir: config.bundledSkillDir }),
      dshHome,
      skillsRoot: join(dshHome, 'skills'),
      maxMetadataBytes: config.maxMetadataBytes ?? defaultMaxMetadataBytes,
      maxBundleBytes: config.maxBundleBytes ?? defaultMaxBundleBytes,
      maxFiles: config.maxFiles ?? defaultMaxFiles,
      maxUnpackedBytes: config.maxUnpackedBytes ?? defaultMaxUnpackedBytes,
      metadataTimeoutMs: config.metadataTimeoutMs ?? defaultMetadataTimeoutMs,
      downloadTimeoutMs: config.downloadTimeoutMs ?? defaultDownloadTimeoutMs,
    }
    this.preferences = new SkillPreferences(join(dshHome, 'manturhub-marketplace', 'skill-preferences.json'))
    ctx.on('skills/enabled', async (name, next) => {
      const allowed = await next()
      return allowed && await this.preferences.enabled(name)
    })
    this.bundledUpdatesRoot = join(dshHome, 'manturhub-marketplace', 'bundled-updates')
    registerBundledInvocations(ctx, this.config.bundledSkillDir, this.config, this.bundledUpdatesRoot)
    ctx.effect(() => async () => {
      this.updateAbort.abort()
      await this.installTail
    }, 'manturhub-marketplace: skill updates')
  }

  /**
   * Read the App's offline Skill entries without requesting account or marketplace data.
   * @param signal - cancellation supplied by the requesting client.
   * @returns pinned identities and display titles; missing resources reject the request.
   */
  @Remote
  async bundled(signal: AbortSignal): Promise<ManturBundledSkill[]> {
    const skills = await readBundledCatalog(this.config.bundledSkillDir, this.config, signal)
    const enabled = await this.enabledBundled(skills)
    return enabled.map(({ name, title, version, digest }) => ({ name, title, version, digest,
      reference: bundledSkillReference({ name, version, digest }), source: 'app-bundled' }))
  }

  /**
   * Check and install published versions of the App's recommended Skills.
   * @param signal - Cancellation supplied by the homepage.
   * @returns Verified latest identities; failed checks reject without substituting older versions.
   */
  @Remote
  async updateBundled(signal: AbortSignal): Promise<ManturBundledSkill[]> {
    signal = AbortSignal.any([signal, this.updateAbort.signal])
    const operation = this.installTail.then(async () => {
      signal.throwIfAborted()
      const seeds = await readBundledCatalog(this.config.bundledSkillDir, this.config, signal)
      const skills = await updateBundledSkills(this.ctx, seeds, this.bundledUpdatesRoot, this.config, signal)
      const enabled = await this.enabledBundled(skills)
      return enabled.map(({ name, title, version, digest }) => ({ name, title, version, digest,
        reference: bundledSkillReference({ name, version, digest }), source: 'app-bundled' as const }))
    })
    this.installTail = operation.then(() => {}, () => {})
    return await operation
  }

  /**
   * Verify that a draft still refers to the exact App resource the user selected.
   * @param reference - captured name, version and digest, never a user-directory locator.
   * @param signal - cancellation supplied by the sending draft.
   * @returns the verified App identity; no installed or online substitute is selected.
   */
  @Remote
  async resolveBundled(reference: string, signal: AbortSignal): Promise<ManturBundledSkill> {
    const loaded = await loadBundledSkill(
      this.config.bundledSkillDir, parseBundledSkillReference(reference), this.config, signal, this.bundledUpdatesRoot,
    )
    const { name, title, version, digest } = loaded.identity
    if (!await this.preferences.enabled(name)) throw new RemoteError('gateway/bad-request', 'Skill is disabled', {})
    return { name, title, version, digest, reference: bundledSkillReference(loaded.identity), source: 'app-bundled' }
  }

  private async enabledBundled<T extends { name: string }>(skills: T[]): Promise<T[]> {
    const enabled = await Promise.all(skills.map(skill => this.preferences.enabled(skill.name)))
    return skills.filter((_, index) => enabled[index])
  }

  /**
   * List locally discovered and App-bundled skills, including disabled entries.
   * @returns Local identities and switches without requiring the marketplace network.
   */
  @Remote
  async installedSkills(): Promise<ManturInstalledSkill[]> {
    const registry = this.ctx.get('skills')
    if (registry === undefined) throw new Error('Skill registry unavailable')
    const skills = await registry.list()
    const entries = new Map<string, ManturInstalledSkill>()
    for (const skill of skills) entries.set(skill.name, {
      name: skill.name, title: skill.title ?? skill.name, description: skill.description,
      source: skill.source === 'bundled' ? 'bundled' : 'local', enabled: await this.preferences.enabled(skill.name),
    })
    if (this.config.bundledSkillDir !== undefined) {
      const bundled = await readBundledCatalog(this.config.bundledSkillDir, this.config)
      for (const skill of bundled) {
        if (entries.has(skill.name)) continue
        entries.set(skill.name, { name: skill.name, title: skill.title, description: '',
          source: 'bundled', enabled: await this.preferences.enabled(skill.name) })
      }
    }
    return [...entries.values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  /**
   * Persist an installed skill's switch for this client, then invalidate discovery.
   * @param name - Installed skill identifier; applies to every version of this name.
   * @param enabled - Whether future references and body loads are permitted.
   */
  @Remote
  async setSkillEnabled(name: string, enabled: boolean): Promise<void> {
    if (!slugPattern.test(name)) throw new RemoteError('gateway/bad-request', 'Invalid skill name', {})
    const operation = this.installTail.then(async () => {
      if (!(await this.installedSkills()).some(skill => skill.name === name)) {
        throw new RemoteError('gateway/bad-request', 'Skill is not installed', {})
      }
      await this.preferences.set(name, enabled)
      this.ctx.emit('skills/change')
    })
    this.installTail = operation.then(() => {}, () => {})
    await operation
  }

  /**
   * Load the complete public Skill catalog and current local install flags.
   * @returns browser-safe catalog metadata.
   */
  @Remote
  async list(): Promise<ManturMarketplaceCatalog> {
    try {
      const parsed: z.infer<typeof skillSchema>[] = []
      const signal = AbortSignal.timeout(this.config.metadataTimeoutMs)
      let pages = 1
      let total = 0
      let remainingBytes = this.config.maxMetadataBytes
      for (let pageNum = 1; pageNum <= pages; pageNum += 1) {
        const response = await this.ctx.manturAccount.request(`/api/public/agent/v1/skills?pageNum=${pageNum}&pageSize=100`, {
          authenticated: false,
          headers: { 'X-ManturHub-Client': 'mantur-agent' },
          signal,
        })
        if (response === undefined || !response.ok) {
          throw new Error(`ManturHub catalog request failed with HTTP ${response?.status ?? 'unknown'}`)
        }
        const json = await readManturHubJson(response, remainingBytes, 'metadata')
        remainingBytes -= Buffer.byteLength(JSON.stringify(json))
        const page = catalogSchema.parse(gatewaySchema.parse(json).data)
        if (page.pageNum !== pageNum || (pageNum > 1 && (page.pages !== pages || page.total !== total))) {
          throw new Error('ManturHub Skill pagination changed during loading')
        }
        if (pageNum === 1) { pages = page.pages; total = page.total }
        if (pages > total || (pages > 0 && page.records.length === 0)) throw new Error('Invalid ManturHub Skill pagination')
        parsed.push(...page.records)
      }
      if (parsed.length !== total || new Set(parsed.map(skill => skill.code)).size !== total) {
        throw new Error('ManturHub Skill catalog is incomplete or contains duplicate codes')
      }
      const skills = await Promise.all(parsed.map(skill => projectSkill(skill, this.config.skillsRoot)))
      const account = await this.ctx.manturAccount.status()
      return {
        skills,
        installedCount: skills.filter(skill => skill.installed).length,
        signedIn: account.status === 'signed-in',
      }
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'ManturHub Skill catalog could not be loaded', {}, { cause: error })
    }
  }

  /**
   * Load one public Skill's detail metadata.
   * @param slug - validated Skill slug selected in the browser.
   * @returns browser-safe Skill detail.
   */
  @Remote
  async detail(slug: string): Promise<ManturMarketplaceSkillDetail> {
    if (!slugPattern.test(slug)) {
      throw new RemoteError('gateway/bad-request', 'invalid ManturHub Skill slug', {})
    }
    try {
      const response = await this.ctx.manturAccount.request(`/api/public/agent/v1/skills/${encodeURIComponent(slug)}`, {
        authenticated: false,
        headers: { 'X-ManturHub-Client': 'mantur-agent' },
        signal: AbortSignal.timeout(this.config.metadataTimeoutMs),
      })
      if (response === undefined || !response.ok) {
        throw new Error(`ManturHub Skill request failed with HTTP ${response?.status ?? 'unknown'}`)
      }
      const parsed = detailSchema.parse(gatewaySchema.parse(await readManturHubJson(response, this.config.maxMetadataBytes, 'metadata')).data)
      if (parsed.code !== slug) throw new Error('ManturHub returned a different Skill slug')
      return {
        ...await projectSkill(parsed, this.config.skillsRoot),
        usesOperators: parsed.dependencies,
        ...(parsed.readme === undefined || parsed.readme === null ? {} : { introduction: parsed.readme }),
      }
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'ManturHub Skill detail could not be loaded', {}, { cause: error })
    }
  }

  /**
   * Load one filtered page from the public Recipe catalog.
   * @param query - page, category, tag, and text filters.
   * @returns browser-safe Recipe summaries and pagination metadata.
   */
  @Remote
  async listRecipes(query: ManturMarketplaceRecipeQuery): Promise<ManturMarketplaceRecipeCatalog> {
    const page = query.page ?? 1
    if (!Number.isSafeInteger(page) || page < 1
      || (query.tag !== undefined && query.tag.trim() === '')
      || (query.query !== undefined && query.query.trim() === '')) {
      throw new RemoteError('gateway/bad-request', 'invalid ManturHub Recipe query', {})
    }
    const params = new URLSearchParams({ pageNum: String(page), pageSize: String(recipePageSize) })
    if (query.category !== undefined) params.set('category', query.category)
    if (query.tag !== undefined) params.set('tag', query.tag.trim())
    if (query.query !== undefined) params.set('keyword', query.query.trim())
    try {
      const response = await this.ctx.manturAccount.request(`/api/public/agent/v1/recipes?${params.toString()}`, {
        authenticated: false,
        headers: { 'X-ManturHub-Client': 'mantur-agent' },
        signal: AbortSignal.timeout(this.config.metadataTimeoutMs),
      })
      if (response === undefined || !response.ok) {
        throw new Error(`ManturHub Recipe catalog request failed with HTTP ${response?.status ?? 'unknown'}`)
      }
      const parsed = recipeCatalogSchema.parse(gatewaySchema.parse(await readManturHubJson(response, this.config.maxMetadataBytes, 'metadata')).data)
      return {
        recipes: parsed.records.map(recipe => projectRecipe(recipe, response.url)),
        total: parsed.total,
        page: parsed.pageNum,
        pageSize: parsed.pageSize,
        totalPages: parsed.pages,
        availableTags: [...new Set(parsed.records.flatMap(recipe => recipe.tags))],
      }
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'ManturHub Recipe catalog could not be loaded', {}, { cause: error })
    }
  }

  /**
   * Load one public Recipe and its authoritative Agent reproduction instructions.
   * @param slug - validated Recipe slug selected in the browser.
   * @returns browser-safe Recipe detail.
   */
  @Remote
  async recipeDetail(slug: string): Promise<ManturMarketplaceRecipeDetail> {
    if (!recipeSlugPattern.test(slug)) {
      throw new RemoteError('gateway/bad-request', 'invalid ManturHub Recipe slug', {})
    }
    try {
      const response = await this.ctx.manturAccount.request(`/api/public/agent/v1/recipes/${encodeURIComponent(slug)}`, {
        authenticated: false,
        headers: { 'X-ManturHub-Client': 'mantur-agent' },
        signal: AbortSignal.timeout(this.config.metadataTimeoutMs),
      })
      if (response === undefined || !response.ok) {
        throw new Error(`ManturHub Recipe request failed with HTTP ${response?.status ?? 'unknown'}`)
      }
      const parsed = recipeDetailSchema.parse(gatewaySchema.parse(await readManturHubJson(response, this.config.maxMetadataBytes, 'metadata')).data)
      if (parsed.code !== slug) throw new Error('ManturHub returned a different Recipe slug')
      return {
        ...projectRecipe({ ...parsed, summary: parsed.description }, response.url),
        sampleText: '',
        promptTemplate: '',
        parameters: null,
        inputSchema: parsed.inputSchema,
        steps: parsed.steps,
        models: [],
        agentPayload: parsed.usage ?? '',
      }
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'ManturHub Recipe detail could not be loaded', {}, { cause: error })
    }
  }

  /**
   * Download and atomically install one Skill into this running client's DSH_HOME.
   * @param slug - validated Skill slug selected in the browser.
   * @returns Host-confirmed installed version.
   */
  @Remote
  async installSkill(slug: string): Promise<ManturMarketplaceInstallResult> {
    if (!slugPattern.test(slug)) {
      throw new RemoteError('gateway/bad-request', 'invalid ManturHub Skill slug', {})
    }
    const operation = this.installTail.then(async () => {
      const detail = await this.detail(slug)
      const installed = await installSkill(this.ctx, slug, detail.version, this.config)
      return { ...installed, installed: true as const }
    })
    this.installTail = operation.then(() => {}, () => {})
    try {
      return await operation
    } catch (error) {
      if (error instanceof RemoteError) throw error
      if ((error as Error).message === 'AUTH_REQUIRED') {
        throw new RemoteError('mantur-marketplace/auth-required', 'Sign in to ManturHub before installing Skills', {})
      }
      if ((error as Error).message === 'LOCAL_CONFLICT') {
        throw new RemoteError(
          'mantur-marketplace/local-conflict',
          'The local Skill is untracked or has been modified and will not be overwritten',
          { slug },
        )
      }
      throw new RemoteError('gateway/internal', 'ManturHub Skill could not be installed', {}, { cause: error })
    }
  }
}

export default ManturHubMarketplace
