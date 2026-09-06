// @vitest-environment jsdom
/** Sidebar update presentation, including collapsed mode and indeterminate progress. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DesktopUpdate, type DesktopUpdateProps } from '../src/client/DesktopUpdate.tsx'
import type { NativeUpdateView, NativeUpdateState } from '../src/client/desktop-updates.ts'
import { zh } from '../src/client/update-locales.ts'

afterEach(cleanup)
function props(state: NativeUpdateState, wide = true): DesktopUpdateProps {
  const value: NativeUpdateView = { snapshot: { revision: 1, enabled: true, currentVersion: '1.0.0', state } }
  return { useSessions: vi.fn() as never, useSessionPendingInteraction: vi.fn() as never, useWorkspaces: vi.fn() as never,
    wide, t: makeTranslate(zh), controller: { run: vi.fn() } as unknown as DesktopUpdateProps['controller'],
    useUpdates: ((selector: (value: NativeUpdateView) => unknown) => selector(value)) as DesktopUpdateProps['useUpdates'] }
}

describe('desktop update footer', () => {
  it('leaves no persistent card when idle or current', () => {
    const view = render(<DesktopUpdate {...props({ kind: 'idle' })} />)
    expect(view.container.textContent).toBe('')
    view.rerender(<DesktopUpdate {...props({ kind: 'up-to-date', requestedByUser: false })} />)
    expect(view.container.textContent).toBe('')
  })
  it.each([true, false])('offers an explicit download in wide=%s mode', (wide) => {
    const value = props({ kind: 'available', version: '1.2.0', prompting: false }, wide)
    const run = vi.spyOn(value.controller, 'run')
    render(<DesktopUpdate {...value} />)
    fireEvent.click(screen.getByRole('button', { name: /下载更新/u }))
    expect(run).toHaveBeenCalledExactlyOnceWith('download')
  })
  it('shows actual bytes and omits aria-valuenow for an unknown total', () => {
    const view = render(<DesktopUpdate {...props({ kind: 'downloading', version: '1.2.0', percent: null, transferred: 2048, total: null })} />)
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false)
    expect(screen.getByText('已下载 2.0 KiB')).toBeTruthy()
    view.rerender(<DesktopUpdate {...props({ kind: 'downloading', version: '1.2.0', percent: 50, transferred: 2048, total: 4096 })} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
    expect(screen.getByText('50% · 2.0 KiB / 4.0 KiB')).toBeTruthy()
  })
  it('keeps installation explicit and shows a failed save without claiming installation', () => {
    const value = props({ kind: 'ready', version: '1.2.0', prompting: false, error: '保存失败' })
    const run = vi.spyOn(value.controller, 'run')
    render(<DesktopUpdate {...value} />)
    expect(screen.getByText('下载完成，重启安装')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('保存失败')
    fireEvent.click(screen.getByRole('button', { name: '重启并安装' }))
    expect(run).toHaveBeenCalledExactlyOnceWith('install')
  })
})
