// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { AssetsPanel, type AssetCommands } from '../src/client/AssetsPanel.tsx'
import type { AssetKey, AssetSnapshot } from '../src/types.ts'

const snapshot = { source: { path: 'assets-report.json', version: 'v' as never, sha256: 's' }, stateVersion: null, state: { format: 1, path: 'assets-report.json', drafts: [], proposals: [], history: [], pending: null }, projectState: null, rows: [{ key: '角色资产/CHAR-001-V01', id: 'CHAR-001-V01', name: '林夏', table: '角色资产', fingerprint: 'f', kind: 'image' as const, prompt: '原提示词', negative: '', media: '', template: '', actualRequest: '', actualPrompt: '' }] } as unknown as AssetSnapshot

it('mounts the Chinese asset panel and drives load, save, and apply through production commands', async () => {
  const load = vi.fn(async () => snapshot); const save = vi.fn(async () => snapshot); const request = vi.fn(async () => 'request-1'); const apply = vi.fn(async () => snapshot)
  const view = render(<AssetsPanel {...({ useSessions: (select: (value: { current: string }) => unknown) => select({ current: 'session-1' }), t: (key: string) => ({ assets: '资产', source: '流水线报告', load: '读取', refresh: '刷新', prompt: '提示词', save: '保存草稿', request: '发送提案请求', apply: '应用提案', noMedia: '未绑定明确媒体', actual: '已保留实际请求', error: '资产操作失败' }[key] ?? key), closeWorkbench: vi.fn(), load, save, request, apply } as unknown as ComponentProps<typeof AssetsPanel>)} />)
  expect(screen.getByText('资产')).toBeTruthy(); fireEvent.click(screen.getByText('读取')); await waitFor(() => { expect(load).toHaveBeenCalled() })
  fireEvent.click(screen.getByText('CHAR-001-V01 林夏')); fireEvent.click(screen.getByText('保存草稿')); await waitFor(() => { expect(save).toHaveBeenCalled() })
  fireEvent.click(screen.getAllByRole('button', { name: '发送提案请求' })[0]!); await waitFor(() => { expect(request).toHaveBeenCalled() }); fireEvent.click(screen.getByText('应用提案')); await waitFor(() => { expect(apply).toHaveBeenCalled() })
  view.unmount()
})

it('shows a provider error without crashing the asset panel', async () => {
  const load = vi.fn(async () => { throw new Error('FS_STALE_VERSION') })
  const view = render(<AssetsPanel {...({ useSessions: (select: (value: { current: string }) => unknown) => select({ current: 'session-1' }), t: (key: string) => key, closeWorkbench: vi.fn(), load, save: vi.fn(), request: vi.fn(), apply: vi.fn() } as unknown as ComponentProps<typeof AssetsPanel>)} />)
  fireEvent.click(screen.getByText('load')); await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('FS_STALE_VERSION') })
  view.unmount()
})

it('shows persisted unfinished writes and requested proposals after loading', async () => {
  const pendingSnapshot = { ...snapshot, state: { ...snapshot.state, pending: { proposal: 'pending-1' }, proposals: [{ id: 'request-1', status: 'requested' }] } }
  const view = render(<AssetsPanel {...({ useSessions: (select: (value: { current: string }) => unknown) => select({ current: 'session-1' }), t: (key: string) => key, closeWorkbench: vi.fn(), load: vi.fn(async () => pendingSnapshot), save: vi.fn(), request: vi.fn(), apply: vi.fn() } as unknown as ComponentProps<typeof AssetsPanel>)} />)
  fireEvent.click(view.getByText('load'))
  await waitFor(() => { expect(view.getByRole('status').textContent).toBe('unfinished pending-1') })
  expect(view.getByText('pending request-1')).toBeTruthy()
  view.unmount()
})

it('scans candidates and renders an explicit image preview', async () => {
  const candidates = vi.fn(async () => [{ assetId: 'CHAR-001-V01', path: '候选/CHAR-001-V01-V01.png', name: 'CHAR-001-V01-V01.png', kind: 'image' as const, size: 10 }])
  const preview = vi.fn(async () => ({ id: null, name: 'CHAR-001-V01-V01.png', url: '/api/mantur-assets.media?token=preview', kind: 'image' as const }))
  const view = render(<AssetsPanel {...({ useSessions: (select: (value: { current: string }) => unknown) => select({ current: 'session-1' }), t: (key: string) => ({ assets: '资产', source: '流水线报告', load: '读取', candidateDirectory: '候选目录', scan: '扫描候选', candidates: '候选资产', preview: '预览', prompt: '提示词', save: '保存草稿', request: '发送提案请求', apply: '应用提案', noMedia: '未绑定明确媒体', actual: '已保留实际请求', error: '资产操作失败' }[key] ?? key), closeWorkbench: vi.fn(), load: vi.fn(async () => snapshot), save: vi.fn(), request: vi.fn(), apply: vi.fn(), candidates, preview } as unknown as ComponentProps<typeof AssetsPanel>)} />)
  fireEvent.click(screen.getByText('读取')); await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: '扫描候选' }).disabled).toBe(false) })
  fireEvent.click(screen.getByText('扫描候选')); await waitFor(() => { expect(candidates).toHaveBeenCalledWith('session-1', '资产/生成图片') })
  fireEvent.click(screen.getByText('CHAR-001-V01-V01.png (CHAR-001-V01)')); await waitFor(() => { expect(preview).toHaveBeenCalledWith('session-1', '候选/CHAR-001-V01-V01.png') })
  expect(view.getByRole('img', { name: 'CHAR-001-V01-V01.png' }).getAttribute('src')).toBe('/api/mantur-assets.media?token=preview')
  view.unmount()
})


