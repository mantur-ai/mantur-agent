// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ScriptDocument, ScriptVersion } from '../src/types.ts'
import { createWorkbenchStore } from '../src/client/store.ts'
import { Workbench } from '../src/client/Workbench.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const session = 'session-a' as SessionId
const first: ScriptDocument = { path: '/project/01.md', version: 'v1' as ScriptVersion, content: '# 第一集\n\n**加粗**\n\n重复台词\n\n重复台词\n' }
type Props = ComponentProps<typeof Workbench>
function setup(dictionary = zh) {
  const instance = createWorkbenchStore().create()
  let disk = first
  const props = {
    useSessions: select => select({ current: session, byId: {} } as never),
    useStore: select => select(useSyncExternalStore(notify => instance.subscribe(notify), () => instance.getSnapshot())),
    actions: instance.actions,
    t: (key: keyof typeof en) => dictionary[key],
    closeWorkbench: vi.fn(),
    list: vi.fn(async () => [{ path: first.path, name: '01.md', directory: false }]),
    read: vi.fn(async () => disk),
    save: vi.fn(async (_session: SessionId, base: ScriptDocument, text: string) => {
      if (base.version !== disk.version) throw new Error('FS_STALE_VERSION')
      disk = { ...base, version: 'v2' as ScriptVersion, content: text }
      return disk
    }),
    send: vi.fn(async () => {}),
    renderSlot: ((key: string, owner: { selected?: boolean; selectEditing?: () => void }) => key.endsWith('.tab')
      ? <button type="button" aria-pressed={owner.selected} onClick={owner.selectEditing}>剪辑</button>
      : <iframe title="Test editing" />) as Props['renderSlot'],
  } satisfies Partial<Props>
  const view = render(<Workbench {...props as Props} />)
  return { ...view, props, instance, setDisk: (next: ScriptDocument) => { disk = next } }
}
async function open(dictionary = zh) {
  const view = setup(dictionary)
  fireEvent.click(await view.findByRole('button', { name: '01.md' }))
  await view.findByRole('heading', { name: '第一集' })
  return view
}

it.each([en, zh])('defaults to rendered Markdown without modifying disk and snapshots the reading layout', async (dictionary) => {
  const view = await open(dictionary)
  expect(view.getByRole('heading', { name: '第一集' }).textContent).toBe('第一集')
  expect(view.container.querySelector('strong')?.textContent).not.toContain('#')
  expect(view.props.save).not.toHaveBeenCalled()
  expect(view.container.innerHTML).toMatchSnapshot()
})

it('preserves the source draft and the same editing iframe while switching panels', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  fireEvent.change(view.getByRole('textbox', { name: zh.source }), { target: { value: '# 未保存草稿' } })
  fireEvent.click(view.getByRole('button', { name: zh.editing }))
  const iframe = view.getByTitle('Test editing')
  fireEvent.click(view.getByRole('button', { name: zh.script }))
  expect((view.getByRole('textbox', { name: zh.source }) as HTMLTextAreaElement).value).toBe('# 未保存草稿')
  fireEvent.click(view.getByRole('button', { name: zh.editing }))
  expect(view.getByTitle('Test editing')).toBe(iframe)
})

it('sends only the explicitly selected second occurrence with version and instruction', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  const source = view.getByRole('textbox', { name: zh.source }) as HTMLTextAreaElement
  const start = first.content.lastIndexOf('重复台词')
  source.focus(); source.setSelectionRange(start, start + 4); fireEvent.select(source)
  fireEvent.change(view.getByRole('textbox', { name: zh.instruction }), { target: { value: '让这句更克制' } })
  expect(view.props.send).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: zh.send }))
  await waitFor(() =>{  expect(view.props.send).toHaveBeenCalledWith(session, { path: first.path, version: first.version, start, end: start + 4, selected: '重复台词' }, '让这句更克制') })
})

it('keeps a dirty draft on external changes and prevents a stale save', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  fireEvent.change(view.getByRole('textbox', { name: zh.source }), { target: { value: '用户还在写' } })
  view.setDisk({ ...first, version: 'external' as ScriptVersion, content: 'Agent已改稿' })
  fireEvent.click(view.getByRole('button', { name: zh.refresh }))
  await view.findByText(zh.conflict)
  expect((view.getByRole('textbox', { name: zh.source }) as HTMLTextAreaElement).value).toBe('用户还在写')
  expect(view.getByRole('button', { name: zh.save }).hasAttribute('disabled')).toBe(true)
  expect(view.props.save).not.toHaveBeenCalled()
})

it('does not erase typing entered while a save is in flight', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  const source = view.getByRole('textbox', { name: zh.source })
  fireEvent.change(source, { target: { value: '提交保存的文字' } })
  const pending = Promise.withResolvers<ScriptDocument>()
  view.props.save.mockImplementationOnce(() => pending.promise)
  fireEvent.click(view.getByRole('button', { name: zh.save }))
  fireEvent.change(source, { target: { value: '保存时继续输入' } })
  await act(async () => { pending.resolve({ ...first, version: 'saved' as ScriptVersion, content: '提交保存的文字' }) })
  expect((source as HTMLTextAreaElement).value).toBe('保存时继续输入')
  expect(view.instance.getSnapshot().drafts[session]?.[first.path]?.base.content).toBe('提交保存的文字')
})

it('restores the previous version through a guarded save', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  fireEvent.change(view.getByRole('textbox', { name: zh.source }), { target: { value: '新版本' } })
  fireEvent.click(view.getByRole('button', { name: zh.save }))
  await waitFor(() =>{  expect(view.instance.getSnapshot().drafts[session]?.[first.path]?.previous).toEqual(first) })
  fireEvent.click(view.getByText(zh.diff))
  fireEvent.click(view.getByRole('button', { name: zh.undo }))
  await waitFor(() =>{  expect(view.instance.getSnapshot().drafts[session]?.[first.path]?.text).toBe(first.content) })
})
