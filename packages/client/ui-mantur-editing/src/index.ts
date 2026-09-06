/** Host registration for the opt-in local editing workbench. */
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { EditingSettingsSchema, localEditorUrl, type EditingSettings } from './settings.ts'

/** Explicit local editor address selected by the application profile. */
export type Config = EditingSettings
/** Validate the profile's required editor address. */
export const Config: z<Config> = z.object({ editorUrl: z.string().required() })
/** Required host settings registry. */
export const inject = ['settings']

/**
 * Register the address without exposing transport credentials to the browser.
 * @param ctx - plugin context.
 * @param config - explicit editor address.
 */
export function apply(ctx: Context, config: Config): void {
  const editorUrl = localEditorUrl(config.editorUrl)
  ctx.settings.register('ui-mantur-editing', EditingSettingsSchema, { base: { editorUrl } })
}