afterEach(cleanup)
function panel(value = snapshot, session: string | null = 'session-1') {
  const commands = {
    load: vi.fn<AssetCommands['load']>().mockResolvedValue(value),
    save: vi.fn<AssetCommands['save']>().mockResolvedValue(value),
    request: vi.fn<AssetCommands['request']>().mockResolvedValue('new-request'),
    apply: vi.fn<AssetCommands['apply']>().mockResolvedValue(value),
    candidates: vi.fn<AssetCommands['candidates']>().mockResolvedValue([]),
    preview: vi.fn<AssetCommands['preview']>(),
  }
  const props = { ...commands, useSessions: select => select({ current: session ?? undefined } as never),
    t: (key: string) => key, closeWorkbench: vi.fn() } as ComponentProps<typeof AssetsPanel>
  return { ...render(<AssetsPanel {...props} />), commands }
}

it('keeps commands unavailable without a Session and displays non-Error failures through its locale', async () => {
  const absent = panel(snapshot, null)
  expect(absent.getByText('source')).toBeTruthy()
  expect(absent.queryByRole('button')).toBeNull()
  absent.unmount()
  const view = panel()
  view.commands.load.mockRejectedValueOnce('offline')
  fireEvent.click(view.getByRole('button', { name: 'load' }))
  expect((await view.findByRole('alert')).textContent).toBe('error')
})

it('edits multiple selections and retains a deselected prompt when reselected', async () => {
  const second = { ...snapshot.rows[0]!, key: 'prop/2' as AssetKey, id: 'PROP-2', name: '道具', prompt: 'second', media: 'bound.png' }
  const view = panel({ ...snapshot, rows: [snapshot.rows[0]!, second] })
  fireEvent.change(view.getByRole('textbox', { name: 'source' }), { target: { value: 'report.json' } })
  fireEvent.click(view.getByRole('button', { name: 'load' }))
  fireEvent.click(await view.findByRole('button', { name: 'CHAR-001-V01 林夏' }))
  fireEvent.change(view.getByRole('textbox', { name: 'prompt' }), { target: { value: 'edited' } })
  fireEvent.click(view.getByRole('button', { name: 'PROP-2 道具' }))
  expect(view.getByText('selected')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'CHAR-001-V01 林夏' }))
  expect(view.getByText('actual')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'CHAR-001-V01 林夏' }))
  fireEvent.change(view.getByRole('textbox', { name: 'request' }), { target: { value: 'revise both' } })
  fireEvent.click(view.getByRole('button', { name: 'request' }))
  await waitFor(() => { expect(view.commands.request).toHaveBeenCalledOnce() })
  expect(view.commands.request.mock.calls[0]![2].map(edit => edit.prompt)).toEqual(['edited', 'second'])
  expect(view.commands.request.mock.calls[0]![3]).toBe('revise both')
  fireEvent.click(view.getByRole('button', { name: 'refresh' }))
  await waitFor(() => { expect(view.commands.load).toHaveBeenCalledTimes(2) })
  expect(view.commands.load).toHaveBeenLastCalledWith('session-1', 'report.json')
})

it('shows proposed status and a video candidate without inventing an asset binding', async () => {
  const value = { ...snapshot, state: { ...snapshot.state, proposals: [
    { id: 'proposed-1', status: 'proposed' }, { id: 'applied-1', status: 'applied' },
  ] } } as unknown as AssetSnapshot
  const view = panel(value)
  view.commands.candidates.mockResolvedValueOnce([{ assetId: null, path: 'clips/preview.mp4', name: 'preview.mp4', kind: 'video', size: 12 }])
  view.commands.preview.mockResolvedValueOnce({ id: null, name: 'preview.mp4', kind: 'video', url: '/media/video' })
  fireEvent.click(view.getByRole('button', { name: 'load' }))
  expect(await view.findByText('proposed proposed-1')).toBeTruthy()
  expect(view.queryByText(/applied-1/)).toBeNull()
  fireEvent.change(view.getByRole('textbox', { name: 'candidateDirectory' }), { target: { value: 'clips' } })
  fireEvent.click(view.getByRole('button', { name: 'scan' }))
  fireEvent.click(await view.findByRole('button', { name: 'preview.mp4' }))
  await waitFor(() => { expect(view.container.querySelector('video')?.getAttribute('src')).toBe('/media/video') })
  expect(view.commands.candidates).toHaveBeenCalledWith('session-1', 'clips')
})
