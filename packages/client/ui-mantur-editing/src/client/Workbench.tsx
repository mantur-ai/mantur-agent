/** Session-specific editor beside the Mantur conversation. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchInjection } from './index.ts'
import { localEditorUrl } from '../settings.ts'
import type { EditingWorkspace } from '../types.ts'
import css from './Workbench.module.css'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Reopen editing for the selected conversation after a reload or explicit close.
 * @param props - Localized label and layout action.
 * @returns Session header action.
 */
export function EditingAction({ openWorkbench, t }: PropsLocale<'editing.mantur'> & { openWorkbench: () => void }) {
  return <button type="button" className={css.openAction} onClick={openWorkbench}>{t('open')}</button>
}

type Props = PropsRuntime<'main.workbench'> & PropsLocale<'editing.mantur'> & InjectFace<WorkbenchInjection>

/**
 * Render the full editor beside Mantur without starting another model turn.
 * @param props - slot-owned controls, settings hook, and localized copy.
 * @returns embedded editor or a configuration diagnostic.
 */
export function Workbench({
  useSessions, openWorkspace, closeWorkbench, getColorScheme, subscribeTheme, getLocale, subscribeLocale, t,
}: Props) {
  const sessionId = useSessions(s => s.current)
  const [revision, setRevision] = useState(0)
  const [workspace, setWorkspace] = useState<EditingWorkspace>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    setWorkspace(undefined)
    setError(undefined)
    if (sessionId !== undefined) void openWorkspace(sessionId).then((value) => {
      const editorUrl = localEditorUrl(value.editorUrl)
      if (active) setWorkspace({ ...value, editorUrl })
    }).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [sessionId, revision, openWorkspace])
  return <section className={css.workbench} aria-label={t('title')}>
    <header className={css.header}>
      <strong title={workspace?.directory ?? t('help')}>{t('title')}</strong>
      <button type="button" onClick={() => { setRevision(value => value + 1) }}>{t('reload')}</button>
      <button type="button" onClick={closeWorkbench}>{t('close')}</button>
    </header>
    {error !== undefined ? <p role="alert">{t('failed')}: {error}</p> : workspace !== undefined
      ? <ThemedEditor key={`${sessionId}:${revision}`} url={workspace.editorUrl} title={t('title')} getColorScheme={getColorScheme} subscribeTheme={subscribeTheme} getLocale={getLocale} subscribeLocale={subscribeLocale} />
      : <p role="status">{sessionId === undefined ? t('selectSession') : t('loading')}</p>}
  </section>
}

/** The initial URL stays fixed while later theme changes use the frame message channel. */
function ThemedEditor({ url, title, getColorScheme, subscribeTheme, getLocale, subscribeLocale }: Pick<WorkbenchInjection, 'getColorScheme' | 'subscribeTheme' | 'getLocale' | 'subscribeLocale'> & { url: string; title: string }) {
  const scheme = useSyncExternalStore(subscribeTheme, getColorScheme)
  const locale = useSyncExternalStore(subscribeLocale, getLocale)
  const frame = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => {
    const address = new URL(url)
    address.searchParams.set('manturTheme', scheme)
    address.searchParams.set('manturLocale', locale)
    return address.href
  })
  const sendTheme = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: 'mantur:theme', version: 1, scheme }, new URL(url).origin)
    frame.current?.contentWindow?.postMessage({ type: 'mantur:locale', version: 1, locale }, new URL(url).origin)
  }, [scheme, locale, url])
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
