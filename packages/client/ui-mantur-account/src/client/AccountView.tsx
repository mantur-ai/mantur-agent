/** Shared Mantur account controls for onboarding and Settings. */

import type { ReactNode } from 'react'
import type { ManturAccountState, ManturAccountStore } from './store.ts'
import type { en } from './locales.ts'
import css from './AccountView.module.css'

/** Presentation dependencies shared by both account surfaces. */
export interface AccountViewProps {
  state: ManturAccountState
  controller: ManturAccountStore
  t: (key: keyof typeof en) => string
  showSkip?: boolean
  onSkip?: () => void
}

/** Render device authorization without accepting or displaying a secret. */
export function AccountView({ state, controller, t, showSkip, onSkip }: AccountViewProps): ReactNode {
  if (state.phase === 'signed-in') {
    return (
      <div className={css.stack}>
        <strong>{t('signedIn')}</strong>
        <span>{state.account === undefined ? '' : 'displayName' in state.account ? state.account.displayName : state.account.email}</span>
        <button type="button" onClick={() => { void controller.signOut() }}>{t('signOut')}</button>
      </div>
    )
  } else if (state.phase === 'authorizing' && state.login !== undefined) {
    return (
      <div className={css.stack}>
        <span>{t('codeLabel')}</span>
        <strong className={css.code}>{state.login.userCode}</strong>
        <a href={state.login.verificationUrl} target="_blank" rel="noreferrer">{t('openBrowser')}</a>
        <span>{t('waiting')}</span>
        <button type="button" onClick={() => { void controller.cancel() }}>{t('cancel')}</button>
      </div>
    )
  } else {
    const busy = state.phase === 'loading' || state.phase === 'starting' || state.phase === 'signing-out'
    return (
      <div className={css.stack}>
        <span>{state.phase === 'failed' ? t('failed') : t('signedOut')}</span>
        <button type="button" disabled={busy} onClick={() => { void controller.start() }}>
          {state.phase === 'starting' ? t('preparing') : state.phase === 'failed' ? t('retry') : t('login')}
        </button>
        {showSkip && <button type="button" disabled={busy} onClick={onSkip}>{t('skip')}</button>}
      </div>
    )
  }
}
