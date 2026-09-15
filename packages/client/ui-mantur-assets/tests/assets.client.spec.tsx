// @vitest-environment jsdom
/** Report selection, drafts and explicit media through the production panel. */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { AssetsPanel, type AssetCommands } from '../src/client/AssetsPanel.tsx'
import { zh } from '../src/client/locales.ts'
import type { AssetKey, AssetSnapshot, AssetProject } from '../src/types.ts'

const snapshot: AssetSnapshot = {
  source: { path: 'assets-report.json', version: 'v' as never, sha256: 's' }, stateVersion: null,
  state: { format: 1, path: 'assets-report.json', drafts: [], proposals: [], history: [], pending: null }, projectState: null,
  rows: [{ key: '角色资产/CHAR-001-V01' as AssetKey, id: 'CHAR-001-V01', name: '林夏', table: '角色资产', fingerprint: 'f',
    kind: 'image', prompt: '原提示词', negative: '', media: '', localMedia: '', details: [], template: '', actualRequest: '', actualPrompt: '' }],
}
const project: AssetProject = { name: '测试项目', directory: '/project', assets: '资产/资产提取结果/assets-report.json', clips: '资产/资产提取结果/clip-seedance-report.json', imagesManifest: null, clipsManifest: null }
afterEach(cleanup)
function panel(value = snapshot, session: string | null = 'session-1') {
  const commands = {
    projects: vi.fn<AssetCommands['projects']>().mockResolvedValue([project]),
    load: vi.fn<AssetCommands['load']>().mockResolvedValue(value), list: vi.fn<AssetCommands['list']>().mockResolvedValue([]),
    save: vi.fn<AssetCommands['save']>().mockResolvedValue(value), request: vi.fn<AssetCommands['request']>().mockResolvedValue('new-request'),
    apply: vi.fn<AssetCommands['apply']>().mockResolvedValue(value), candidates: vi.fn<AssetCommands['candidates']>().mockResolvedValue([]),
    media: vi.fn<AssetCommands['media']>(),
    preview: vi.fn<AssetCommands['preview']>().mockResolvedValue({ id: null, name: 'preview', url: '/preview', kind: 'image' }),
  }
  const props = { ...commands, useSessions: select => select({ current: session ?? undefined } as never),
    t: (key: keyof typeof zh) => zh[key], closeWorkbench: vi.fn() } as ComponentProps<typeof AssetsPanel>
  return { ...render(<AssetsPanel {...props} />), commands, props }
}
async function load() {
  await screen.findByRole('button', { name: 'CHAR-001-V01 林夏' })
}
it('keeps commands unavailable without a Session and shows load errors', async () => {
  const absent = panel(snapshot, null)
  expect(absent.queryByRole('button')).toBeNull(); absent.unmount()
  const view = panel(); view.commands.load.mockRejectedValueOnce(new Error('Report missing'))
  expect((await screen.findByRole('alert')).textContent).toBe('Report missing')
  expect(screen.getByText('暂无资产')).toBeTruthy()
})
it('saves selected drafts and passes the user instruction with precisely selected rows', async () => {
  const view = panel(); await load()
  fireEvent.click(screen.getByRole('button', { name: 'CHAR-001-V01 林夏' }))
  fireEvent.change(screen.getByLabelText('提示词'), { target: { value: '修改后的提示词' } })
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await waitFor(() =>{  expect(view.commands.save).toHaveBeenCalledOnce() })
  expect(view.commands.save.mock.calls[0]![2][0]!.prompt).toBe('修改后的提示词')
  await waitFor(() =>{  expect(screen.getByRole('button', { name: '保存草稿' }).hasAttribute('disabled')).toBe(false) })
  fireEvent.change(screen.getByLabelText('发送提案请求'), { target: { value: '保留服装，调整光线' } })
  fireEvent.click(screen.getByRole('button', { name: '发送提案请求' }))
  await waitFor(() =>{  expect(view.commands.request).toHaveBeenCalledOnce() })
  expect(view.commands.request.mock.calls[0]![3]).toBe('保留服装，调整光线')
})
it('switches to the Clip report and clears selections belonging to the previous source', async () => {
  const view = panel(); await load()
  fireEvent.click(screen.getByRole('button', { name: 'CHAR-001-V01 林夏' }))
  fireEvent.click(screen.getByRole('tab', { name: '分镜 / Clip 列表' }))
  expect(screen.queryByLabelText('提示词')).toBeNull()
  expect(screen.queryByLabelText('流水线报告')).toBeNull()
  await waitFor(() =>{  expect(view.commands.load).toHaveBeenLastCalledWith('session-1', '资产/资产提取结果/clip-seedance-report.json', undefined, undefined) })
})
it('shows explicit remote images, filters categories, and reads all source fields', async () => {
  const row = { ...snapshot.rows[0]!, media: 'https://example.com/character.png', details: [{ name: '变体名', value: '校服' }] }
  const view = panel({ ...snapshot, rows: [row] }); await load()
  fireEvent.click(screen.getByRole('button', { name: 'CHAR-001-V01 林夏' }))
  await waitFor(() =>{  expect(screen.getAllByRole('img')[0]!.getAttribute('src')).toBe(row.media) })
  expect(view.commands.preview).not.toHaveBeenCalled()
  expect(screen.getByText('校服')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('搜索 ID、名称或提示词'), { target: { value: '不存在' } })
  expect(screen.getByText('没有匹配的条目。')).toBeTruthy()
})
it('previews unbound candidates without changing the report media', async () => {
  const view = panel(); await load()
  view.commands.candidates.mockResolvedValueOnce([{ assetId: null, path: 'clips/preview.mp4', name: 'preview.mp4', kind: 'video', size: 12 }])
  view.commands.preview.mockResolvedValueOnce({ id: null, name: 'preview.mp4', kind: 'video', url: '/media/video' })
  fireEvent.click(screen.getByText('候选资产'))
  fireEvent.click(screen.getByRole('button', { name: '扫描候选' }))
  fireEvent.click(await screen.findByRole('button', { name: 'preview.mp4' }))
  await waitFor(() =>{  expect(view.container.querySelector('video')?.getAttribute('src')).toBe('/media/video') })
  expect(view.commands.preview).toHaveBeenCalledWith('session-1', 'clips/preview.mp4')
  expect(snapshot.rows[0]!.media).toBe('')
})
it('restores saved drafts only when the row fingerprint still matches and exposes reviewed proposals', async () => {
  const value = { ...snapshot, state: { ...snapshot.state, drafts: [{ revision: 1, source: snapshot.source,
    edits: [{ key: snapshot.rows[0]!.key, fingerprint: 'f', prompt: '已保存', negative: '' }] }], proposals: [{ id: 'p1', status: 'proposed', instruction: 'rewrite', edits: [] }] } } as unknown as AssetSnapshot
  const view = panel(value); await load()
  fireEvent.click(screen.getByRole('button', { name: 'CHAR-001-V01 林夏' }))
  expect((screen.getByLabelText('提示词')).value).toBe('已保存')
  fireEvent.click(screen.getByText('提案待审核 p1'))
  fireEvent.click(screen.getByRole('button', { name: '应用提案' }))
  await waitFor(() =>{  expect(view.commands.apply).toHaveBeenCalledWith('session-1', 'p1') })
})
it('resets the browser when the owning Session changes', async () => {
  const view = panel(); await load()
  view.rerender(<AssetsPanel {...view.props} useSessions={select => select({ current: 'session-2' } as never)} />)
  expect(screen.queryByRole('button', { name: 'CHAR-001-V01 林夏' })).toBeNull()
  await waitFor(() =>{  expect(view.commands.load).toHaveBeenLastCalledWith('session-2', project.assets, undefined, project.clips) })
})

