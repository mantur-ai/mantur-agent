/** Native onboarding and Settings slots share the same Main subscription and action owner. */
import { useEffect } from 'react'
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
export type NativeAccountOnboardingProps = PropsRuntime<'settings.onboarding'> & InjectFace<NativeAccountInjected>
/** Native Settings surface props. */
export type NativeAccountSectionProps = PropsRuntime<'settings.section'> & InjectFace<NativeAccountInjected>

/** Complete only after a persisted Skip or active grant, never while cancellation or initial checking is pending. */
export function NativeAccountOnboarding({ useNativeAccount, complete, run, t, formatExpiry }: NativeAccountOnboardingProps) {
  const state = useNativeAccount(value => value)
  const completed = state.operation === undefined && state.snapshot?.busy === false
    && (state.snapshot.authenticated || (state.snapshot.skipped && state.failure === undefined))
  useEffect(() => { if (completed) complete() }, [completed, complete])
  if (completed) return null
  return <OnboardingSurface><div className={css.onboarding}>
    <NativeAccountView state={state} run={run} t={t} formatExpiry={formatExpiry} showSkip />
  </div></OnboardingSurface>
}

/** Keep account, revocation and model-configuration state separate in Settings. */
export function NativeAccountSection({ useNativeAccount, run, t, formatExpiry }: NativeAccountSectionProps) {
  const state = useNativeAccount(value => value)
  return <NativeAccountView state={state} run={run} t={t} formatExpiry={formatExpiry} />
}
