/** Native onboarding and Settings slots share the same Main subscription and action owner. */
import { useEffect, useState } from 'react'
import { OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeAccountViewState } from './native-account.ts'
import { NativeAccountView, type NativeAccountViewProps } from './NativeAccountView.tsx'
import css from './NativeAccountView.module.css'

/** Framework-bound observation and narrow Main operations; components never receive the client controller. */
export interface NativeAccountInjected extends Pick<NativeAccountViewProps, 'run' | 't' | 'formatExpiry'> {
  hooks: { nativeAccount: SnapshotStore<NativeAccountViewState> }
}

/** Native first-run surface props. */
export type NativeAccountOnboardingProps = PropsRuntime<'shell.overlay'> & InjectFace<NativeAccountInjected>
/** Native Settings surface props. */
export type NativeAccountSectionProps = PropsRuntime<'settings.section'> & InjectFace<NativeAccountInjected>

/** Require an active grant at startup, including profiles that previously skipped sign-in. */
export function NativeAccountOnboarding({ useNativeAccount, run, t, formatExpiry }: NativeAccountOnboardingProps) {
  const state = useNativeAccount(value => value)
  const [verified, setVerified] = useState(false)
  const completed = state.operation === undefined && state.snapshot?.busy === false
    && state.snapshot.authenticated
  useEffect(() => { if (completed) setVerified(true) }, [completed])
  if (completed || verified) return null
  return <OnboardingSurface><div className={css.welcome}>
    <NativeAccountView state={state} run={run} t={t} formatExpiry={formatExpiry} />
  </div></OnboardingSurface>
}

/** Keep account, revocation and model-configuration state separate in Settings. */
export function NativeAccountSection({ useNativeAccount, run, t, formatExpiry }: NativeAccountSectionProps) {
  const state = useNativeAccount(value => value)
  return <NativeAccountView state={state} run={run} t={t} formatExpiry={formatExpiry} />
}
