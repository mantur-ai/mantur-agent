/** Host owner of Workspace navigation configuration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Config, WORKSPACE_SETTINGS_NAMESPACE } from './navigation-settings.ts'

export { Config }

/** Navigation configuration is available before the client chooses an initial Workspace. */
export const inject = ['settings']

/**
 * Expose the deployment's navigation choice through the ordinary settings owner.
 * @param ctx - Host settings context.
 * @param config - schema-resolved Workspace selection configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.settings.register(WORKSPACE_SETTINGS_NAMESPACE, Config, { base: config })
}
