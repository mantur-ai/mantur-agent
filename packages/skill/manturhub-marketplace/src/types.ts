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
  readonly operatorId: string
  readonly costEstimate: string
  readonly priceDumplings: number
  readonly author: string
  readonly copies: number
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
  readonly agentPayload: string
}
