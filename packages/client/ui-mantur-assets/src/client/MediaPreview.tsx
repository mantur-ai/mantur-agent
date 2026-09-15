/** Explicit remote URLs or Host-validated local media; failed media stays visible as an error. */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssetCommands } from './AssetsPanel.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import styles from './AssetsPanel.module.css'

type Props = PropsLocale<'assets.mantur'> & {
  path: string
  kind: 'image' | 'video'
  name: string
  session: SessionId
  binding: string
  resolveBound: AssetCommands['media']
  resolve: AssetCommands['preview']
  thumbnail?: boolean
}
/** @param props - Explicit report binding and scoped local resolver. @returns Sized media or its loading/error state. */
export function MediaPreview({ path, kind, name, session, binding, resolveBound, resolve, t, thumbnail = false }: Props) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setUrl(''); setError('')
    if (!path) return
    if (binding) {
      void resolveBound(session, binding).then((media) => { if (current) setUrl(media.url) }, (cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : t('error')) })
    } else if (/^https?:\/\//i.test(path)) setUrl(path)
    else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) setError(t('invalidMedia'))
    else void resolve(session, path).then((media) => {
      if (current) setUrl(media.url)
    }, (cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : t('error')) })
    return () => { current = false }
  }, [path, session, binding, resolveBound, resolve, t])
  return <div className={styles.media} data-thumbnail={thumbnail}>
    {error ? <span role={thumbnail ? undefined : 'alert'}>{t('mediaError')} {error}</span>
      : !path ? <span>{t(kind === 'video' ? 'noVideo' : 'noImage')}</span>
        : !url ? <span>{t('loading')}</span>
          : kind === 'image' ? <img src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => { setError(t('unavailable')) }} />
            : <video aria-label={name} src={url} controls={!thumbnail} muted={thumbnail} preload="metadata" onError={() => { setError(t('unavailable')) }} />}
  </div>
}
