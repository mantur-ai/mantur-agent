/** Mantur workspace footer using the conversation owner's existing controls. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AutomaticProjectState } from './automatic-project.ts'
import css from './CreationGuide.module.css'

/** Creation status and recovery actions for the unassigned draft. */
export interface ManturComposerInjected {
  hooks: { automaticProject: SnapshotStore<AutomaticProjectState> }
  reloadRoot: () => Promise<void>
}

/**
 * Keep the resident editor in place and render the hero workspace control after it in focus order.
 * @param props - owner-created composer nodes and the current hero state.
 * @returns Mantur's visual and keyboard order without changing the supplied controls.
 */
export function ManturComposerLayout({ hero, heading, workspace, content, sessionId,
  useAutomaticProject, reloadRoot, t,
}: PropsRuntime<'conversation.composer.layout'> & InjectFace<ManturComposerInjected> & PropsLocale<'projects.mantur'>) {
  const project = useAutomaticProject(state => state)
  return <>
    {heading}
    {content}
    {hero && <div className={css.workspaceFooter} data-workspace-footer>
      {sessionId === undefined && (project.preparing || project.error !== null) && <div className={css.projectStatus}>
        {project.preparing && <p role="status">{t('creating')}</p>}
        {project.error !== null && <p role="alert">{project.error}
          {project.settings === undefined && <button type="button" disabled={project.loading || project.choosing} onClick={() => { void reloadRoot() }}>{t('retry')}</button>}
          {(project.settings === undefined || project.settings.source === 'unconfigured') && <span>{t('settingsHint')}</span>}
        </p>}
      </div>}
      {workspace}
    </div>}
  </>
}
