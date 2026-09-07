/** Requested account view over the current page; closing preserves its project and draft. */
import { useEffect, useRef } from 'react'
import { OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createNativeAccountDialogStore } from './native-dialog.ts'
import type { NativeAccountInjected } from './NativeAccountSurfaces.tsx'
import { NativeAccountView } from './NativeAccountView.tsx'
import css from './NativeAccountView.module.css'

/** Shared native operations and an explicit return action. */
export type NativeAccountDialogInjected = NativeAccountInjected & { close: () => void }
/** Root overlay props; the framework owns visibility and native-state subscriptions. */
export type NativeAccountDialogProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createNativeAccountDialogStore>> & InjectFace<NativeAccountDialogInjected>

/** Render the same account form without replacing the originating page or its local interaction state. */
export function NativeAccountDialog({ useStore, useNativeAccount, close, run, t, formatExpiry }: NativeAccountDialogProps) {
  const open = useStore(state => state.open)
  const state = useNativeAccount(value => value)
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const origin = document.activeElement
    back.current?.focus()
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus()
    }
  }, [open, close])
  if (!open) return null
  return <OnboardingSurface><div className={css.onboarding} role="dialog" aria-modal="true" aria-label={t('onboardingTitle')}>
    <div className={css.panel}><button ref={back} type="button" className={css.textButton} onClick={close}>{t('nativeReturn')}</button></div>
    <NativeAccountView state={state} run={run} t={t} formatExpiry={formatExpiry} showSkip />
  </div></OnboardingSurface>
}
