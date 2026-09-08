// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as client from '../src/client/index.ts'
import { Workbench } from '../src/client/Workbench.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-mantur-editing/remote', () => ({ default: {} }))

describe('editing workbench composition', () => {
  it('opens only for explicit editing selections and releases its occupant and listener', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    let colorScheme: 'light' | 'dark' = 'light'
    ctx.provide('theme', { getTheme: () => ({ active: { colorScheme } }) } as never)
    const layout = { openWorkbench: vi.fn(), closeWorkbench: vi.fn() }
    ctx.provide('layout', layout as never)
    const disposeRemote = vi.fn(async () => {})
    const open = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { editorUrl: 'http://127.0.0.1:5300/', directory: '/project/editing' } })
      .mockResolvedValueOnce({ ok: false, error: { message: 'editor refused' } })
    ctx.provide('remote', { $mount: vi.fn(async () => disposeRemote), manturEditing: { open } } as never)
    ctx.provide('remote.manturEditing', { open } as never)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'main.workbench': { kind: 'single', scope: 'root' }, 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } } as never, () => null)
    const fiber = ctx.plugin(client)
    await fiber.await()
    expect(slots.entries('main.workbench')[0]?.component).toBe(Workbench)
    expect(slots.entries('conversation.session.header.actions')).toHaveLength(1)
    const action = slots.entries('conversation.session.header.actions')[0]!
    ;(action.inject as unknown as () => { openWorkbench: () => void })().openWorkbench()
    expect(layout.openWorkbench).toHaveBeenCalledOnce()
    const entry = slots.entries('main.workbench')[0]!
    const face = (entry.inject as unknown as () => client.WorkbenchInjection)()
    await expect(face.openWorkspace('session-a' as never)).resolves.toEqual({ editorUrl: 'http://127.0.0.1:5300/', directory: '/project/editing' })
    await expect(face.openWorkspace('session-a' as never)).rejects.toThrow('editor refused')
    expect(open).toHaveBeenCalledWith('session-a', window.location.origin)
    expect(face.getLocale()).toBe('zh')
    const localeNotify = vi.fn()
    const unsubscribeLocale = face.subscribeLocale(localeNotify)
    locale.setLocale('en')
    expect(localeNotify).toHaveBeenCalledOnce()
    unsubscribeLocale()
    expect(face.getColorScheme()).toBe('light')
    const notify = vi.fn()
    const unsubscribe = face.subscribeTheme(notify)
    colorScheme = 'dark'
    ctx.emit('theme/change', ctx.theme.getTheme())
    expect(notify).toHaveBeenCalledOnce()
    expect(face.getColorScheme()).toBe('dark')
    unsubscribe()
    ctx.emit('theme/change', ctx.theme.getTheme())
    expect(notify).toHaveBeenCalledOnce()
    const disposedNotify = vi.fn()
    face.subscribeTheme(disposedNotify)
    layout.openWorkbench.mockClear()
    ctx.emit('mantur/creation-mode-selected', 'editing')
    ctx.emit('mantur/creation-mode-selected', 'editing')
    expect(layout.openWorkbench).toHaveBeenCalledTimes(2)
    for (const mode of ['script', 'production', 'assets'] as const) ctx.emit('mantur/creation-mode-selected', mode)
    expect(layout.closeWorkbench).toHaveBeenCalledTimes(3)
    await fiber.dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(layout.closeWorkbench).toHaveBeenCalledTimes(4)
    expect(slots.entries('main.workbench')).toEqual([])
    expect(slots.entries('conversation.session.header.actions')).toEqual([])
    ctx.emit('theme/change', ctx.theme.getTheme())
    expect(disposedNotify).not.toHaveBeenCalled()
    ctx.emit('mantur/creation-mode-selected', 'editing')
    expect(layout.openWorkbench).toHaveBeenCalledTimes(2)
  })
})
