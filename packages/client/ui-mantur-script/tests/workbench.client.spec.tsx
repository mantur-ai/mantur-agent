// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ScriptDocument, ScriptVersion } from '../src/types.ts'
import { createWorkbenchStore } from '../src/client/store.ts'
import { Workbench, WorkbenchToggle } from '../src/client/Workbench.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const session = 'session-a' as SessionId
const first: ScriptDocument = { path: '/project/01.md', version: 'v1' as ScriptVersion, content: '# 第一集\n\n**加粗**\n\n重复台词\n\n重复台词\n' }
type Props = ComponentProps<typeof Workbench>
function setup(dictionary = zh, overrides: Partial<Props> = {}) {
  const instance = createWorkbenchStore().create()
  let disk = first
  const props = {
    useSessions: select => select({ current: session, byId: {} } as never),
    useStore: select => select(useSyncExternalStore(notify => instance.subscribe(notify), () => instance.getSnapshot())),
    actions: instance.actions,
    t: (key) => {
      if (!Object.hasOwn(dictionary, key)) throw new Error(`Unexpected locale key: ${key}`)
      return dictionary[key as keyof typeof en]
    },
    closeWorkbench: vi.fn(),
    list: vi.fn(async () => [{ path: first.path, name: '01.md', directory: false }]),
    read: vi.fn(async () => disk),
    save: vi.fn(async (_session: SessionId, base: ScriptDocument, text: string) => {
      if (base.version !== disk.version) throw new Error('FS_STALE_VERSION')
      disk = { ...base, version: 'v2' as ScriptVersion, content: text }
      return disk
    }),
    send: vi.fn(async () => {}),
    renderSlot: ((key: string, owner: { selected?: boolean; selectEditing?: () => void }) => key.includes('.assets.') ? null : key.endsWith('.tab')
      ? <button type="button" aria-pressed={owner.selected} onClick={owner.selectEditing}>剪辑</button>
      : <iframe title="Test editing" />) as Props['renderSlot'],
  } satisfies Partial<Props>
  let current = { ...props, ...overrides } as Props
  const view = render(<Workbench {...current} />)
  const redraw = (changes: Partial<Props>) => { current = { ...current, ...changes }; view.rerender(<Workbench {...current} />) }
  return { ...view, props, instance, redraw, setDisk: (next: ScriptDocument) => { disk = next } }
}
async function open(dictionary = zh) {
  const view = setup(dictionary)
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


it('renders the project prompt without loading files when no Session is selected', () => {
  const view = setup(zh, { useSessions: select => select({ current: undefined, byId: {} } as never) })
  expect(view.props.list).not.toHaveBeenCalled()
  expect(view.getByText(zh.selectSession)).toBeTruthy()
})

it('adopts a conflicting disk version only after the explicit reload choice', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  fireEvent.change(view.getByRole('textbox', { name: zh.source }), { target: { value: 'unsaved' } })
  view.setDisk({ ...first, version: 'changed' as ScriptVersion, content: '# Disk version' })
  fireEvent.click(view.getByRole('button', { name: zh.refresh }))
  await view.findByText(zh.conflict)
  fireEvent.click(view.getByRole('button', { name: zh.useDisk }))
  expect((view.getByRole('textbox', { name: zh.source }) as HTMLTextAreaElement).value).toBe('# Disk version')
  fireEvent.click(view.getByRole('button', { name: zh.reading }))
  await view.findByRole('heading', { name: 'Disk version' })
})

it('shows initial listing errors and ignores a listing completed after unmount', async () => {
  const failed = setup(zh, { list: async () => { throw new Error('folder denied') } })
  expect((await failed.findByRole('alert')).textContent).toContain('folder denied')
  failed.unmount()
  const pending = Promise.withResolvers<import('../src/types.ts').ScriptEntry[]>()
  const late = setup(zh, { list: () => pending.promise })
  late.unmount()
  await act(async () => { pending.reject(new Error('late listing')) })
})

it('lists multiple scripts by title without path controls', async () => {
  const view = setup(zh, { list: async () => [
    { path: first.path, name: '01.md', directory: false },
    { path: '/project/02.md', name: '02.md', directory: false },
  ] })
  fireEvent.click(await view.findByRole('button', { name: '01' }))
  await view.findByRole('heading', { name: '第一集' })
  expect(view.queryByRole('textbox', { name: zh.folder })).toBeNull()
  expect(view.queryByRole('button', { name: zh.root })).toBeNull()
})

