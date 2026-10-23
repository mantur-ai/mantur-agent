/** Browser-safe ManturHub marketplace contracts. */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Installing requires a current ManturHub account grant. */
    'mantur-marketplace/auth-required': {}
    /** An existing local directory is untracked or differs from its installed hash. */
    'mantur-marketplace/local-conflict': { readonly slug: string }
  }
}

/** Exact App resource identity captured by a homepage selection. */
export interface ManturBundledSkillIdentity {
  readonly name: string
  readonly version: string
  readonly digest: string
}

/** Offline homepage entry pinned to the running application's resource manifest. */
export interface ManturBundledSkill extends ManturBundledSkillIdentity {
  readonly reference: string
  readonly title: string
  readonly source: 'app-bundled'
}

/** Result of checking one recommended Skill against the active online source. */
export type ManturBundledSkillUpdate =
  | { readonly name: string; readonly status: 'verified' }
  | {
    readonly name: string
    readonly status: 'failed'
    readonly stage: 'metadata' | 'download' | 'verification'
    readonly error: string
    readonly localError?: string
  }

/** Available verified resources and independent online update outcomes. */
export interface ManturBundledSkillsUpdateResult {
  readonly skills: readonly ManturBundledSkill[]
  readonly updates: readonly ManturBundledSkillUpdate[]
}

/** One public Skill card returned by ManturHub. */
export interface ManturMarketplaceSkill {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly category: string
  readonly version: string
  readonly triggers: readonly string[]
  readonly logoUrl?: string
  readonly installed: boolean
}

/** Complete catalog snapshot used for reliable local search and categories. */
export interface ManturMarketplaceCatalog {
  readonly skills: readonly ManturMarketplaceSkill[]
  readonly installedCount: number
  readonly signedIn: boolean
}

/** Public Skill detail without credentials or executable bundle contents. */
export interface ManturMarketplaceSkillDetail extends ManturMarketplaceSkill {
  readonly usesOperators: readonly string[]
  readonly introduction?: string
}

/** Host-confirmed installation result. */
export interface ManturMarketplaceInstallResult {
  readonly slug: string
  readonly version: string
  readonly installed: true
}

/** JSON value retained from one published Recipe's reproducible parameters. */
export type ManturRecipeJsonValue =
  | null | boolean | number | string
  | ManturRecipeJsonValue[]
  | { readonly [key: string]: ManturRecipeJsonValue }

/** Public Recipe category currently served by ManturHub. */
export type ManturRecipeCategory = 'video' | 'image' | 'script'

/** Public Recipe media kind currently served by ManturHub. */
export type ManturRecipeSampleKind = 'video' | 'image'

/** One public Recipe card returned by ManturHub. */
export interface ManturMarketplaceRecipe {
  readonly slug: string
  readonly title: string
  readonly summary: string
  readonly category: ManturRecipeCategory
  readonly tags: readonly string[]
  readonly coverUrl: string
  readonly sampleUrl: string
  readonly sampleKind: ManturRecipeSampleKind
  readonly operatorId: string | null
  readonly costEstimate: string | null
  readonly priceDumplings: number | null
  readonly author: string | null
  readonly copies: number | null
  readonly publishedAt: string
}

/** Paginated public Recipe catalog returned to the browser. */
export interface ManturMarketplaceRecipeCatalog {
  readonly recipes: readonly ManturMarketplaceRecipe[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly totalPages: number
  readonly availableTags: readonly string[]
}

/** Server-side filters for the public Recipe catalog. */
export interface ManturMarketplaceRecipeQuery {
  readonly page?: number
  readonly category?: ManturRecipeCategory
  readonly tag?: string
  readonly query?: string
}

/** Public Recipe detail and the authoritative instructions submitted to Agent. */
export interface ManturMarketplaceRecipeDetail extends ManturMarketplaceRecipe {
  readonly sampleText: string
  readonly promptTemplate: string
  readonly parameters: ManturRecipeJsonValue
  readonly sourceUrl?: string
  readonly sourceName?: string
  readonly sourceAvatarUrl?: string
  readonly models: readonly string[]
  /** Published input requirements, preserved without inferred values. */
  readonly inputSchema: Readonly<Record<string, ManturRecipeJsonValue>>
  /** Ordered production steps; a missing note does not imply execution instructions. */
  readonly steps: readonly { readonly operatorCode: string; readonly note: string | null }[]
  readonly agentPayload: string
}

/** A locally available skill and its persistent user-controlled switch. */
export interface ManturInstalledSkill {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly source: 'bundled' | 'local'
  readonly enabled: boolean
}
