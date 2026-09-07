/** Mantur workspace footer using the conversation owner's existing controls. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AutomaticProjectState } from './automatic-project.ts'
import css from './CreationGuide.module.css'

/** Location state and actions for the unassigned draft's project footer. */
export interface ManturComposerInjected {
  hooks: { automaticProject: SnapshotStore<AutomaticProjectState> }
  chooseRoot: () => Promise<void>
  reloadRoot: () => Promise<void>
}

/**
 * Keep the resident editor in place and render the hero workspace control after it in focus order.
 * @param props - owner-created composer nodes and the current hero state.
 * @returns Mantur's visual and keyboard order without changing the supplied controls.
 */
export function ManturComposerLayout({ hero, heading, workspace, content, sessionId,
  useAutomaticProject, chooseRoot, reloadRoot, t,
}: PropsRuntime<'conversation.composer.layout'> & InjectFace<ManturComposerInjected> & PropsLocale<'projects.mantur'>) {
  const project = useAutomaticProject(state => state)
  return <>
    {heading}
    {content}
    {hero && <div className={css.workspaceFooter} data-workspace-footer>
      {sessionId === undefined && <div className={css.automaticProject}>
        <details>
          <summary>{t('automatic')}</summary>
          <div className={css.projectLocation}>
            <span>{t('location')}</span>
            <code>{project.loading ? t('loading') : project.settings?.source === 'unconfigured'
              || project.settings === undefined ? t('unconfigured') : project.settings.rootPath}</code>
            <button type="button" disabled={project.choosing} onClick={() => { void chooseRoot() }}>{t(project.choosing ? 'changing' : 'change')}</button>
            <p>{t('futureOnly')}</p>
          </div>
        </details>
        {project.preparing && <p role="status">{t('creating')}</p>}
        {project.error !== null && <p role="alert">{project.error}
          {project.settings === undefined && <button type="button" onClick={() => { void reloadRoot() }}>{t('retry')}</button>}
        </p>}
      </div>}
      {workspace}
    </div>}
  </>
}
