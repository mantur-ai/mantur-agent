// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { NativeAccountSnapshot } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { NativeAccountView, type NativeAccountViewProps } from '../src/client/NativeAccountView.tsx'
import { NativeAccountOnboarding, NativeAccountSection,
  type NativeAccountOnboardingProps, type NativeAccountSectionProps } from '../src/client/NativeAccountSurfaces.tsx'
import { nativeFailureKey, nativeZh } from '../src/client/native-locales.ts'
import { zh } from '../src/client/locales.ts'
import type { NativeAccountViewState } from '../src/client/native-account.ts'

afterEach(cleanup)
const signedOut: NativeAccountSnapshot = { phase: 'signed-out', busy: false, authenticated: false, skipped: false, pendingRevocations: 0 }

function bench(state: NativeAccountViewState = { online: true, snapshot: signedOut }) {
  const run = vi.fn<NativeAccountViewProps['run']>(async () => ({ ok: true }))
  const props: NativeAccountViewProps = { state, run, t: key => zh[key],
    formatExpiry: time => new Date(time).toISOString(), showSkip: true }
  return { ...render(<NativeAccountView {...props} />), props, run }
}

describe('native account controls', () => {
  it('offers browser sign-in without password fields, a mascot or model disclaimers', async () => {
    const b = bench()
    expect(b.getByRole('heading', { name: '登录漫途账号' })).toBeTruthy()
    expect(b.container.querySelector('input')).toBeNull()
    expect(b.container.querySelector('img[src*="mantoo"]')).toBeNull()
    expect(b.queryByText(zh.nativeModelNote)).toBeNull()
    expect(b.queryByRole('button', { name: '使用 Google 登录' })).toBeNull()
    const login = b.getByRole('button', { name: '登录漫途账号' })
    login.focus()
    expect(document.activeElement).toBe(login)
    await act(async () => { fireEvent.click(login) })
    expect(b.run).toHaveBeenCalledExactlyOnceWith({ kind: 'browser' })
    expect(b.queryByText('已登录')).toBeNull()
  })

  it('keeps sign-in disabled until state is known, while offline or while Main is busy', () => {
    const b = bench({ online: true })
    expect((b.getByRole('button', { name: '登录漫途账号' }) as HTMLButtonElement).disabled).toBe(true)
    for (const state of [
      { online: false, snapshot: signedOut },
      { online: true, snapshot: { ...signedOut, busy: true } },
    ]) {
      b.rerender(<NativeAccountView {...b.props} state={state} />)
      expect((b.getByRole('button', { name: '登录漫途账号' }) as HTMLButtonElement).disabled).toBe(true)
    }
    b.rerender(<NativeAccountView {...b.props} state={{ online: true, snapshot: signedOut, operation: 'browser' }} />)
    expect((b.getByRole('button', { name: '正在准备登录…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('waits for Main confirmation and reopens or cancels the current browser attempt', async () => {
    const b = bench({ online: true, snapshot: { ...signedOut, phase: 'authorizing' } })
    expect(b.getByRole('heading', { name: zh.nativeBrowserTitle })).toBeTruthy()
    expect(b.getByRole('status').textContent).toBe(zh.nativeBrowserWaiting)
    expect(b.queryByText('已登录')).toBeNull()
    expect(b.queryByRole('link')).toBeNull()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '重新打开授权页' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'reopen-browser' })
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '取消登录' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'sign-out' })
    b.rerender(<NativeAccountView {...b.props} state={{ online: true, snapshot: { ...signedOut, phase: 'pending-activation' } }} />)
    expect(b.queryByText('已登录')).toBeNull()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '返回登录' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'sign-out' })
  })

  it('does not recheck rejected credentials and retries a failed logout through its exact action', async () => {
    const b = bench({ online: true, snapshot: signedOut, failure: { kind: 'remote', code: 'INVALID_CREDENTIALS' } })
    expect(b.queryByRole('button', { name: '重新检查登录状态' })).toBeNull()
    expect(b.queryByRole('button', { name: '重试' })).toBeNull()
    b.rerender(<NativeAccountView {...b.props} state={{ online: true, snapshot: signedOut, failure: { kind: 'logout-storage' } }} />)
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '退出登录' })) })
    expect(b.run).toHaveBeenCalledExactlyOnceWith({ kind: 'sign-out' })
  })

  it('renders the native settings slot, retains unconfirmed identity and allows explicit refresh and revocation retry', async () => {
    const run = vi.fn(async () => ({ ok: true }))
    const state: NativeAccountViewState = { online: false, snapshot: { ...signedOut, phase: 'failed', authenticated: true,
      account: { displayName: 'Test creator', expiresAt: 1_999_999_999_999 }, pendingRevocations: 1 }, failure: { kind: 'network' } }
    const props = { run, t: (key: keyof typeof zh) => zh[key], formatExpiry: String,
      useNativeAccount: (select: (value: NativeAccountViewState) => NativeAccountViewState) => select(state),
    } as unknown as NativeAccountSectionProps
    const b = render(<NativeAccountSection {...props} />)
    expect(b.getByRole('alert').textContent).toBe(zh.nativeUnconfirmed)
    expect(b.queryByRole('button', { name: '暂时跳过' })).toBeNull()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '重新检查登录状态' })) })
    expect(run).toHaveBeenLastCalledWith({ kind: 'refresh' })
    b.rerender(<NativeAccountView state={{ ...state, online: true, failure: { kind: 'local' } }} run={run}
      t={key => zh[key]} formatExpiry={String} />)
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '重试撤销' })) })
    expect(run).toHaveBeenLastCalledWith({ kind: 'retry-revocations' })
    expect(b.getByRole('alert').textContent).toBe(zh.nativeLocalFailure)
  })

  it('keeps signed-in identity beside older pending revocations and confirms sign-out with Cancel focused', async () => {
    const state: NativeAccountViewState = { online: true, snapshot: { ...signedOut, phase: 'signed-in', authenticated: true,
      pendingRevocations: 1, account: { displayName: 'Test creator', expiresAt: 1_999_999_999_999 } } }
    const b = bench(state)
    expect(b.getByText(zh.nativeOldRevocationPending)).toBeTruthy()
    expect(b.getByText('Test creator')).toBeTruthy()
    expect(b.container.querySelector('time')?.dateTime).toBe(new Date(1_999_999_999_999).toISOString())
    fireEvent.click(b.getByRole('button', { name: '退出登录' }))
    expect(document.activeElement).toBe(b.getByRole('button', { name: '取消' }))
    expect(b.getByText(zh.nativeSignOutDescription)).toBeTruthy()
    fireEvent.click(b.getByRole('button', { name: '取消' }))
    expect(b.run).not.toHaveBeenCalled()
    fireEvent.click(b.getByRole('button', { name: '退出登录' }))
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '退出登录' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'sign-out' })
    b.rerender(<NativeAccountView {...b.props} state={{ online: false, snapshot: { ...signedOut, pendingRevocations: 1 } }} />)
    expect(b.getByText(zh.nativeRevocationPending)).toBeTruthy()
    expect(b.getByText(zh.nativeOfflineRevocation)).toBeTruthy()
    expect((b.getByRole('button', { name: '重试撤销' }) as HTMLButtonElement).disabled).toBe(true)
    expect((b.getByRole('button', { name: '登录漫途账号' }) as HTMLButtonElement).disabled).toBe(true)
    expect((b.getByRole('button', { name: '暂时跳过' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps an unknown check visible and never prints raw failure values', () => {
    const b = bench({ online: true })
    expect(b.getByText(zh.nativeChecking)).toBeTruthy()
    b.rerender(<NativeAccountView {...b.props} state={{ online: true, failure: { kind: 'private-secret' } }} />)
    expect(b.getByRole('alert').textContent).toBe(zh.failed)
    expect(b.container.textContent).not.toContain('private-secret')
    for (const [code, key] of [
      ['INVALID_CREDENTIALS', 'nativeInvalidCredentials'], ['ACCOUNT_DISABLED', 'nativeDisabled'],
      ['PENDING_ACTIVATION', 'nativePendingExisting'], ['RATE_LIMITED', 'nativeRateLimited'],
      ['EMAIL_TAKEN', 'nativeEmailTaken'], ['CREDENTIAL_EXPIRED', 'nativeExpired'],
    ] as const) expect(nativeZh[nativeFailureKey({ kind: 'remote', code }) as keyof typeof nativeZh]).toBe(zh[key])
  })

  it.each([
    [{ online: true, snapshot: { ...signedOut, skipped: true } }, true],
    [{ online: true, snapshot: { ...signedOut, skipped: true }, operation: 'skip' }, false],
    [{ online: true, snapshot: { ...signedOut, skipped: true }, failure: { kind: 'logout-storage' } }, false],
  ] as const)('completes onboarding only after confirmed Skip with no pending failure %#', (state, expected) => {
    const complete = vi.fn()
    const props = { complete, run: vi.fn(), t: (key: keyof typeof zh) => zh[key], formatExpiry: String,
      useNativeAccount: (select: (value: NativeAccountViewState) => NativeAccountViewState) => select(state),
    } as unknown as NativeAccountOnboardingProps
    render(<NativeAccountOnboarding {...props} />)
    expect(complete).toHaveBeenCalledTimes(expected ? 1 : 0)
  })
})
