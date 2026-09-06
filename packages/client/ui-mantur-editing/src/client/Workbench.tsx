/** Local editor remains mounted while the surrounding conversation changes. */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchInjection } from './index.ts'
import { localEditorUrl } from '../settings.ts'
import css from './Workbench.module.css'

type Props = PropsRuntime<'main.workbench'> & PropsLocale<'editing.mantur'> & InjectFace<WorkbenchInjection>

/**
 * Render the full editor beside Mantur without starting another model turn.
 * @param props - slot-owned controls, settings hook, and localized copy.
 * @returns embedded editor or a configuration diagnostic.
 */
export function Workbench({ usePreferences, closeWorkbench, t }: Props) {
  const preferences = usePreferences(s => s)
  const [revision, setRevision] = useState(0)
  let editorUrl: string | undefined
  let error: string | undefined
  if (preferences.value !== undefined) {
    try { editorUrl = localEditorUrl(preferences.value.editorUrl) }
    catch { error = t('invalidAddress') }
  }
  return <section className={css.workbench} aria-label={t('title')}>
    <header className={css.header}>
      <strong>{t('title')}</strong>
      <button type="button" onClick={() => { setRevision(value => value + 1) }}>{t('reload')}</button>
      <button type="button" onClick={closeWorkbench}>{t('close')}</button>
    </header>
    <p className={css.help}>{t('help')}</p>
    {error !== undefined ? <p role="alert">{error}</p> : editorUrl !== undefined
      ? <iframe key={revision} className={css.editor} src={editorUrl} title={t('title')} allow="autoplay; fullscreen; cross-origin-isolated" />
      : <p role="status">{preferences.status === 'loading' ? t('loading') : t('unavailable')}</p>}
  </section>
}
