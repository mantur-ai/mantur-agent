/** Native update settings and a sidebar entry shown only for discovered updates. */
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

/** Settings row with the same native controller and status subscription. */
export type DesktopUpdateSettingsProps = PropsRuntime<'settings.general.item'> & PropsLocale<'updates.mantur'> & InjectFace<DesktopUpdateInjected>

type UpdateContentProps = Pick<DesktopUpdateProps, 'wide' | 'controller' | 'useUpdates' | 't'> & { onlyAvailable: boolean }

function bytes(value: number, t: DesktopUpdateProps['t']): string {
  if (value < 1024) return `${Math.floor(value)} ${t('unit.bytes')}`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} ${t('unit.kibibytes')}`
  return `${(value / (1024 * 1024)).toFixed(1)} ${t('unit.mebibytes')}`
}

function UpdateContent({ wide, controller, useUpdates, t, onlyAvailable }: UpdateContentProps) {
  const { snapshot, failure } = useUpdates(value => value)
  if (snapshot === undefined || !snapshot.enabled) return null
  const state = snapshot.state
  if (onlyAvailable && state.kind !== 'available' && state.kind !== 'downloading' && state.kind !== 'ready') return null
  const currentVersion = t('currentVersion').replace('{version}', snapshot.currentVersion)
  const version = 'version' in state ? state.version : ''
  const title = state.kind === 'available' ? t('available').replace('{version}', version)
    : state.kind === 'downloading' ? t('downloading').replace('{version}', version)
      : state.kind === 'ready' ? t('ready') : state.kind === 'checking' ? t('checking')
        : state.kind === 'idle' ? currentVersion : state.kind === 'up-to-date' ? t('upToDate') : t('failed')
  const busy = state.kind === 'checking' || state.kind === 'downloading' || (state.kind === 'ready' && state.prompting)
  const action = state.kind === 'available' ? 'download' : state.kind === 'ready' ? 'install' : 'check'
  const label = state.kind === 'available' ? t('download') : state.kind === 'ready' ? (state.prompting ? t('preparing') : t('install'))
    : state.kind === 'error' ? t('retry') : t('check')
  const detail = failure ?? (state.kind === 'ready' ? state.error : state.kind === 'error' && state.requestedByUser ? state.detail : undefined)
  const progress = state.kind === 'downloading' ? (
    <div className={css.progress} role="progressbar" aria-label={t('progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent ?? undefined}>
      {state.percent !== null && <span style={{ width: `${state.percent}%` }} />}
    </div>
  ) : null
  if (!wide) return (
    <Tooltip label={`${title} · ${label}${detail === undefined ? '' : ` · ${detail}`}`}>
      <div className={css.rail}>
        <button type="button" aria-label={`${title} · ${label}`} disabled={busy} onClick={() => { controller.run(action) }}>
          {action === 'download' || state.kind === 'downloading' ? <IconDownloadOutline16 /> : <IconRefreshOutline16 />}
        </button>
        {state.kind === 'downloading' && <span className={css.railPercent}>{state.percent === null ? '…' : `${state.percent}%`}</span>}
        {progress}
      </div>
    </Tooltip>
  )
  return (
    <section className={css.update} aria-label={title}>
      <p className={css.title}>{title}</p>
      {state.kind !== 'idle' && <p className={css.bytes}>{currentVersion}</p>}
      {state.kind === 'downloading' && <>
        {progress}
        <p className={css.bytes}>{state.percent !== null && `${state.percent}% · `}{state.total === null
          ? t('transferred').replace('{bytes}', bytes(state.transferred, t))
          : t('known').replace('{received}', bytes(state.transferred, t)).replace('{total}', bytes(state.total, t))}</p>
      </>}
      {detail !== undefined && <p className={css.error} role="alert">{t('error').replace('{detail}', detail)}</p>}
      {state.kind !== 'downloading' && state.kind !== 'checking' && <button type="button" disabled={busy} onClick={() => { controller.run(action) }}>{label}</button>}
    </section>
  )
}

/** Show discovered updates and their download or installation progress above Settings. */
export function DesktopUpdate(props: DesktopUpdateProps) {
  return <UpdateContent {...props} onlyAvailable />
}

/** Keep manual checks, current-version status, and retry actions inside General settings. */
export function DesktopUpdateSettings(props: DesktopUpdateSettingsProps) {
  return <UpdateContent {...props} wide onlyAvailable={false} />
}
