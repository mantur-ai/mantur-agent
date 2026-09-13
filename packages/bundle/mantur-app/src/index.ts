/** ManTur Agent product identity enforced over the selected agent preset. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'

/** Stable Cordis plugin name. */
export const name = 'mantur-app'

/** Services required to enforce the deployment persona. */
export const inject = ['systemPrompt']

/** Mantur product identity configuration. */
export interface Config {
  /** Persona delivered in place of a generic agent-preset identity. */
  persona: string
}

/** Runtime schema for the Mantur product identity. */
export const Config: z<Config> = z.object({
  persona: z.string().required(),
})

/**
 * Replace the effective preset persona after cooperative prompt transforms.
 * @param ctx - Mantur application context.
 * @param config - Product persona owned by the Mantur profile.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    const persona = { name: PERSONA_SECTION, text: config.persona }
    const index = assembly.sections.findIndex(section => section.name === PERSONA_SECTION)
    return {
      ...assembly,
      sections: index === -1
        ? [persona, ...assembly.sections]
        : assembly.sections.map((section, current) => current === index ? persona : section),
    }
  })
}
