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
  ManturBundledSkill,
} from './types.ts'
import { installSkill, type InstallerConfig } from './installer.ts'
import { loadBundledSkill, readBundledCatalog } from './bundled-catalog.ts'
import { bundledSkillReference, parseBundledSkillReference } from './bundled-manifest.ts'
import { registerBundledInvocations } from './bundled-invocation.ts'

export type * from './types.ts'

/** Marketplace Host configuration. */
export interface Config {
  /** Read-only App resource directory containing the pinned Skill manifest. */
  readonly bundledSkillDir?: string
  /** Harness home containing the live user Skill directory. */
  readonly dshHome?: string
  /** Maximum JSON bytes accepted from one ManturHub metadata response. */
  readonly maxMetadataBytes?: number
  /** Maximum compressed bytes accepted for one Skill bundle. */
  readonly maxBundleBytes?: number
  /** Maximum files accepted from one Skill archive. */
  readonly maxFiles?: number
  /** Maximum total uncompressed bytes accepted from one Skill archive. */
  readonly maxUnpackedBytes?: number
  /** Timeout for catalog, detail, and authenticated download requests. */
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
  slug: z.string().regex(slugPattern),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  version: z.string().min(1),
  triggers: z.array(z.string()).default([]),
  uses_operators: z.array(z.string()).default([]),
  intro_md: z.string().optional().nullable(),
  assets: z.object({
    logo_url: z.url().optional().nullable(),
  }).optional().nullable(),
  kind: z.enum(['skill', 'suite']).default('skill'),
})

const skillListSchema = z.array(skillSchema)
const catalogSchema = z.union([skillListSchema, z.object({ skills: skillListSchema })])
  .transform(value => Array.isArray(value) ? value : value.skills)
const detailSchema = z.union([skillSchema, z.object({ skill: skillSchema })])
  .transform(value => 'skill' in value ? value.skill : value)

const recipeSchema = z.object({
  slug: z.string().regex(recipeSlugPattern),
  title: z.string().min(1),
  summary: z.string(),
  cat: z.enum(['video', 'image', 'script']),
  tags: z.array(z.string()),
  cover_url: z.string().min(1),
  sample_url: z.string().min(1),
  sample_kind: z.enum(['video', 'image']),
  operator_id: z.string().min(1),
  cost_estimate: z.string(),
  price_dumplings: z.number().nonnegative(),
  author: z.string(),
  copies: z.number().int().nonnegative(),
  published_at: z.iso.datetime({ offset: true }),
})

