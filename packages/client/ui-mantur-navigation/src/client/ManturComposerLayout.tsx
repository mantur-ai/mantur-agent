/** Mantur workspace footer using the conversation owner's existing controls. */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CreationGuide.module.css'

/**
 * Keep the resident editor in place and render the hero workspace control after it in focus order.
 * @param props - owner-created composer nodes and the current hero state.
 * @returns Mantur's visual and keyboard order without changing the supplied controls.
 */
export function ManturComposerLayout({ hero, heading, workspace, content }: PropsRuntime<'conversation.composer.layout'>) {
  return <>
    {heading}
    {content}
    {hero && <div className={css.workspaceFooter} data-workspace-footer>{workspace}</div>}
  </>
}
