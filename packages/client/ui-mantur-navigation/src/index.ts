/** Host registration for Mantur creation-guide preferences. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { GUIDE_NAMESPACE, GuideRecommendationsSchema, GuideSettingsSchema, type GuideConfig } from './guide-settings.ts'

/** Product-owned recommendation IDs, independent of Agent configuration. */
export type Config = GuideConfig
/** Validate the recommendation lists supplied by the Mantur profile. */
export const Config: z<Config> = z.object({ recommendations: GuideRecommendationsSchema })

/**
 * Register durable mode and dismissal preferences with the configured recommendations.
 * @param ctx - Host context carrying user settings.
 * @param config - product-owned recommendation lists.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (scope) => {
    scope.settings.register(GUIDE_NAMESPACE, GuideSettingsSchema, {
      base: { ...config, mode: 'script', closed: false },
    })
  })
}