const recipeCatalogSchema = z.object({
  recipes: z.array(recipeSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  total_pages: z.number().int().nonnegative(),
  available_tags: z.array(z.string()),
})

const recipeDetailSchema = recipeSchema.extend({
  sample_text: z.string(),
  prompt_template: z.string(),
  params_json: z.json(),
  source_url: z.string(),
  source_name: z.string(),
  source_avatar_url: z.string(),
  models: z.array(z.string()),
  agent_payload: z.string().min(1),
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
    slug: value.slug,
    name: value.name,
    description: value.description,
    category: value.category,
    version: value.version,
    triggers: value.triggers,
    ...(value.assets?.logo_url === undefined || value.assets.logo_url === null
      ? {} : { logoUrl: value.assets.logo_url }),
    installed: await isInstalled(skillsRoot, value.slug),
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
    slug: value.slug,
    title: value.title,
    summary: value.summary,
    category: value.cat,
    tags: value.tags,
    coverUrl: publicUrl(value.cover_url, responseUrl),
    sampleUrl: publicUrl(value.sample_url, responseUrl),
    sampleKind: value.sample_kind,
    operatorId: value.operator_id,
    costEstimate: value.cost_estimate,
    priceDumplings: value.price_dumplings,
    author: value.author,
    copies: value.copies,
    publishedAt: value.published_at,
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

  private readonly config: ResolvedConfig
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
    registerBundledInvocations(ctx, this.config.bundledSkillDir, this.config)
  }

  /**
   * Read the App's offline Skill entries without requesting account or marketplace data.
   * @param signal - cancellation supplied by the requesting client.
   * @returns pinned identities and display titles; missing resources reject the request.
   */
  @Remote
  async bundled(signal: AbortSignal): Promise<ManturBundledSkill[]> {
    const skills = await readBundledCatalog(this.config.bundledSkillDir, this.config, signal)
    return skills.map(({ name, title, version, digest }) => ({ name, title, version, digest,
      reference: bundledSkillReference({ name, version, digest }), source: 'app-bundled' }))
  }

  /**
   * Verify that a draft still refers to the exact App resource the user selected.
   * @param reference - captured name, version and digest, never a user-directory locator.
   * @param signal - cancellation supplied by the sending draft.
   * @returns the verified App identity; no installed or online substitute is selected.
   */
  @Remote
  async resolveBundled(reference: string, signal: AbortSignal): Promise<ManturBundledSkill> {
    const loaded = await loadBundledSkill(this.config.bundledSkillDir, parseBundledSkillReference(reference), this.config, signal)
    const { name, title, version, digest } = loaded.identity
    return { name, title, version, digest, reference: bundledSkillReference(loaded.identity), source: 'app-bundled' }
  }

  /**
   * Load the complete public Skill catalog and current local install flags.
   * @returns browser-safe catalog metadata.
   */
  @Remote
  async list(): Promise<ManturMarketplaceCatalog> {
    try {
      const response = await this.ctx.manturAccount.request('/api/v1/skills', {
        authenticated: false,
        headers: { 'X-ManturHub-Client': 'mantur-agent' },
        signal: AbortSignal.timeout(this.config.metadataTimeoutMs),
      })
      if (response === undefined || !response.ok) {
        throw new Error(`ManturHub catalog request failed with HTTP ${response?.status ?? 'unknown'}`)
      }
      const parsed = catalogSchema.parse(await readManturHubJson(response, this.config.maxMetadataBytes, 'metadata'))
      const skills = await Promise.all(parsed
        .filter(skill => skill.kind === 'skill')
        .map(skill => projectSkill(skill, this.config.skillsRoot)))
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
      const response = await this.ctx.manturAccount.request(`/api/v1/skills/${encodeURIComponent(slug)}`, {
        authenticated: false,
        headers: { 'X-ManturHub-Client': 'mantur-agent' },
        signal: AbortSignal.timeout(this.config.metadataTimeoutMs),
      })
      if (response === undefined || !response.ok) {
        throw new Error(`ManturHub Skill request failed with HTTP ${response?.status ?? 'unknown'}`)
      }
      const parsed = detailSchema.parse(await readManturHubJson(response, this.config.maxMetadataBytes, 'metadata'))
      if (parsed.slug !== slug) throw new Error('ManturHub returned a different Skill slug')
      return {
        ...await projectSkill(parsed, this.config.skillsRoot),
        usesOperators: parsed.uses_operators,
        ...(parsed.intro_md === undefined || parsed.intro_md === null ? {} : { introduction: parsed.intro_md }),
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
    const params = new URLSearchParams({ page: String(page), pageSize: String(recipePageSize), compact: 'true' })
    if (query.category !== undefined) params.set('cat', query.category)
    if (query.tag !== undefined) params.set('tag', query.tag.trim())
    if (query.query !== undefined) params.set('q', query.query.trim())
    try {
      const response = await this.ctx.manturAccount.request(`/api/v1/recipes?${params.toString()}`, {
        authenticated: false,
        headers: { 'X-ManturHub-Client': 'mantur-agent' },
        signal: AbortSignal.timeout(this.config.metadataTimeoutMs),
      })
      if (response === undefined || !response.ok) {
        throw new Error(`ManturHub Recipe catalog request failed with HTTP ${response?.status ?? 'unknown'}`)
      }
      const parsed = recipeCatalogSchema.parse(await readManturHubJson(response, this.config.maxMetadataBytes, 'metadata'))
      return {
        recipes: parsed.recipes.map(recipe => projectRecipe(recipe, response.url)),
        total: parsed.total,
        page: parsed.page,
        pageSize: parsed.page_size,
        totalPages: parsed.total_pages,
        availableTags: parsed.available_tags,
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
      const response = await this.ctx.manturAccount.request(`/api/v1/recipes/${encodeURIComponent(slug)}`, {
        authenticated: false,
        headers: { 'X-ManturHub-Client': 'mantur-agent' },
        signal: AbortSignal.timeout(this.config.metadataTimeoutMs),
      })
      if (response === undefined || !response.ok) {
        throw new Error(`ManturHub Recipe request failed with HTTP ${response?.status ?? 'unknown'}`)
      }
      const parsed = recipeDetailSchema.parse(await readManturHubJson(response, this.config.maxMetadataBytes, 'metadata'))
      if (parsed.slug !== slug) throw new Error('ManturHub returned a different Recipe slug')
      return {
        ...projectRecipe(parsed, response.url),
        sampleText: parsed.sample_text,
        promptTemplate: parsed.prompt_template,
        parameters: parsed.params_json,
        ...(parsed.source_url === '' ? {} : { sourceUrl: publicUrl(parsed.source_url, response.url) }),
        ...(parsed.source_name === '' ? {} : { sourceName: parsed.source_name }),
        ...(parsed.source_avatar_url === ''
          ? {}
          : { sourceAvatarUrl: publicUrl(parsed.source_avatar_url, response.url) }),
        models: parsed.models,
        agentPayload: parsed.agent_payload,
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
