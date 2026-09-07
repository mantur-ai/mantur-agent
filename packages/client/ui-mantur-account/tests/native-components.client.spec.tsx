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
  it('keeps the welcome artwork across login, registration and account settings', async () => {
    const b = bench()
    const artwork = () => {
      const image = b.container.querySelector('img[src="/mantoo-welcome@3x.png"]') as HTMLImageElement
      expect(image).not.toBeNull()
      expect([image.width, image.height, image.alt]).toEqual([72, 72, ''])
      expect(image.srcset).toBe('/mantoo-welcome@2x.png 2x, /mantoo-welcome@3x.png 3x')
    }
    artwork()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '注册账号' })) })
    artwork()
    b.rerender(<NativeAccountView {...b.props} showSkip={false} />)
    artwork()
    expect(b.run).toHaveBeenCalledExactlyOnceWith({ kind: 'sign-out' })
  })

  it('does not recheck rejected credentials and retries a failed logout through its exact action', async () => {
    const b = bench({ online: true, snapshot: signedOut, failure: { kind: 'remote', code: 'INVALID_CREDENTIALS' } })
    expect(b.queryByRole('button', { name: '重新检查登录状态' })).toBeNull()
    expect(b.queryByRole('button', { name: '重试' })).toBeNull()
    b.rerender(<NativeAccountView {...b.props} state={{ online: true, snapshot: signedOut, failure: { kind: 'logout-storage' } }} />)
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '退出登录' })) })
    expect(b.run).toHaveBeenCalledExactlyOnceWith({ kind: 'sign-out' })
  })

  it('handles registration without an invitation, duplicate code requests and explicit busy states', async () => {
    const b = bench()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '注册账号' })) })
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '发送验证码' })) })
    expect(b.run).toHaveBeenCalledTimes(1)
    const email = b.getByLabelText('邮箱') as HTMLInputElement
    fireEvent.change(email, { target: { value: 'creator@example.com' } })
    fireEvent.change(b.getByLabelText('密码', { exact: true }), { target: { value: 'transient password' } })
    const sending = Promise.withResolvers<{ ok: boolean }>()
    b.run.mockReturnValueOnce(sending.promise)
    fireEvent.click(b.getByRole('button', { name: '发送验证码' }))
    fireEvent.click(b.getByRole('button', { name: '发送验证码' }))
    expect(b.run).toHaveBeenCalledTimes(2)
    await act(async () => { sending.resolve({ ok: false }) })
    b.rerender(<NativeAccountView {...b.props} state={{ ...b.props.state, operation: 'send-code' }} />)
    expect((b.getByRole('button', { name: '正在发送…' }) as HTMLButtonElement).disabled).toBe(true)
    b.rerender(<NativeAccountView {...b.props} state={{ ...b.props.state, operation: 'register' }} />)
    expect((b.getByRole('button', { name: '正在提交注册…' }) as HTMLButtonElement).disabled).toBe(true)
    b.rerender(<NativeAccountView {...b.props} />)
    fireEvent.change(b.getByLabelText('邮箱验证码'), { target: { value: '123456' } })
    await act(async () => { fireEvent.submit(email.closest('form')!) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'register', email: 'creator@example.com', password: 'transient password', code: '123456' })
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '返回登录' })) })
    b.rerender(<NativeAccountView {...b.props} state={{ ...b.props.state, operation: 'password' }} />)
    expect((b.getByRole('button', { name: '正在登录…' }) as HTMLButtonElement).disabled).toBe(true)
    b.rerender(<NativeAccountView {...b.props} state={{ ...b.props.state, operation: 'sign-out' }} />)
    expect(b.getByRole('status').textContent).toBe('正在退出…')
    expect((b.getByRole('button', { name: '暂时跳过' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the native settings slot, retains unconfirmed identity and allows explicit refresh and revocation retry', async () => {
    const run = vi.fn(async () => ({ ok: true }))
    const state: NativeAccountViewState = { online: false, snapshot: { ...signedOut, phase: 'failed', authenticated: true,
      account: { email: 'creator@example.com', expiresAt: 1_999_999_999_999 }, pendingRevocations: 1 }, failure: { kind: 'network' } }
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

  it('labels fields, focuses the first invalid field, and preserves failed credentials without trimming a password', async () => {
    const b = bench()
    b.run.mockResolvedValue({ ok: false })
    fireEvent.submit(b.getByRole('button', { name: '登录' }).closest('form')!)
    const email = b.getByLabelText('邮箱') as HTMLInputElement
    const password = b.getByLabelText('密码', { exact: true }) as HTMLInputElement
    expect(document.activeElement).toBe(email)
    expect(b.getByText('请输入邮箱。')).toBeTruthy()
    expect(password.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(email, { target: { value: 'bad-email' } })
    fireEvent.blur(email)
    expect(b.getByText('请输入有效的邮箱地址。')).toBeTruthy()
    fireEvent.change(email, { target: { value: 'creator@example.com' } })
    fireEvent.change(password, { target: { value: ' keep my spaces ' } })
    await act(async () => { fireEvent.submit(email.closest('form')!) })
    expect(b.run).toHaveBeenCalledWith({ kind: 'password', email: 'creator@example.com', password: ' keep my spaces ', consent: true })
    expect(password.value).toBe(' keep my spaces ')
    expect(b.queryByText('keep my spaces')).toBeNull()
    expect(b.queryByText(/找回|重置密码/)).toBeNull()
    expect(b.getByText(zh.nativeModelNote)).toBeTruthy()
  })

  it('does not submit while IME composition is active, and permits password visibility without clearing it', async () => {
    const b = bench()
    const email = b.getByLabelText('邮箱') as HTMLInputElement
    const password = b.getByLabelText('密码', { exact: true }) as HTMLInputElement
    fireEvent.change(email, { target: { value: 'creator@example.com' } })
    fireEvent.change(password, { target: { value: 'transient password' } })
    fireEvent.click(b.getByRole('button', { name: '显示密码' }))
    expect(password.type).toBe('text')
    expect(password.value).toBe('transient password')
    fireEvent.click(b.getByRole('button', { name: '隐藏密码' }))
    expect(password.type).toBe('password')
    fireEvent.compositionStart(password)
    expect(fireEvent.keyDown(password, { key: 'Enter', isComposing: true })).toBe(false)
    fireEvent.submit(email.closest('form')!)
    expect(b.run).not.toHaveBeenCalled()
    fireEvent.compositionEnd(password)
    expect(fireEvent.keyDown(password, { key: 'Enter', isComposing: true })).toBe(false)
    expect(fireEvent.keyDown(password, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(password, { key: 'Tab' })).toBe(true)
    await act(async () => { fireEvent.submit(email.closest('form')!) })
    expect(b.run).toHaveBeenCalledOnce()
    expect(password.value).toBe('')
  })

  it('prevents same-tick duplicate submissions while Skip remains an explicit Main action', async () => {
    const b = bench()
    const pending = Promise.withResolvers<{ ok: boolean }>()
    b.run.mockReturnValueOnce(pending.promise)
    const email = b.getByLabelText('邮箱') as HTMLInputElement
    fireEvent.change(email, { target: { value: 'creator@example.com' } })
    fireEvent.change(b.getByLabelText('密码', { exact: true }), { target: { value: 'transient password' } })
    fireEvent.submit(email.closest('form')!)
    fireEvent.submit(email.closest('form')!)
    expect(b.run).toHaveBeenCalledOnce()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '暂时跳过' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'skip' })
    await act(async () => { pending.resolve({ ok: false }) })
  })

  it('registers with an optional invitation and shows activation, never an authorized account', async () => {
    const b = bench()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '注册账号' })) })
    expect(b.getByRole('heading', { name: '注册漫途账号' })).toBeTruthy()
    const email = b.getByLabelText('邮箱') as HTMLInputElement
    fireEvent.change(email, { target: { value: 'new@example.com' } })
    fireEvent.change(b.getByLabelText('密码', { exact: true }), { target: { value: 'new transient password' } })
    fireEvent.submit(email.closest('form')!)
    expect(document.activeElement).toBe(b.getByLabelText('邮箱验证码'))
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '发送验证码' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'send-code', email: 'new@example.com' })
    expect(b.getByRole('status').textContent).toBe(zh.nativeCodeSent)
    fireEvent.change(b.getByLabelText('邮箱验证码'), { target: { value: '123456' } })
    fireEvent.click(b.getByRole('button', { name: '有邀请码？' }))
    fireEvent.change(b.getByLabelText('邀请码（选填）'), { target: { value: 'creator-invite' } })
    await act(async () => { fireEvent.submit(email.closest('form')!) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'register', email: 'new@example.com', password: 'new transient password', code: '123456', invite_code: 'creator-invite' })
    b.rerender(<NativeAccountView {...b.props} state={{ online: true, snapshot: { ...signedOut, phase: 'pending-activation' } }} />)
    expect(b.getByRole('heading', { name: '注册申请已提交' })).toBeTruthy()
    expect(b.queryByText('已登录')).toBeNull()
    expect(b.queryByRole('button', { name: '重试' })).toBeNull()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '返回登录' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'sign-out' })
  })

  it('does not apply an old email code result after the email changes', async () => {
    const b = bench()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '注册账号' })) })
    const email = b.getByLabelText('邮箱') as HTMLInputElement
    fireEvent.change(email, { target: { value: 'first@example.com' } })
    const pending = Promise.withResolvers<{ ok: boolean }>()
    b.run.mockReturnValueOnce(pending.promise)
    fireEvent.click(b.getByRole('button', { name: '发送验证码' }))
    fireEvent.change(b.getByLabelText('邮箱验证码'), { target: { value: 'old-code' } })
    fireEvent.change(email, { target: { value: 'second@example.com' } })
    await act(async () => { pending.resolve({ ok: true }) })
    expect((b.getByLabelText('邮箱验证码') as HTMLInputElement).value).toBe('')
    expect(b.queryByText(zh.nativeCodeSent)).toBeNull()
  })

  it('opens Google through Main, then reopens or cancels only that waiting attempt', async () => {
    const b = bench()
    fireEvent.change(b.getByLabelText('密码', { exact: true }), { target: { value: 'clear-on-browser' } })
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '使用 Google 登录' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'browser' })
    expect((b.getByLabelText('密码', { exact: true }) as HTMLInputElement).value).toBe('')
    b.rerender(<NativeAccountView {...b.props} state={{ online: true, snapshot: { ...signedOut, phase: 'authorizing' } }} />)
    expect(b.getByText(zh.nativeGoogleWaiting)).toBeTruthy()
    expect(b.queryByRole('link')).toBeNull()
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '重新打开授权页' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'reopen-browser' })
    await act(async () => { fireEvent.click(b.getByRole('button', { name: '取消登录' })) })
    expect(b.run).toHaveBeenLastCalledWith({ kind: 'sign-out' })
    b.rerender(<NativeAccountView {...b.props} state={{ online: true, snapshot: { ...signedOut, phase: 'link-required' } }} />)
    expect(b.getByRole('heading', { name: '验证并关联现有账号' })).toBeTruthy()
    expect(b.queryByRole('button', { name: '确认关联' })).toBeNull()
  })

  it('keeps signed-in identity beside older pending revocations and confirms sign-out with Cancel focused', async () => {
    const state: NativeAccountViewState = { online: true, snapshot: { ...signedOut, phase: 'signed-in', authenticated: true,
      pendingRevocations: 1, account: { email: 'creator@example.com', expiresAt: 1_999_999_999_999 } } }
    const b = bench(state)
    expect(b.getByText(zh.nativeOldRevocationPending)).toBeTruthy()
    expect(b.getByText('creator@example.com')).toBeTruthy()
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
    expect((b.getByRole('button', { name: '登录' }) as HTMLButtonElement).disabled).toBe(true)
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
