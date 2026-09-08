/** Browser authorization controls; Main owns attempts, callbacks and credentials. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { NativeAccountAction } from '@deepseek-ai/dsh-authorization-manturhub/types'
import type { NativeAccountOutcome, NativeAccountViewState } from './native-account.ts'
import type { ManturAccountKey } from './locales.ts'
import { nativeFailureKey } from './native-locales.ts'
import css from './NativeAccountView.module.css'

/** Narrow operations and localized render values used by both native entry points. */
export interface NativeAccountViewProps {
  state: NativeAccountViewState
  run: (action: NativeAccountAction) => Promise<NativeAccountOutcome>
  t: (key: ManturAccountKey) => string
  formatExpiry: (time: number) => string
  showSkip?: boolean
}

function SignOutConfirmation({ run, t, cancel }: Pick<NativeAccountViewProps, 'run' | 't'> & { cancel: () => void }): ReactNode {
  const cancelButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelButton.current?.focus() }, [])
  return <div className={css.form}>
    <strong>{t('nativeSignOutTitle')}</strong>
    <p>{t('nativeSignOutDescription')}</p>
    <div className={css.codeRow}>
      <button type="button" ref={cancelButton} onClick={cancel}>{t('nativeCancel')}</button>
      <button type="button" onClick={() => { void run({ kind: 'sign-out' }) }}>{t('signOut')}</button>
    </div>
  </div>
}

/** Present only Main-confirmed account results; Skip never bypasses its persistence operation. */
export function NativeAccountView(props: NativeAccountViewProps): ReactNode {
  const { state, run, t, formatExpiry, showSkip } = props
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const snapshot = state.snapshot
  const busy = state.operation !== undefined || snapshot === undefined || snapshot.busy
  const waiting = snapshot !== undefined && (snapshot.phase === 'authorizing' || snapshot.phase === 'link-required')
  const pending = snapshot?.phase === 'pending-activation'
  const signedIn = snapshot?.authenticated === true
  useEffect(() => { if (!signedIn) setConfirmSignOut(false) }, [signedIn])
  const titleKey: ManturAccountKey = signedIn ? 'nav' : pending ? 'nativePendingExisting'
    : waiting ? 'nativeBrowserTitle' : 'onboardingTitle'
  const titleId = useId()
  const failure = state.failure

  return <section className={css.panel} aria-labelledby={titleId}>
    <header className={css.header}>
      <div><h1 id={titleId}><img src="/mantur-logo.png" alt="" width={24} height={24} />{t(titleKey)}</h1>
        {!signedIn && !pending && !waiting && <p>{t('nativeBrowserDescription')}</p>}
      </div>
    </header>
    {snapshot === undefined && failure === undefined && <p role="status">{t('nativeChecking')}</p>}
    {!state.online && <p className={css.note} role="status">{t(signedIn ? 'nativeUnconfirmed' : 'nativeOffline')}</p>}
    {failure !== undefined && <p className={css.error} role="alert">
      {t(signedIn && failure.kind === 'network' ? 'nativeUnconfirmed' : nativeFailureKey(failure))}
    </p>}
    {snapshot !== undefined && snapshot.pendingRevocations > 0 && <div className={css.notice}>
      <p>{t(signedIn ? 'nativeOldRevocationPending' : 'nativeRevocationPending')}</p>
      {!state.online && <p className={css.note}>{t('nativeOfflineRevocation')}</p>}
      <button type="button" disabled={busy || !state.online} onClick={() => { void run({ kind: 'retry-revocations' }) }}>{t('nativeRetryRevocation')}</button>
    </div>}
    {signedIn ? <div className={css.form}>
      <strong role="status">{t('signedIn')}</strong>
      <span>{snapshot.account?.displayName}</span>
      {snapshot.account !== undefined && <p className={css.note}>
        {t('nativeExpiryLabel')} <time dateTime={new Date(snapshot.account.expiresAt).toISOString()}>{formatExpiry(snapshot.account.expiresAt)}</time>
      </p>}
      <p className={css.note}>{t('nativeExpiryNote')}</p>
      {confirmSignOut ? <SignOutConfirmation run={run} t={t} cancel={() => { setConfirmSignOut(false) }} />
        : <button type="button" disabled={busy} onClick={() => { setConfirmSignOut(true) }}>{t('signOut')}</button>}
      <button type="button" disabled={busy || !state.online}
        onClick={() => { void run({ kind: 'switch-account' }) }}>{t('nativeSwitchAccount')}</button>
    </div> : pending ? <div className={css.form}>
      <p role="status">{t('nativePending')}</p>
      <button type="button" onClick={() => { void run({ kind: 'sign-out' }) }}>{t('nativeBack')}</button>
    </div> : waiting ? <div className={css.form}>
      <p role="status">{t('nativeBrowserWaiting')}</p>
      <button type="button" disabled={busy || !state.online} onClick={() => { void run({ kind: 'reopen-browser' }) }}>{t('nativeReopen')}</button>
      <button type="button" onClick={() => { void run({ kind: 'sign-out' }) }}>{t('cancel')}</button>
    </div> : <div className={css.form}>
      <button type="button" className={css.primary} disabled={busy || !state.online}
        onClick={() => { void run({ kind: snapshot?.attempt?.exchangePending === true ? 'refresh' : 'browser' }) }}>
        {t(state.operation === 'browser' ? 'preparing' : snapshot?.attempt?.exchangePending === true ? 'nativeResumeExchange' : 'login')}
      </button>
      {snapshot?.attempt !== undefined && <button type="button"
        onClick={() => { void run({ kind: 'sign-out' }) }}>{t('cancel')}</button>}
    </div>}
    {failure !== undefined && ['network', 'transport', 'unavailable', 'protocol', 'resume-required'].includes(failure.kind)
      && <button type="button" className={css.textButton} disabled={busy}
        onClick={() => { void run({ kind: 'refresh' }) }}>{t('nativeRecheck')}</button>}
    {failure?.kind === 'logout-storage' && <button type="button" disabled={busy}
      onClick={() => { void run({ kind: 'sign-out' }) }}>{t('signOut')}</button>}
    {showSkip && !signedIn && <button type="button" className={css.skip}
      disabled={state.operation === 'skip' || state.operation === 'sign-out'} onClick={() => { void run({ kind: 'skip' }) }}>{t('skip')}</button>}
    {state.operation === 'sign-out' && <p role="status">{t('signingOut')}</p>}
  </section>
}
