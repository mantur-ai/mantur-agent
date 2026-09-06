/** Compact native update action above Settings in either sidebar width. */
import { IconDownloadOutline16, IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeUpdates, NativeUpdateView } from './desktop-updates.ts'
import css from './DesktopUpdate.module.css'

/** Main-process state and explicit actions supplied by the plugin. */
export interface DesktopUpdateInjected {
  controller: NativeUpdates
  hooks: { updates: SnapshotStore<NativeUpdateView> }
}

/** Sidebar geometry, localized copy, and observable native state. */
export type DesktopUpdateProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'updates.mantur'> & InjectFace<DesktopUpdateInjected>

function bytes(value: number): string {
  if (value < 1024) return `${Math.floor(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

/** Render only actionable or active native update status; normal browser pages render nothing. */
export function DesktopUpdate({ wide, controller, useUpdates, t }: DesktopUpdateProps) {
  const { snapshot, failure } = useUpdates(value => value)
  if (snapshot === undefined || !snapshot.enabled) return null
  const state = snapshot.state
  if (state.kind === 'idle' || state.kind === 'up-to-date' || (state.kind === 'error' && !state.requestedByUser)) return null
  const version = 'version' in state ? state.version : ''
  const title = state.kind === 'available' ? t('available').replace('{version}', version)
    : state.kind === 'downloading' ? t('downloading').replace('{version}', version)
      : state.kind === 'ready' ? t('ready') : state.kind === 'checking' ? t('checking') : t('failed')
  const busy = state.kind === 'checking' || state.kind === 'downloading' || (state.kind === 'ready' && state.prompting)
  const action = state.kind === 'available' ? 'download' : state.kind === 'ready' ? 'install' : 'check'
  const label = state.kind === 'available' ? t('download') : state.kind === 'ready' ? (state.prompting ? t('preparing') : t('install')) : t('retry')
  const detail = failure ?? (state.kind === 'ready' ? state.error : state.kind === 'error' ? state.detail : undefined)
  const progress = state.kind === 'downloading' ? (
    <div className={css.progress} role="progressbar" aria-label={t('progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent ?? undefined}>
      {state.percent !== null && <span style={{ width: `${state.percent}%` }} />}
    </div>
  ) : null
  if (!wide) return (
    <Tooltip label={`${title}${detail === undefined ? '' : ` · ${detail}`}`}>
      <div className={css.rail}>
        <button type="button" aria-label={`${title} · ${label}`} disabled={busy} onClick={() => { controller.run(action) }}>
          {state.kind === 'ready' ? <IconRefreshOutline16 /> : <IconDownloadOutline16 />}
        </button>
        {state.kind === 'downloading' && <span className={css.railPercent}>{state.percent === null ? '…' : `${state.percent}%`}</span>}
        {progress}
      </div>
    </Tooltip>
  )
  return (
    <section className={css.update} aria-label={title}>
      <p className={css.title}>{title}</p>
      {state.kind === 'downloading' && <>
        {progress}
        <p className={css.bytes}>{state.percent !== null && `${state.percent}% · `}{state.total === null
          ? t('transferred').replace('{bytes}', bytes(state.transferred))
          : t('known').replace('{received}', bytes(state.transferred)).replace('{total}', bytes(state.total))}</p>
      </>}
      {detail !== undefined && <p className={css.error} role="alert">{t('error').replace('{detail}', detail)}</p>}
      {state.kind !== 'downloading' && state.kind !== 'checking' && <button type="button" disabled={busy} onClick={() => { controller.run(action) }}>{label}</button>}
    </section>
  )
}
