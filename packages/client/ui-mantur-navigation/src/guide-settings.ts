/** Mantur creation-mode configuration and durable UI preferences. */

import z from '@deepseek-ai/schemastery'

/** Stable UI-only creation modes, in navigation order. */
export const CREATION_MODES = ['script', 'production', 'assets'] as const

/** Persisted creation-mode identifier; not an Agent preset. */
export type CreationMode = typeof CREATION_MODES[number]

/** Host settings namespace for the Mantur creation guide. */
export const GUIDE_NAMESPACE = 'ui-mantur-guide'

/** Ordered real marketplace slugs selected by the product composition. */
export interface GuideConfig {
  /** Ordered marketplace Skill slugs for each creation mode. */
  recommendations: Record<CreationMode, string[]>
}

/** Durable UI choices and composition-owned recommendations. */
export interface GuideSettings extends GuideConfig {
  mode: CreationMode
  closed: boolean
}

/** Product composition must explicitly select the recommended Skill IDs. */
export const GuideRecommendationsSchema = z.object({
  script: z.array(z.string()).required(),
  production: z.array(z.string()).required(),
  assets: z.array(z.string()).required(),
}).required()

/** First use selects script writing; the retired editing mode resolves explicitly to production. */
export const GuideSettingsSchema: z<GuideSettings> = z.object({
  recommendations: GuideRecommendationsSchema,
  mode: z.union([...CREATION_MODES, z.transform(z.const('editing'), () => 'production' as const)]).default('script'),
  closed: z.boolean().default(false),
})
