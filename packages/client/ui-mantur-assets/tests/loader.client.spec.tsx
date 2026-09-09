// @vitest-environment jsdom
/** Real Loader registration with explicit transport substitutes; no Host or model execution is claimed here. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps, type ComponentType } from 'react'
import { expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AssetCommands } from '../src/client/AssetsPanel.tsx'
import type { AssetsPanel } from '../src/client/AssetsPanel.tsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import * as assets from '../src/client/index.ts'
import * as script from '../../ui-mantur-script/src/client/index.ts'
import { Workbench } from '../../ui-mantur-script/src/client/Workbench.tsx'
import type { createWorkbenchStore } from '../../ui-mantur-script/src/client/store.ts'

vi.mock('@deepseek-ai/dsh-client-ui-mantur-assets/remote', () => ({ default: { package: 'assets-transport' } }))
vi.mock('@deepseek-ai/dsh-client-ui-mantur-script/remote', () => ({ default: { package: 'script-transport' } }))

it('loads asset slots before their shell, resolves Chinese copy, mounts on click, and withdraws on disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-assets-loader-'))
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    ctx.provide('layout', { closeWorkbench: vi.fn() } as Context['layout'])
    ctx.provide('uiConversation', {} as Context['uiConversation'])
    const session = 'asset-loader-session' as SessionId
    const sessionState = { current: session, byId: {} }
    ctx.provide('sessions', { list: { getSnapshot: () => sessionState } } as Context['sessions'])
    const disposeRemote = vi.fn(async () => {})
    const remote = {
      $mount: vi.fn(async () => disposeRemote),
      manturScript: { list: async () => ({ ok: true, value: [] }) },
      manturAssets: { load: vi.fn(async () => { throw new Error('controlled provider error') }) },
    }
    ctx.provide('remote', remote as unknown as Context['remote'])
    ctx.provide('remote.manturAssets', remote.manturAssets)
    ctx.provide('remote.manturScript', remote.manturScript)
    ctx.slots.register({ name: 'root', children: {
      'main.workbench': { kind: 'single', scope: 'root' },
      'main.workbench.toggle': { kind: 'single', scope: 'root' },
    } }, () => null)
    const config = join(root, 'cordis.yml')
    await writeFile(config, '- name: assets\n- name: script\n')
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (name === 'assets') return assets
      if (name === 'script') return script
      throw new Error(`Unexpected plugin ${name}`)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    const slots = ctx.slots
    expect(slots.entries('main.workbench.assets.tab')).toHaveLength(1)
    expect(slots.entries('main.workbench.assets.content')).toHaveLength(1)
    const shell = slots.entries('main.workbench')[0]!
    const state = (shell.store as unknown as ReturnType<typeof createWorkbenchStore>).create()
    type ShellProps = ComponentProps<typeof Workbench>
    const standard: Pick<ShellProps, 'useSessions'> = { useSessions: select => select(sessionState as Parameters<typeof select>[0]) }
    const renderSlot: ShellProps['renderSlot'] = (name, owner, options) => {
      if (name === 'main.workbench.assets.tab') {
        const entry = slots.entries(name)[0]
        if (!entry) return null
        type TabProps = PropsRuntime<'main.workbench.assets.tab'> & PropsLocale<'assets.mantur'>
        const Tab = entry.component as ComponentType<TabProps>
        return <Tab {...owner as TabProps} {...standard} t={locale.bind('assets.mantur')} />
      }
      if (name === 'main.workbench.assets.content') {
        const entry = slots.entries(name)[0]
        if (!entry) return options?.fallback ?? null
        const Panel = entry.component as typeof AssetsPanel
        const commands = (entry.inject as () => AssetCommands)()
        return <Panel {...owner as ComponentProps<typeof AssetsPanel>} {...standard} {...commands} t={locale.bind('assets.mantur')} />
      }
      return null
    }
    const props = {
      ...standard, t: locale.bind('script.mantur'), closeWorkbench: vi.fn(),
      useStore: select => select(useSyncExternalStore(listener => state.subscribe(listener), () => state.getSnapshot())),
      actions: state.actions, renderSlot,
      ...(shell.inject as () => script.ScriptCommands)(),
    } satisfies ShellProps
    const view = render(<Workbench {...props} />)
    fireEvent.click(view.getByRole('button', { name: '资产' }))
    expect(view.getByLabelText('流水线报告')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '读取' }))
    expect((await view.findByRole('alert')).textContent).toBe('controlled provider error')
    expect(remote.manturAssets.load).toHaveBeenCalledWith(session, '资产/资产提取结果/assets-report.json')
    const entry = [...ctx.loader.entries()].find(item => item.options.name === 'assets')!
    await act(async () => { await entry.fiber!.dispose() })
    expect(slots.entries('main.workbench.assets.tab')).toHaveLength(0)
    expect(slots.entries('main.workbench.assets.content')).toHaveLength(0)
    expect(slots.entries('main.workbench')).toHaveLength(1)
    expect(disposeRemote).toHaveBeenCalledTimes(1)
    view.rerender(<Workbench {...props} />)
    expect(view.queryByRole('button', { name: '资产' })).toBeNull()
  } finally {
    cleanup()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
