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
import type { AssetSnapshot } from '../src/types.ts'
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
    ctx.provide('layout', { closeWorkbench: vi.fn() } as unknown as Context['layout'])
    ctx.provide('uiConversation', {} as Context['uiConversation'])
    const session = 'asset-loader-session' as SessionId
    const sessionState = { current: session, byId: {} }
    const send = vi.fn(async (_text: string) => {})
    let bound = true
    ctx.provide('sessions', { list: { getSnapshot: () => sessionState }, binding: () => bound ? { ctx: { get: () => ({ send }) } } : undefined } as unknown as Context['sessions'])
    const disposeRemote = vi.fn(async () => {})
    const snapshot: AssetSnapshot = { source: { path: '/project/assets.json', version: 'v1' as never, sha256: 'hash' }, stateVersion: null, state: { format: 1, path: '/project/assets.json', drafts: [], proposals: [], history: [], pending: null }, rows: [], projectState: null }
    const remote = {
      $mount: vi.fn(async () => disposeRemote),
      manturScript: { list: async () => ({ ok: true, value: [] }) },
      manturAssets: {
        load: vi.fn(async (): Promise<{ ok: true; value: AssetSnapshot } | { ok: false; error: { message: string } }> => { throw new Error('controlled provider error') }),
        saveDraft: vi.fn(async () => ({ ok: true, value: snapshot })),
        prepare: vi.fn(async () => ({ ok: true, value: { requestId: 'proposal-1', source: snapshot.source, edits: [] } })),
        apply: vi.fn(async () => ({ ok: true, value: snapshot })),
        candidates: vi.fn(async () => ({ ok: true, value: [] })),
        preview: vi.fn(async () => ({ ok: true, value: { id: null, name: 'image.png', kind: 'image', url: '/preview' } })),
      },
    }
    ctx.provide('remote', remote as unknown as Context['remote'])
    ctx.provide('remote.manturAssets', remote.manturAssets)
    ctx.provide('remote.manturScript', remote.manturScript)
    ;(ctx.slots.register as unknown as (options: unknown, component: unknown) => () => void)({ name: 'root', children: {
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
        return <Tab {...owner as unknown as TabProps} {...standard as unknown as TabProps} t={locale.bind('assets.mantur')} />
      }
      if (name === 'main.workbench.assets.content') {
        const entry = slots.entries(name)[0]
        if (!entry) return options?.fallback ?? null
        const Panel = entry.component as typeof AssetsPanel
        const commands = (entry.inject as unknown as () => AssetCommands)()
        return <Panel {...owner as unknown as ComponentProps<typeof AssetsPanel>} {...standard as unknown as ComponentProps<typeof AssetsPanel>} {...commands} t={locale.bind('assets.mantur')} />
      }
      return null
    }
    const props = {
      ...standard, t: locale.bind('script.mantur'), closeWorkbench: vi.fn(),
      useStore: (select: (value: ReturnType<typeof state.getSnapshot>) => unknown) => select(
        useSyncExternalStore(listener => state.subscribe(listener), () => state.getSnapshot()),
      ),
      actions: state.actions, renderSlot,
      ...(shell.inject as unknown as () => script.ScriptCommands)(),
    } as unknown as ShellProps
    const view = render(<Workbench {...props} />)
    fireEvent.click(view.getByRole('button', { name: '资产' }))
    expect(view.getByLabelText('流水线报告')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '读取' }))
    expect((await view.findByRole('alert')).textContent).toBe('controlled provider error')
    expect(remote.manturAssets.load).toHaveBeenCalledWith(session, '资产/资产提取结果/assets-report.json')
    const commands = (slots.entries('main.workbench.assets.content')[0]!.inject as unknown as () => AssetCommands)()
    remote.manturAssets.load.mockResolvedValueOnce({ ok: false, error: { message: 'asset report changed' } })
    await expect(commands.load(session, 'assets.json')).rejects.toThrow('asset report changed')
    remote.manturAssets.load.mockResolvedValueOnce({ ok: true, value: snapshot })
    await expect(commands.load(session, 'assets.json')).resolves.toBe(snapshot)
    await expect(commands.save(session, snapshot, [])).resolves.toBe(snapshot)
    expect(remote.manturAssets.saveDraft).toHaveBeenCalledWith(session, { source: snapshot.source, stateVersion: null, edits: [] })
    await expect(commands.apply(session, 'proposal-1')).resolves.toBe(snapshot)
    await expect(commands.candidates(session, 'images')).resolves.toEqual([])
    await expect(commands.preview(session, 'image.png')).resolves.toMatchObject({ name: 'image.png', url: '/preview' })
    await expect(commands.request(session, snapshot, [], 'rewrite')).resolves.toBe('proposal-1')
    expect(JSON.parse(send.mock.calls[0]![0])).toMatchObject({ requestId: 'proposal-1', source: snapshot.source })
    bound = false
    await expect(commands.request(session, snapshot, [], 'rewrite')).rejects.toThrow('owning conversation')
    expect(send).toHaveBeenCalledOnce()
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
