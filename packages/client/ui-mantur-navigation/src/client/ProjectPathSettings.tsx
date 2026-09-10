/** Feature-owned default project location in the shared General settings page. */
import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AutomaticProjectState } from './automatic-project.ts'
import css from './ProjectPathSettings.module.css'

/** The same project state and native directory picker used by first-send preparation. */
export interface ProjectPathSettingsInjected {
  hooks: { automaticProject: SnapshotStore<AutomaticProjectState> }
  chooseRoot: () => Promise<void>
  reloadRoot: () => Promise<void>
}

/**
 * Show the persisted root and open the existing native directory picker.
 * @param props - project owner callbacks, observable state and localized copy.
 * @returns a General settings row that keeps long paths readable.
 */
export function ProjectPathSettings({ useAutomaticProject, chooseRoot, reloadRoot, t }:
  PropsRuntime<'settings.general.item'> & InjectFace<ProjectPathSettingsInjected> & PropsLocale<'projects.mantur'>) {
  const project = useAutomaticProject(state => state)
  useEffect(() => { void reloadRoot() }, [reloadRoot])
  return <div className={css.row} role="group" aria-label={t('location')}>
    <div className={css.text}>
      <div className={css.title}>{t('location')}</div>
      <div className={css.path}>{project.loading ? t('loading') : project.settings === undefined
        || project.settings.source === 'unconfigured' ? t('unconfigured') : project.settings.rootPath}</div>
      <p className={css.description}>{t('futureOnly')}</p>
      {project.error !== null && <div className={css.failure}>
        <p role="alert">{project.error}</p>
        <button type="button" disabled={project.loading || project.choosing} onClick={() => { void reloadRoot() }}>{t('retry')}</button>
      </div>}
    </div>
    <button type="button" className={css.change} disabled={project.choosing}
      onClick={() => { void chooseRoot() }}>{t(project.choosing ? 'changing' : 'change')}</button>
  </div>
}
