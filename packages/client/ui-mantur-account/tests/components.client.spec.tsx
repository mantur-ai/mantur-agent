// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { AccountOnboarding, type AccountOnboardingProps } from '../src/client/AccountOnboarding.tsx'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import { AccountView } from '../src/client/AccountView.tsx'
import { en } from '../src/client/locales.ts'
import type { ManturAccountState } from '../src/client/store.ts'

const t = (key: keyof typeof en): string => en[key]

function controller() {
  return {
    load: vi.fn(() => Promise.resolve()),
    start: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  }
}

function useState(state: ManturAccountState) {
  return (selector: (value: ManturAccountState) => ManturAccountState) => selector(state)
}

afterEach(cleanup)

describe('Mantur account components', () => {
  it('renders signed-in identity and signs out', () => {
    const actions = controller()
    const view = render(<AccountView
      state={{ phase: 'signed-in', account: { email: 'artist@example.com' } }}
      controller={actions as never}
      t={t}
    />)

    expect(view.getByText('artist@example.com')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Sign out' }))
    expect(actions.signOut).toHaveBeenCalledOnce()
  })

  it('uses confirmed display names and tolerates an account with no public metadata', () => {
    const actions = controller()
    const b = render(<AccountView state={{ phase: 'signed-in', account: { displayName: 'Creator' } }}
      controller={actions as never} t={t} />)
    expect(b.getByText('Creator')).toBeTruthy()
    b.rerender(<AccountView state={{ phase: 'signed-in' }} controller={actions as never} t={t} />)
    expect(b.queryByText('Creator')).toBeNull()
    expect(b.getByText(en.signedIn)).toBeTruthy()
  })

  it('renders device instructions and cancels login', () => {
    const actions = controller()
    const view = render(<AccountView
      state={{
        phase: 'authorizing',
        login: {
          attemptId: 'attempt-1' as never,
          verificationUrl: 'https://hub.mantur.ai/device',
          userCode: 'MANT-1234',
          expiresAt: 10_000,
        },
      }}
      controller={actions as never}
      t={t}
    />)

    expect(view.getByText('MANT-1234')).toBeTruthy()
    expect(view.getByRole('link', { name: 'Continue in browser' }).getAttribute('target')).toBe('_blank')
    fireEvent.click(view.getByRole('button', { name: 'Cancel sign-in' }))
    expect(actions.cancel).toHaveBeenCalledOnce()
  })

  it('renders signed-out, busy, and failed controls', () => {
    const actions = controller()
    const skip = vi.fn()
    const view = render(<AccountView
      state={{ phase: 'signed-out' }} controller={actions as never} t={t} showSkip onSkip={skip}
    />)
    fireEvent.click(view.getByRole('button', { name: 'Sign in to Mantur' }))
    fireEvent.click(view.getByRole('button', { name: 'Not now' }))
    expect(actions.start).toHaveBeenCalledOnce()
    expect(skip).toHaveBeenCalledOnce()

    view.rerender(<AccountView state={{ phase: 'starting' }} controller={actions as never} t={t} showSkip />)
    expect((view.getByRole('button', { name: 'Preparing sign-in…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: 'Not now' }) as HTMLButtonElement).disabled).toBe(true)

    view.rerender(<AccountView state={{ phase: 'failed' }} controller={actions as never} t={t} />)
    expect(view.getByText('Sign-in did not complete. Try again.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    expect(actions.start).toHaveBeenCalledTimes(2)

    view.rerender(<AccountView state={{ phase: 'signing-out' }} controller={actions as never} t={t} />)
    expect((view.getByRole('button', { name: 'Sign in to Mantur' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(['idle', 'loading', 'signed-in'] as const)('hides onboarding in %s phase', (phase) => {
    const actions = controller()
    const complete = vi.fn()
    const state: ManturAccountState = phase === 'signed-in'
      ? { phase, account: { email: 'artist@example.com' } }
      : { phase }
    const props = {
      complete,
      controller: actions,
      t,
      useAccount: useState(state),
    } as unknown as AccountOnboardingProps
    const view = render(<AccountOnboarding {...props} />)

    expect(view.container.childElementCount).toBe(0)
    if (phase === 'idle') expect(actions.load).toHaveBeenCalledOnce()
    else expect(actions.load).not.toHaveBeenCalled()
    if (phase === 'signed-in') expect(complete).toHaveBeenCalledOnce()
    else expect(complete).not.toHaveBeenCalled()
  })

  it('renders onboarding and completes the temporary skip', () => {
    const actions = controller()
    const complete = vi.fn()
    const props = {
      complete,
      controller: actions,
      t,
      useAccount: useState({ phase: 'signed-out' }),
    } as unknown as AccountOnboardingProps
    const view = render(<AccountOnboarding {...props} />)

    expect(view.getByRole('heading', { name: 'Sign in to Mantur' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Not now' }))
    expect(complete).toHaveBeenCalledOnce()
  })

  it('loads an idle Settings section and renders a settled one without reloading', () => {
    const actions = controller()
    const idleProps = {
      controller: actions,
      t,
      useAccount: useState({ phase: 'idle' }),
    } as unknown as AccountSectionProps
    const view = render(<AccountSection {...idleProps} />)
    expect(actions.load).toHaveBeenCalledOnce()

    const signedOutProps = {
      controller: actions,
      t,
      useAccount: useState({
        phase: 'signed-out',
      }),
    } as unknown as AccountSectionProps
    view.rerender(<AccountSection {...signedOutProps} />)
    expect(actions.load).toHaveBeenCalledOnce()
    expect(view.getByText('Not signed in to Mantur')).toBeTruthy()
  })
})
