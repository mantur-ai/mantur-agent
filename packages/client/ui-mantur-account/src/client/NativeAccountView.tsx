/** Native account forms and server-driven results, with no credential persistence in the renderer. */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { z } from 'zod'
import type { NativeAccountAction } from '@deepseek-ai/dsh-authorization-manturhub/types'
import type { NativeAccountOutcome, NativeAccountViewState } from './native-account.ts'
import type { ManturAccountKey } from './locales.ts'
import { nativeFailureKey } from './native-locales.ts'
import { googleLogo } from './google-logo.ts'
import css from './NativeAccountView.module.css'

/** Narrow operations and localized render values used by both native entry points. */
export interface NativeAccountViewProps {
  state: NativeAccountViewState
  run: (action: NativeAccountAction) => Promise<NativeAccountOutcome>
  t: (key: ManturAccountKey) => string
  formatExpiry: (time: number) => string
  showSkip?: boolean
}

type Field = 'email' | 'password' | 'code'

function NativeAccountForm({ state, run, t, registering, setRegistering }: NativeAccountViewProps & {
  registering: boolean
  setRegistering: (registering: boolean) => void
}): ReactNode {
  const prefix = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<Field, ManturAccountKey>>>({})
  const form = useRef<HTMLFormElement>(null)
  const pending = useRef(false)
  const composing = useRef(false)
  const emailRevision = useRef(0)
  const busy = state.operation !== undefined || state.snapshot === undefined || state.snapshot.busy

  function validate(fields: readonly Field[], focus = true): boolean {
    const next: Partial<Record<Field, ManturAccountKey>> = {}
    for (const field of fields) {
      if (field === 'email') {
        if (email.length === 0) next.email = 'nativeEmailRequired'
        else if (!z.email().max(320).safeParse(email).success) next.email = 'nativeEmailInvalid'
      } else if (field === 'password' && password.length === 0) next.password = 'nativePasswordRequired'
      else if (field === 'code' && code.length === 0) next.code = 'nativeCodeRequired'
    }
    setErrors(next)
    const first = fields.find(field => next[field] !== undefined)
    if (first !== undefined && focus) (form.current?.elements.namedItem(first) as HTMLInputElement | null)?.focus()
    return first === undefined
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (composing.current || pending.current || busy || !state.online
      || !validate(registering ? ['email', 'password', 'code'] : ['email', 'password'])) return
    pending.current = true
    try {
      const result = await run(registering
        ? { kind: 'register', email, password, code, ...(invite.length === 0 ? {} : { invite_code: invite }) }
        : { kind: 'password', email, password, consent: true })
      if (result.ok) { setPassword(''); setCode('') }
    } finally { pending.current = false }
  }

  async function sendCode(): Promise<void> {
    if (pending.current || busy || !state.online || !validate(['email'])) return
    pending.current = true
    setCodeSent(false)
    const revision = emailRevision.current
    try {
      const result = await run({ kind: 'send-code', email })
      if (revision === emailRevision.current) setCodeSent(result.ok)
    }
    finally { pending.current = false }
  }

  const inputProps = (field: Field) => ({
    id: `${prefix}-${field}`, name: field, required: true,
    'aria-invalid': errors[field] !== undefined,
    'aria-describedby': errors[field] === undefined ? undefined : `${prefix}-${field}-error`,
    onBlur: () => { validate([field], false) },
  })
  const error = (field: Field) => errors[field] === undefined ? null
    : <span className={css.error} id={`${prefix}-${field}-error`}>{t(errors[field])}</span>

  return (
    <form ref={form} className={css.form} noValidate aria-busy={busy} onSubmit={(event) => { void submit(event) }}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
      onKeyDown={(event) => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing)) event.preventDefault() }}>
      <div className={css.field}>
        <label htmlFor={`${prefix}-email`}>{t('nativeEmail')}</label>
        <input {...inputProps('email')} type="email" autoComplete="username" maxLength={320} value={email}
          onChange={(event) => { ++emailRevision.current; setEmail(event.target.value); setCode(''); setCodeSent(false) }} />
        {error('email')}
      </div>
      <div className={css.field}>
        <label htmlFor={`${prefix}-password`}>{t('nativePassword')}</label>
        <div className={css.password}>
          <input {...inputProps('password')} type={showPassword ? 'text' : 'password'}
            autoComplete={registering ? 'new-password' : 'current-password'} maxLength={1_024} value={password}
            onChange={(event) => { setPassword(event.target.value) }} />
          <button type="button" className={css.reveal} aria-pressed={showPassword}
            onClick={() => { setShowPassword(!showPassword) }}>{t(showPassword ? 'nativeHidePassword' : 'nativeShowPassword')}</button>
        </div>
        {error('password')}
      </div>
      {registering && <>
        <div className={css.field}>
          <label htmlFor={`${prefix}-code`}>{t('nativeCode')}</label>
          <div className={css.codeRow}>
            <input {...inputProps('code')} autoComplete="one-time-code" maxLength={100} value={code}
              onChange={(event) => { setCode(event.target.value) }} />
            <button type="button" disabled={busy || !state.online} onClick={() => { void sendCode() }}>
              {t(state.operation === 'send-code' ? 'nativeSendingCode' : 'nativeSendCode')}
            </button>
          </div>
          {error('code')}
          {codeSent && <span className={css.note} role="status">{t('nativeCodeSent')}</span>}
        </div>
        <button type="button" className={css.textButton} aria-expanded={showInvite}
          onClick={() => { setShowInvite(!showInvite) }}>{t('nativeHaveInvite')}</button>
        {showInvite && <div className={css.field}>
          <label htmlFor={`${prefix}-invite`}>{t('nativeInvite')}</label>
          <input id={`${prefix}-invite`} autoComplete="off" maxLength={128} value={invite}
            onChange={(event) => { setInvite(event.target.value) }} />
        </div>}
      </>}
      {!registering && <p className={css.note}>{t('nativeConsent')}</p>}
      <button type="submit" className={css.primary} disabled={busy || !state.online}>
        {t(registering ? state.operation === 'register' ? 'nativeRegistering' : 'nativeRegister'
          : state.operation === 'password' ? 'nativeLoggingIn' : 'nativeLogin')}
      </button>
      {!registering && <button type="button" className={css.google} disabled={busy || !state.online} onClick={() => {
        setPassword(''); void run({ kind: 'browser' })
      }}><img src={googleLogo} alt="" width={20} height={20} />{t('nativeGoogle')}</button>}
      <div className={css.switchRow}>
        {!registering && <span className={css.note}>{t('nativeNoAccount')}</span>}
        <button type="button" className={css.textButton} onClick={() => {
          setPassword(''); setCode(''); setRegistering(!registering)
          void run({ kind: 'sign-out' })
        }}>{t(registering ? 'nativeBack' : 'nativeRegister')}</button>
      </div>
    </form>
  )
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
  const [registering, setRegistering] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const snapshot = state.snapshot
  const busy = state.operation !== undefined || snapshot?.busy === true
  const waiting = snapshot !== undefined && (snapshot.phase === 'authorizing' || snapshot.phase === 'link-required')
    && state.operation !== 'password' && state.operation !== 'register'
  const pending = snapshot?.phase === 'pending-activation'
  const signedIn = snapshot?.authenticated === true
  useEffect(() => { if (!signedIn) setConfirmSignOut(false) }, [signedIn])
  const titleKey: ManturAccountKey = signedIn ? 'nav' : pending ? registering ? 'nativePendingTitle' : 'nativePendingExisting'
    : waiting ? snapshot.phase === 'link-required' ? 'nativeLinkTitle' : 'nativeGoogleTitle'
      : registering ? 'nativeRegisterTitle' : 'onboardingTitle'
  const titleId = useId()
  const failure = state.failure

  return <section className={css.panel} aria-labelledby={titleId}>
    <header className={css.header}>
      <div><h1 id={titleId}><img src="/mantur-logo.png" alt="" width={24} height={24} />{t(titleKey)}</h1>
        {!signedIn && !pending && !waiting && <p>{t(registering ? 'nativeRegisterDescription' : 'nativeDescription')}</p>}
      </div>
      <img className={css.mascot} src="/mantou-clapper.png" alt="" width={72} height={72} />
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
      <span>{snapshot.account?.email}</span>
      {snapshot.account !== undefined && <p className={css.note}>
        {t('nativeExpiryLabel')} <time dateTime={new Date(snapshot.account.expiresAt).toISOString()}>{formatExpiry(snapshot.account.expiresAt)}</time>
      </p>}
      <p className={css.note}>{t('nativeExpiryNote')}</p>
      {confirmSignOut ? <SignOutConfirmation run={run} t={t} cancel={() => { setConfirmSignOut(false) }} />
        : <button type="button" disabled={busy} onClick={() => { setConfirmSignOut(true) }}>{t('signOut')}</button>}
    </div> : pending ? <div className={css.form}>
      <p role="status">{t('nativePending')}</p>
      <button type="button" onClick={() => { setRegistering(false); void run({ kind: 'sign-out' }) }}>{t('nativeBack')}</button>
    </div> : waiting ? <div className={css.form}>
      <p role="status">{t(snapshot.phase === 'link-required' ? 'nativeLink' : 'nativeGoogleWaiting')}</p>
      <button type="button" disabled={busy || !state.online} onClick={() => { void run({ kind: 'reopen-browser' }) }}>{t('nativeReopen')}</button>
      <button type="button" onClick={() => { void run({ kind: 'sign-out' }) }}>{t('cancel')}</button>
    </div> : <NativeAccountForm key={registering ? 'register' : 'login'} {...props} registering={registering} setRegistering={setRegistering} />}
    {failure !== undefined && ['network', 'transport', 'unavailable', 'protocol', 'resume-required'].includes(failure.kind)
      && <button type="button" className={css.textButton} disabled={busy}
        onClick={() => { void run({ kind: 'refresh' }) }}>{t('nativeRecheck')}</button>}
    {failure?.kind === 'logout-storage' && <button type="button" disabled={busy}
      onClick={() => { void run({ kind: 'sign-out' }) }}>{t('signOut')}</button>}
    {showSkip && !signedIn && <button type="button" className={css.skip}
      disabled={state.operation === 'skip' || state.operation === 'sign-out'} onClick={() => { void run({ kind: 'skip' }) }}>{t('skip')}</button>}
    {state.operation === 'sign-out' && <p role="status">{t('signingOut')}</p>}
    <p className={css.modelNote}>{t('nativeModelNote')}</p>
  </section>
}