it('rechecks disk after a running turn becomes idle and reports a failed observation', async () => {
  const view = await open()
  const state = (running: boolean): Props['useSessions'] => select => select({ current: session, byId: { [session]: { running } } } as never)
  view.redraw({ useSessions: state(true) })
  view.setDisk({ ...first, version: 'agent' as ScriptVersion, content: '# Agent revision' })
  view.redraw({ useSessions: state(false) })
  await view.findByRole('heading', { name: 'Agent revision' })
  view.redraw({ useSessions: state(true) })
  view.props.read.mockRejectedValueOnce(new Error('observation failed'))
  view.redraw({ useSessions: state(false) })
  expect((await view.findByRole('alert')).textContent).toContain('observation failed')
})

it('refuses a rewritten selection when disk changed after the user selected it', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  const source = view.getByRole('textbox', { name: zh.source }) as HTMLTextAreaElement
  source.focus(); source.setSelectionRange(0, 3); fireEvent.select(source)
  fireEvent.change(view.getByRole('textbox', { name: zh.instruction }), { target: { value: 'rewrite' } })
  view.setDisk({ ...first, version: 'changed' as ScriptVersion, content: '# Changed' })
  fireEvent.click(view.getByRole('button', { name: zh.send }))
  expect((await view.findByRole('alert')).textContent).toContain(zh.conflict)
  expect(view.props.send).not.toHaveBeenCalled()
})

it('shows transport rejection text without claiming a draft save succeeded', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  fireEvent.change(view.getByRole('textbox', { name: zh.source }), { target: { value: 'unsaved' } })
  view.props.save.mockRejectedValueOnce('transport rejected')
  fireEvent.click(view.getByRole('button', { name: zh.save }))
  expect((await view.findByRole('alert')).textContent).toBe(`${zh.failed}: transport rejected`)
  expect(view.queryByRole('status')).toBeNull()
  expect(view.instance.getSnapshot().drafts[session]?.[first.path]?.text).toBe('unsaved')
})


it.each([true, false])('routes the boundary control with expanded=%s and opens the editing view', (expanded) => {
  const instance = createWorkbenchStore().create()
  const openWorkbench = vi.fn()
  const closeWorkbench = vi.fn()
  const props = { actions: instance.actions, expanded, openWorkbench, closeWorkbench,
    t: (key: keyof typeof zh) => zh[key], useSessions: (select: (value: unknown) => unknown) => select({ current: undefined }),
    renderSlot: (_name: string, owner: { openWorkbench: () => void }) => (
      <button onClick={owner.openWorkbench}>Open automatic editing</button>
    ),
  } as ComponentProps<typeof WorkbenchToggle>
  const view = render(<WorkbenchToggle {...props} />)
  fireEvent.click(view.getByRole('button', { name: expanded ? zh.collapse : zh.expand }))
  expect(expanded ? closeWorkbench : openWorkbench).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: 'Open automatic editing' }))
  expect(instance.getSnapshot().views['']).toBe('editing')
})

it('keeps project-free tab choices explicit and shows missing optional panels', () => {
  const view = setup(zh, {
    useSessions: select => select({ current: undefined, byId: {} } as never),
    renderSlot: ((name: string, owner: { selectAssets?: () => void; selectEditing?: () => void }, options?: { fallback?: ReactNode }) => {
      if (name.endsWith('assets.tab')) return <button onClick={owner.selectAssets}>Assets</button>
      if (name.endsWith('editing.tab')) return <button onClick={owner.selectEditing}>Editing</button>
      return options?.fallback
    }) as Props['renderSlot'],
  })
  fireEvent.click(view.getByRole('button', { name: 'Assets' }))
  expect(view.getByText(zh.assetsUnavailable)).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Editing' }))
  expect(view.getByText(zh.editingUnavailable)).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: zh.script }))
  expect(view.getByText(zh.selectSession)).toBeTruthy()
})

it('opens a single plain-text script automatically without Markdown parsing', async () => {
  const text = { ...first, path: '/project/02.txt', content: '# Literal text' }
  const view = setup(zh, { read: async () => text })
  expect(await view.findByText('# Literal text')).toBeTruthy()
  expect(view.queryByRole('heading', { name: 'Literal text' })).toBeNull()
  expect(view.queryByRole('navigation')).toBeNull()
})

it('refuses direct form submission while the selected draft is unsaved', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  const source = view.getByRole('textbox', { name: zh.source }) as HTMLTextAreaElement
  fireEvent.change(source, { target: { value: 'unsaved draft' } })
  source.focus(); source.setSelectionRange(0, 3); fireEvent.select(source)
  const submit = view.getByRole('button', { name: zh.send })
  expect(submit.hasAttribute('disabled')).toBe(true)
  fireEvent.submit(submit.closest('form')!)
  expect((await view.findByRole('alert')).textContent).toContain(zh.saveFirst)
  expect(view.props.send).not.toHaveBeenCalled()
})

