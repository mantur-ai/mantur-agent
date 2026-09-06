import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import * as client from '../src/client/index.ts'
import { Workbench } from '../src/client/Workbench.tsx'
import type { EditingSettings } from '../src/settings.ts'

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
    const settings = stubSettingsScope<EditingSettings>()
    const bind = vi.fn(() => settings.scope)
    ctx.provide('settingsScope', { bind } as never)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'main.workbench': { kind: 'single', scope: 'root' } } } as never, () => null)
    const fiber = ctx.plugin(client)
    await fiber.await()
    expect(slots.entries('main.workbench')[0]?.component).toBe(Workbench)
    const entry = slots.entries('main.workbench')[0]!
    const face = (entry.inject as unknown as () => client.WorkbenchInjection)()
    expect(face.hooks.preferences).toBe(settings.scope)
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
    expect(bind).toHaveBeenCalledWith({ namespace: 'ui-mantur-editing' })
    expect(layout.openWorkbench).not.toHaveBeenCalled()
    ctx.emit('mantur/creation-mode-selected', 'editing')
    ctx.emit('mantur/creation-mode-selected', 'editing')
    expect(layout.openWorkbench).toHaveBeenCalledTimes(2)
    for (const mode of ['script', 'production', 'assets'] as const) ctx.emit('mantur/creation-mode-selected', mode)
    expect(layout.closeWorkbench).toHaveBeenCalledTimes(3)
    await fiber.dispose()
    expect(layout.closeWorkbench).toHaveBeenCalledTimes(4)
    expect(slots.entries('main.workbench')).toEqual([])
    ctx.emit('theme/change', ctx.theme.getTheme())
    expect(disposedNotify).not.toHaveBeenCalled()
    ctx.emit('mantur/creation-mode-selected', 'editing')
    expect(layout.openWorkbench).toHaveBeenCalledTimes(2)
  })
})
