/** Inject verified App instructions only for explicit version-qualified user references. */
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { isUserInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
import { loadBundledSkill, type BundledReadLimits } from './bundled-catalog.ts'
import { parseBundledSkillReference } from './bundled-manifest.ts'

/**
 * Register the App-specific slash gesture without changing ordinary Skill name resolution.
 * @param ctx - lifecycle owner for the pre-step listener.
 * @param root - explicitly configured read-only application resource directory.
 * @param limits - configured manifest and resource limits.
 */
export function registerBundledInvocations(ctx: Context, root: string | undefined, limits: BundledReadLimits): void {
  ctx.on('agent/pre-step', async ({ messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const references = new Set<string>()
    for (const message of messages) {
      if (message.source.kind !== 'user') continue
      for (const block of message.content) {
        if (block.type !== 'text') continue
        for (const match of block.text.matchAll(/(?:^|\s)\/mantur-builtin:[^\s]+/g)) {
          references.add(match[0].trim().slice('/mantur-builtin:'.length))
        }
      }
    }
    const injections = []
    for (const reference of references) {
      const loaded = await loadBundledSkill(root, parseBundledSkillReference(reference), limits, signal)
      if (!isUserInvocable(loaded.skill)) throw new Error(`App-bundled Skill is not user-invocable: ${loaded.skill.name}`)
      signal.throwIfAborted()
      injections.push(createUserMessage({
        content: [{ type: 'text', text: renderSkillContent({ ...loaded.skill, provider: 'app-bundled',
          resourceBase: { kind: 'directory', path: loaded.directory } }) }],
        source: { kind: 'skill-invocation', name: loaded.skill.name, form: 'instructions',
          bundled: { version: loaded.identity.version, digest: loaded.identity.digest } },
      }))
    }
    return injections.length === 0 ? decision : { ...decision, messages: [...decision.messages, ...injections] }
  })
}
