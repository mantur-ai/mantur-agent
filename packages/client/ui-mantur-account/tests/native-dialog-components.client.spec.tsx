// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { NativeAccountDialog, type NativeAccountDialogProps } from '../src/client/NativeAccountDialog.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('reuses the native form, keeps Escape inside the requested dialog and restores focus on return', async () => {
  const source = document.createElement('button')
  document.body.append(source)
  source.focus()
  const close = vi.fn()
  const otherEscape = vi.fn()
  document.addEventListener('keydown', otherEscape)
  const run = vi.fn(async () => ({ ok: true }))
  const props = (open: boolean) => ({
    useStore: (select: (state: { open: boolean }) => unknown) => select({ open }),
    useNativeAccount: (select: (state: unknown) => unknown) => select({ online: true, snapshot: {
      phase: 'signed-out', authenticated: false, skipped: true, busy: false, pendingRevocations: 0,
    } }), close, run, t: (key: keyof typeof zh) => zh[key], formatExpiry: String,
  } as unknown as NativeAccountDialogProps)
  try {
    const view = render(<NativeAccountDialog {...props(false)} />)
    expect(view.queryByRole('dialog')).toBeNull()
    view.rerender(<NativeAccountDialog {...props(true)} />)
    expect(view.getByRole('dialog', { name: '登录漫途账号' })).toBeTruthy()
    expect(document.activeElement).toBe(view.getByRole('button', { name: '返回创作' }))
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(otherEscape).toHaveBeenCalledOnce()
    otherEscape.mockClear()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    expect(otherEscape).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '暂时跳过' })) })
    expect(run).toHaveBeenCalledWith({ kind: 'skip' })
    fireEvent.click(view.getByRole('button', { name: '返回创作' }))
    expect(close).toHaveBeenCalledTimes(2)
    view.rerender(<NativeAccountDialog {...props(false)} />)
    expect(document.activeElement).toBe(source)
    view.rerender(<NativeAccountDialog {...props(true)} />)
    source.remove()
    view.unmount()
  } finally { document.removeEventListener('keydown', otherEscape); source.remove() }
})

it('can close when the original document had no focused element', () => {
  const active = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null)
  const view = render(<NativeAccountDialog {...{
    useStore: (select: (state: { open: boolean }) => unknown) => select({ open: true }),
    useNativeAccount: (select: (state: unknown) => unknown) => select({ online: true }),
    close: () => {}, run: async () => ({ ok: false }), t: (key: keyof typeof zh) => zh[key], formatExpiry: String,
  } as unknown as NativeAccountDialogProps} />)
  view.unmount()
  active.mockRestore()
})
