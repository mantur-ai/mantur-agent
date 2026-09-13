// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AccountBalance, type AccountBalanceProps } from '../src/client/AccountBalance.tsx'
import type { AccountBalanceState } from '../src/client/balance.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('shows the localized amount in both sidebar widths without a refresh button', () => {
  const state: AccountBalanceState = { phase: 'ready', balance: 1234.5 }
  const props = { wide: true, useBalance: (select: (s: AccountBalanceState) => unknown) => select(state),
    formatBalance: (n: number) => new Intl.NumberFormat('en').format(n),
    t: (k: keyof typeof zh) => zh[k] } as AccountBalanceProps
  const view = render(<AccountBalance {...props} />)
  expect(view.queryByText('剩余馒头')).toBeNull()
  expect(view.container.querySelector('svg')).toBeTruthy()
  expect(view.queryByRole('button')).toBeNull()
  expect(view.getByText('1,234.5')).toBeTruthy()
  view.rerender(<AccountBalance {...props} wide={false} t={k => en[k as keyof typeof en]} />)
  expect(view.getByRole('region', { name: 'Mantou remaining' })).toBeTruthy()
  expect(view.getByText('1,234.5')).toBeTruthy()
})

it.each(['loading', 'signed-out', 'failed'] as const)('never displays a fabricated zero while %s', (phase) => {
  const state: AccountBalanceState = { phase }
  const props = { wide: true, useBalance: (select: (s: AccountBalanceState) => unknown) => select(state),
    formatBalance: String, t: (k: keyof typeof zh) => zh[k] } as AccountBalanceProps
  const view = render(<AccountBalance {...props} />)
  expect(view.queryByText('0')).toBeNull()
  expect(view.getByText('—')).toBeTruthy()
  expect(view.queryByRole('button')).toBeNull()
})
