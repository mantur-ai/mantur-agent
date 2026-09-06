/** Local editor remains mounted while the surrounding conversation changes. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
export function Workbench({ usePreferences, closeWorkbench, getColorScheme, subscribeTheme, t }: Props) {
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
      ? <ThemedEditor key={`${editorUrl}:${revision}`} url={editorUrl} title={t('title')} getColorScheme={getColorScheme} subscribeTheme={subscribeTheme} />
      : <p role="status">{preferences.status === 'loading' ? t('loading') : t('unavailable')}</p>}
  </section>
}

/** The initial URL stays fixed while later theme changes use the frame message channel. */
function ThemedEditor({ url, title, getColorScheme, subscribeTheme }: Pick<WorkbenchInjection, 'getColorScheme' | 'subscribeTheme'> & { url: string; title: string }) {
  const scheme = useSyncExternalStore(subscribeTheme, getColorScheme)
  const frame = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => {
    const address = new URL(url)
    address.searchParams.set('manturTheme', scheme)
    return address.href
  })
  const sendTheme = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: 'mantur:theme', version: 1, scheme }, new URL(url).origin)
  }, [scheme, url])
  useEffect(() => {
    sendTheme()
    const ready = (event: MessageEvent<unknown>) => {
      const data = event.data
      if (event.source === frame.current?.contentWindow && event.origin === new URL(url).origin
        && typeof data === 'object' && data !== null && 'type' in data && 'version' in data
        && data.type === 'mantur:theme-ready' && data.version === 1) sendTheme()
    }
    window.addEventListener('message', ready)
    return () => { window.removeEventListener('message', ready) }
  }, [sendTheme, url])
  return <iframe ref={frame} className={css.editor} src={src} title={title} onLoad={sendTheme} allow="autoplay; fullscreen; cross-origin-isolated" />
}