it.each([true, false])('ignores file-open completion after unmount, rejected=%s', async (rejected) => {
  const pending = Promise.withResolvers<ScriptDocument>()
  const view = setup(zh, { read: () => pending.promise })
  await act(async () => { await Promise.resolve() })
  view.unmount()
  await act(async () => { if (rejected) pending.reject(new Error('late read')); else pending.resolve(first) })
  expect(view.instance.getSnapshot().drafts).toEqual({})
})

it('ignores an initial catalog completed after unmount', async () => {
  const pending = Promise.withResolvers<import('../src/types.ts').ScriptEntry[]>()
  const initial = setup(zh, { list: () => pending.promise })
  initial.unmount()
  await act(async () => { pending.resolve([]) })
  expect(initial.props.read).not.toHaveBeenCalled()
})

it.each([true, false])('ignores an idle observation after unmount, rejected=%s', async (rejected) => {
  const view = await open()
  const state = (running: boolean): Props['useSessions'] => select => select({ current: session, byId: { [session]: { running } } } as never)
  view.redraw({ useSessions: state(true) })
  const pending = Promise.withResolvers<ScriptDocument>()
  view.props.read.mockReturnValueOnce(pending.promise)
  view.redraw({ useSessions: state(false) })
  view.unmount()
  await act(async () => { if (rejected) pending.reject(new Error('late idle read')); else pending.resolve({ ...first, version: 'later' as ScriptVersion }) })
  expect(view.instance.getSnapshot().drafts[session]?.[first.path]?.base).toEqual(first)
})

it('does not send after the selected editor is unmounted during the final disk check', async () => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  const source = view.getByRole('textbox', { name: zh.source }) as HTMLTextAreaElement
  source.focus(); source.setSelectionRange(0, 3); fireEvent.select(source)
  fireEvent.change(view.getByRole('textbox', { name: zh.instruction }), { target: { value: 'rewrite' } })
  const pending = Promise.withResolvers<ScriptDocument>()
  view.props.read.mockReturnValueOnce(pending.promise)
  fireEvent.click(view.getByRole('button', { name: zh.send }))
  view.unmount()
  await act(async () => { pending.resolve(first) })
  expect(view.props.send).not.toHaveBeenCalled()
})

it.each(['save', 'send'] as const)('settles an already admitted %s without updating a closed panel', async (operation) => {
  const view = await open()
  fireEvent.click(view.getByRole('button', { name: zh.source }))
  const source = view.getByRole('textbox', { name: zh.source }) as HTMLTextAreaElement
  if (operation === 'save') {
    fireEvent.change(source, { target: { value: 'saved while closed' } })
    const pending = Promise.withResolvers<ScriptDocument>()
    view.props.save.mockReturnValueOnce(pending.promise)
    fireEvent.click(view.getByRole('button', { name: zh.save }))
    view.unmount()
    await act(async () => { pending.resolve({ ...first, version: 'closed' as ScriptVersion, content: 'saved while closed' }) })
    expect(view.instance.getSnapshot().drafts[session]?.[first.path]?.base.content).toBe('saved while closed')
  } else {
    source.focus(); source.setSelectionRange(0, 3); fireEvent.select(source)
    fireEvent.change(view.getByRole('textbox', { name: zh.instruction }), { target: { value: 'rewrite' } })
    const pending = Promise.withResolvers<undefined>()
    view.props.send.mockReturnValueOnce(pending.promise)
    fireEvent.click(view.getByRole('button', { name: zh.send }))
    await waitFor(() => { expect(view.props.send).toHaveBeenCalledOnce() })
    view.unmount()
    await act(async () => { pending.resolve(undefined) })
  }
  expect(view.container.textContent).toBe('')
})

it.each([true, false])('ignores manual-open completion after disposal, success=%s', async (success) => {
  let resolve!: (value: ScriptDocument) => void
  let reject!: (cause: unknown) => void
  const view = setup(zh, { list: async () => [{ path: first.path, name: '01.md', directory: false }, { path: '/project/02.md', name: '02.md', directory: false }],
    read: () => new Promise((yes, no) => { resolve = yes; reject = no }) })
  fireEvent.click(await view.findByRole('button', { name: '01' }))
  view.unmount()
  await act(async () => { if (success) resolve(first); else reject(new Error('late failure')) })
  expect(view.instance.getSnapshot().drafts[session]).toBeUndefined()
})
