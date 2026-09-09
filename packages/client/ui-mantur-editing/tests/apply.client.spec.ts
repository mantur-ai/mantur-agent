import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import * as client from '../src/client/index.ts'
import { Workbench } from '../src/client/Workbench.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-mantur-navigation/client'

vi.mock('@deepseek-ai/dsh-client-ui-mantur-editing/remote', () => ({ default: {} }))

describe('editing workbench composition', () => {
  it('keeps mode selections independent of workbench visibility and releases its controls', async () => {
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
    const sessions = { list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => {} } }
    ctx.provide('sessions', sessions as never)
    new UiConversation(ctx, sessions as never)
    const disposeRemote = vi.fn(async () => {})
    ctx.provide('remote', { $mount: vi.fn(async () => disposeRemote) } as never)
    ctx.provide('remote.manturEditing', {} as never)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'main.workbench': { kind: 'single', scope: 'root' }, 'main.workbench.toggle': { kind: 'single', scope: 'root' } } } as never, () => null)
    const fiber = ctx.plugin(client)
    await fiber.await()
    expect(slots.entries('main.workbench')[0]?.component).toBe(Workbench)
    expect(slots.entries('main.workbench.toggle')).toHaveLength(1)
    const entry = slots.entries('main.workbench')[0]!
    const face = (entry.inject as unknown as () => client.WorkbenchInjection)()
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
    expect(layout.openWorkbench).not.toHaveBeenCalled()
    ctx.emit('mantur/creation-mode-selected', 'editing')
    ctx.emit('mantur/creation-mode-selected', 'editing')
    expect(layout.openWorkbench).not.toHaveBeenCalled()
    for (const mode of ['script', 'production', 'assets'] as const) ctx.emit('mantur/creation-mode-selected', mode)
    expect(layout.closeWorkbench).not.toHaveBeenCalled()
    await fiber.dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(layout.closeWorkbench).toHaveBeenCalledOnce()
    expect(slots.entries('main.workbench')).toEqual([])
    expect(slots.entries('main.workbench.toggle')).toEqual([])
    ctx.emit('theme/change', ctx.theme.getTheme())
    expect(disposedNotify).not.toHaveBeenCalled()
    ctx.emit('mantur/creation-mode-selected', 'editing')
    expect(layout.openWorkbench).not.toHaveBeenCalled()
  })
})