it('keeps unsaved edits when switching or refreshing is attempted', async () => {
  const view = panel(); await load()
  fireEvent.click(screen.getByRole('button', { name: 'CHAR-001-V01 林夏' }))
  fireEvent.change(screen.getByLabelText('提示词'), { target: { value: '尚未保存' } })
  fireEvent.click(screen.getByRole('tab', { name: '分镜 / Clip 列表' }))
  expect((screen.getByLabelText('提示词')).value).toBe('尚未保存')
  expect(screen.getByRole('alert').textContent).toContain('请先保存')
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() =>{  expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('false') })
  expect(view.commands.load).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '撤销未保存修改' }))
  fireEvent.click(screen.getByRole('tab', { name: '分镜 / Clip 列表' }))
  expect(screen.queryByLabelText('提示词')).toBeNull()
})

it('rejects unsupported media URLs without sending them to the local resolver', async () => {
  const view = panel({ ...snapshot, rows: [{ ...snapshot.rows[0]!, media: 'javascript:alert(1)' }] })
  await load()
  fireEvent.click(screen.getByRole('button', { name: 'CHAR-001-V01 林夏' }))
  expect((await screen.findByRole('alert')).textContent).toContain('仅支持 HTTP(S)')
  expect(view.commands.preview).not.toHaveBeenCalled()
})

it('shows all assets automatically without report inputs and uses the full grid until a card opens', async () => {
  const view = panel(); await load()
  expect(screen.queryByLabelText('流水线报告')).toBeNull()
  expect(screen.queryByLabelText('关联分镜报告（可选）')).toBeNull()
  expect(view.container.querySelector('[data-detail="false"]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'CHAR-001-V01 林夏' }))
  expect(view.container.querySelector('[data-detail="true"]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '收起详情' }))
  expect(view.container.querySelector('[data-detail="false"]')).toBeTruthy()
})

it('requires a project choice when multiple production folders exist', async () => {
  const view = panel()
  view.commands.projects.mockResolvedValue([project, { ...project, name: '另一个项目', directory: '/other', assets: '/other/assets.json' }])
  view.rerender(<AssetsPanel {...view.props} useSessions={select => select({ current: 'session-many' } as never)} />)
  const select = await screen.findByRole('combobox', { name: '项目' })
  expect(view.commands.load).not.toHaveBeenCalledWith('session-many', expect.anything(), expect.anything(), expect.anything())
  fireEvent.change(select, { target: { value: '/other' } })
  await waitFor(() =>{  expect(view.commands.load).toHaveBeenLastCalledWith('session-many', '/other/assets.json', undefined, project.clips) })
})

it('loads newly produced assets when refreshing a previously empty workspace', async () => {
  const view = panel()
  view.commands.projects.mockResolvedValue([])
  view.rerender(<AssetsPanel {...view.props} useSessions={select => select({ current: 'empty-session' } as never)} />)
  await waitFor(() =>{  expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('false') })
  view.commands.projects.mockResolvedValue([project])
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByRole('button', { name: 'CHAR-001-V01 林夏' })
  expect(view.commands.load).toHaveBeenLastCalledWith('empty-session', project.assets, undefined, project.clips)
})
