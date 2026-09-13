/** Native Mantur credit balance at the sidebar foot. */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountBalanceState } from './balance.ts'
import css from './AccountBalance.module.css'

/** Framework-owned balance observation and number formatting. */
export interface AccountBalanceInjected {
  hooks: { balance: SnapshotStore<AccountBalanceState> }
  formatBalance: (value: number) => string
}

/** Sidebar geometry, localized copy and the account balance. */
export type AccountBalanceProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'settings.manturAccount'>
  & InjectFace<AccountBalanceInjected>

/** Show a genuine zero separately from loading, signed-out and failed reads. */
export function AccountBalance({ wide, useBalance, formatBalance, t }: AccountBalanceProps) {
  const state = useBalance(value => value)
  const hasBalance = state.phase === 'ready' || state.phase === 'refreshing'
  const value = hasBalance ? formatBalance(state.balance) : '—'
  const status = state.phase === 'signed-out' ? t('balanceSignedOut') : state.phase === 'failed'
    ? t('balanceFailed') : state.phase === 'ready' ? value : t('balanceLoading')
  const label = `${t('balanceTitle')} · ${status}`
  return <Tooltip label={label}>
    <section className={wide ? css.balance : css.rail} aria-label={t('balanceTitle')}>
      <svg className={css.icon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 15c0-5.5 3.7-10 9-10s9 4.5 9 10c0 3-3 4-9 4s-9-1-9-4Z" fill="currentColor" />
        <path d="M8 9c.5-1 1.4-1.8 2.5-2.1M12 8c.7-.5 1.5-.7 2.3-.6" stroke="white" strokeOpacity=".75" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className={css.value} role="status" aria-live="polite" aria-label={label}
        aria-busy={state.phase === 'refreshing' || state.phase === 'loading'}>{value}</span>
    </section>
  </Tooltip>
}
