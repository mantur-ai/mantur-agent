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
  it('hides unsupported builds and missing snapshots', () => {
    const absent = props({ kind: 'idle' })
    absent.useUpdates = ((selector: (value: NativeUpdateView) => unknown) => selector({})) as DesktopUpdateProps['useUpdates']
    const view = render(<DesktopUpdate {...absent} />)
    expect(view.container.textContent).toBe('')
    const disabled = props({ kind: 'available', version: '1.2.0', prompting: false })
    disabled.useUpdates = ((selector: (value: NativeUpdateView) => unknown) => selector({
      snapshot: { revision: 1, enabled: false, currentVersion: '1', state: { kind: 'idle' } },
    })) as DesktopUpdateProps['useUpdates']
    view.rerender(<DesktopUpdate {...disabled} />)
    expect(view.container.textContent).toBe('')
  })
  it('keeps checks busy and lets an explicit failed check retry', () => {
    const view = render(<DesktopUpdate {...props({ kind: 'checking' })} />)
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<DesktopUpdate {...props({ kind: 'checking' }, false)} />)
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
    const retry = props({ kind: 'error', detail: 'feed offline', requestedByUser: true })
    const retryRun = vi.spyOn(retry.controller, 'run')
    view.rerender(<DesktopUpdate {...retry} />)
    expect(screen.getByRole('alert').textContent).toContain('feed offline')
    fireEvent.click(screen.getByRole('button'))
    expect(retryRun).toHaveBeenCalledExactlyOnceWith('check')
  })
  it('disables a pending installation confirmation in either sidebar width', () => {
    const ready = props({ kind: 'ready', version: '1.2.0', prompting: true })
    const view = render(<DesktopUpdate {...ready} />)
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
    view.rerender(<DesktopUpdate {...ready} wide={false} />)
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
    const install = props({ kind: 'ready', version: '1.2.0', prompting: false, error: 'save unavailable' }, false)
    const installRun = vi.spyOn(install.controller, 'run')
    view.rerender(<DesktopUpdate {...install} />)
    fireEvent.click(screen.getByRole('button'))
    expect(installRun).toHaveBeenCalledExactlyOnceWith('install')
  })
  it('shows the latest IPC failure without discarding the ready action', () => {
    const ready = props({ kind: 'ready', version: '1.2.0', prompting: false })
    ready.useUpdates = ((selector: (value: NativeUpdateView) => unknown) => selector({
      snapshot: { revision: 1, enabled: true, currentVersion: '1', state: { kind: 'ready', version: '1.2.0', prompting: false, error: 'older error' } },
      failure: 'IPC unavailable',
    })) as DesktopUpdateProps['useUpdates']
    render(<DesktopUpdate {...ready} />)
    expect(screen.getByRole('alert').textContent).toContain('IPC unavailable')
    expect(screen.queryByText('older error')).toBeNull()
  })
  it('shows rail percentages and localized byte units without inventing unknown progress', () => {
    const view = render(<DesktopUpdate {...props({ kind: 'downloading', version: '1.2.0', percent: null, transferred: 0, total: null }, false)} />)
    expect(screen.getByText('…')).toBeTruthy()
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false)
    view.rerender(<DesktopUpdate {...props({ kind: 'downloading', version: '1.2.0', percent: 25, transferred: 128, total: 512 }, false)} />)
    expect(screen.getByText('25%')).toBeTruthy()
    view.rerender(<DesktopUpdate {...props({ kind: 'downloading', version: '1.2.0', percent: 25, transferred: 128, total: 512 })} />)
    expect(screen.getByText('25% · 128 B / 512 B')).toBeTruthy()
    view.rerender(<DesktopUpdate {...props({ kind: 'downloading', version: '1.2.0', percent: null, transferred: 1048576, total: null })} />)
    expect(screen.getByText('已下载 1.0 MiB')).toBeTruthy()
  })
  it.each([true, false])('keeps manual checks available before and after discovery in wide=%s mode', (wide) => {
    const idle = props({ kind: 'idle' }, wide)
    const checkRun = vi.spyOn(idle.controller, 'run')
    const view = render(<DesktopUpdate {...idle} />)
    fireEvent.click(screen.getByRole('button', { name: /检查更新/u }))
    expect(checkRun).toHaveBeenCalledExactlyOnceWith('check')
    expect(view.container.innerHTML).toContain('1.0.0')
    view.rerender(<DesktopUpdate {...props({ kind: 'up-to-date', requestedByUser: false }, wide)} />)
    expect(screen.getByRole('button', { name: /检查更新/u })).toBeTruthy()
    expect(view.container.innerHTML).toContain('暂无可用更新')
    const failed = props({ kind: 'error', detail: 'feed unavailable', requestedByUser: false }, wide)
    const retryRun = vi.spyOn(failed.controller, 'run')
    view.rerender(<DesktopUpdate {...failed} />)
    expect(view.container.innerHTML).toContain('更新未完成')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /重新检查/u }))
    expect(retryRun).toHaveBeenCalledExactlyOnceWith('check')
    expect(view.container.innerHTML).not.toContain('暂无可用更新')
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
    fireEvent.click(screen.getByRole('button', { name: '重启并更新' }))
    expect(run).toHaveBeenCalledExactlyOnceWith('install')
  })
})
