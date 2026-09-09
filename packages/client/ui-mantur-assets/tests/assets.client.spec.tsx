// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AssetsPanel } from '../src/client/AssetsPanel.tsx'
import type { AssetSnapshot } from '../src/types.ts'

const snapshot = { source: { path: 'assets-report.json', version: 'v' as never, sha256: 's' }, stateVersion: null, state: { format: 1, path: 'assets-report.json', drafts: [], proposals: [], history: [], pending: null }, projectState: null, rows: [{ key: '角色资产/CHAR-001-V01', id: 'CHAR-001-V01', name: '林夏', table: '角色资产', fingerprint: 'f', kind: 'image' as const, prompt: '原提示词', negative: '', media: '', template: '', actualRequest: '', actualPrompt: '' }] } satisfies AssetSnapshot

it('mounts the Chinese asset panel and drives load, save, and apply through production commands', async () => {
  const load = vi.fn(async () => snapshot); const save = vi.fn(async () => snapshot); const request = vi.fn(async () => 'request-1'); const apply = vi.fn(async () => snapshot)
  const view = render(<AssetsPanel {...({ useSessions: (select: (value: { current: string }) => unknown) => select({ current: 'session-1' }), t: (key: string) => ({ assets: '资产', source: '流水线报告', load: '读取', refresh: '刷新', prompt: '提示词', save: '保存草稿', request: '发送提案请求', apply: '应用提案', noMedia: '未绑定明确媒体', actual: '已保留实际请求', error: '资产操作失败' }[key] ?? key), closeWorkbench: vi.fn(), load, save, request, apply } as never)} />)
  expect(screen.getByText('资产')).toBeTruthy(); fireEvent.click(screen.getByText('读取')); await waitFor(() => expect(load).toHaveBeenCalled())
  fireEvent.click(screen.getByText('CHAR-001-V01 林夏')); fireEvent.click(screen.getByText('保存草稿')); await waitFor(() => expect(save).toHaveBeenCalled())
  fireEvent.click(screen.getAllByRole('button', { name: '发送提案请求' })[0]!); await waitFor(() => expect(request).toHaveBeenCalled()); fireEvent.click(screen.getByText('应用提案')); await waitFor(() => expect(apply).toHaveBeenCalled())
  view.unmount()
})

it('shows a provider error without crashing the asset panel', async () => {
  const load = vi.fn(async () => { throw new Error('FS_STALE_VERSION') })
  render(<AssetsPanel {...({ useSessions: (select: (value: { current: string }) => unknown) => select({ current: 'session-1' }), t: (key: string) => key, closeWorkbench: vi.fn(), load, save: vi.fn(), request: vi.fn(), apply: vi.fn() } as never)} />)
  fireEvent.click(screen.getByText('load')); await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('FS_STALE_VERSION'))
})
