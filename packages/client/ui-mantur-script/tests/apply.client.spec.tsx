// @vitest-environment jsdom
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ScriptVersion } from '../src/types.ts'
import * as script from '../src/client/index.ts'
import * as editing from '../../ui-mantur-editing/src/client/index.ts'
import { Workbench } from '../src/client/Workbench.tsx'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useState, useSyncExternalStore, type ComponentProps } from 'react'
import { zh } from '../src/client/locales.ts'
import type { createWorkbenchStore } from '../src/client/store.ts'
import { createAssetFixture } from './assets.fixture.client.ts'

vi.mock('@deepseek-ai/dsh-client-ui-mantur-script/remote', () => ({ default: {} }))
vi.mock('@deepseek-ai/dsh-client-ui-mantur-editing/remote', () => ({ default: {} }))

async function setup(assetPlugin?: { inject: string[]; apply: (ctx: Context) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'asset-shell-loader-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('theme', { getTheme: () => ({ active: { colorScheme: 'light' } }) } as never)
  const layout = { openWorkbench: vi.fn(), closeWorkbench: vi.fn() }
  ctx.provide('layout', layout as never)
  const send = vi.fn(async (_text: string) => {})
  let current: SessionId | undefined = 'session-a' as SessionId
  let bound = true
  const sessions = {
    list: { getSnapshot: () => ({ current, byId: {} }), subscribe: () => () => {} },
    binding: vi.fn((id: SessionId) => bound ? { ctx: { get: () => id === 'session-a' ? { send } : undefined } } : undefined),
  }
  ctx.provide('sessions', sessions as never)
  new UiConversation(ctx, sessions as never)
  const manturScript = { list: async () => ({ ok: true, value: [] }) }
  ctx.provide('remote', { $mount: vi.fn(async () => async () => {}), manturScript } as never)
  ctx.provide('remote.manturScript', manturScript as never)
  ctx.provide('remote.manturEditing', {} as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'main.workbench': { kind: 'single', scope: 'root' }, 'main.workbench.toggle': { kind: 'single', scope: 'root' },
  } } as never, () => null)
  const config = join(root, 'cordis.yml')
  await writeFile(config, (assetPlugin === undefined ? '' : '- name: asset-fixture\n') + '- name: script-shell\n')
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name: string) {
    if (name === 'asset-fixture' && assetPlugin !== undefined) return assetPlugin
    if (name !== 'script-shell') throw new Error('Unexpected plugin')
    return script
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const fiber = [...ctx.loader.entries()].find(entry => entry.options.name === 'script-shell')!.fiber!
  return { ctx, slots, fiber, layout, send, sessions, locale, select: (id: SessionId) => { current = id }, unbind: () => { bound = false } }
}

async function assets() {
  const fixture = await createAssetFixture()
  const plugin = {
    inject: ['slots', 'sessions', 'uiConversation'],
    apply(ctx: Context) {
      ctx.slots.inject('main.workbench.assets.tab', () => ctx.slots.register({
        name: 'main.workbench.assets.tab',
      }, props => <button onClick={props.selectAssets}>测试资产</button>))
      ctx.slots.inject('main.workbench.assets.content', () => ctx.slots.register({
        name: 'main.workbench.assets.content',
        inject: () => ({
          submit: (ids: string[]) => fixture.submit(ctx.sessions, ids),
          edit: (text: string) => { fixture.edit(text) },
        }),
      }, (props) => {
        const [status, setStatus] = useState('')
        async function send(ids: string[]) {
          try { await props.submit(ids); setStatus('已入队') }
          catch (error) { setStatus(String(error)) }
        }
        return <section aria-label="受控资产">
          <input aria-label="资产草稿" onChange={(event) => { props.edit(event.target.value) }} />
          <button onClick={() => { void send([fixture.clip]) }}>发送单项</button>
          <button onClick={() => { void send([fixture.character, fixture.clip]) }}>发送批量</button>
          <output>{status}</output>
        </section>
      }))
    },
  }
  const runtime = await setup(plugin)
  const shell = runtime.slots.entries('main.workbench')[0]!
  const state = (shell.store as unknown as ReturnType<typeof createWorkbenchStore>).create()
  type Props = ComponentProps<typeof Workbench>
  const props = {
    useSessions: select => select(runtime.sessions.list.getSnapshot() as never),
    useStore: select => select(useSyncExternalStore(notify => state.subscribe(notify), () => state.getSnapshot())),
    actions: state.actions, t: runtime.locale.bind('script.mantur'), closeWorkbench: runtime.layout.closeWorkbench,
    ...(shell.inject as unknown as () => script.ScriptCommands)(),
    renderSlot: ((key: string, owner: object, options?: { fallback?: React.ReactNode }) => {
      const entry = runtime.slots.entries(key as 'main.workbench.assets.content')[0]
      if (entry === undefined) return options?.fallback ?? null
      const Component = entry.component as React.ComponentType<object>
      const injected = (entry.inject as (() => object) | undefined)?.() ?? {}
      return <Component {...owner} {...injected} />
    }) as Props['renderSlot'],
  } satisfies Partial<Props>
  const view = render(<Workbench {...props as Props} />)
  onTestFinished(cleanup)
  fireEvent.click(view.getByRole('button', { name: '测试资产' }))
  return { ...runtime, ...view, fixture, state, props }
}

it.each(['发送单项', '发送批量'])('loads optional assets under the single shell and delivers %s to its captured conversation', async (button) => {
  const view = await assets()
  const before = structuredClone(view.fixture.state.rows)
  fireEvent.click(view.getByRole('button', { name: button }))
  await view.findByText('已入队')
  expect(view.slots.entries('main.workbench')).toHaveLength(1)
  expect(view.slots.entries('main.workbench.toggle')).toHaveLength(1)
  expect(view.send).toHaveBeenCalledOnce()
  const message = JSON.parse(view.send.mock.calls[0]![0]) as { sessionId: string; targets: { id: string }[]; allowedFields: string[] }
  expect(message.targets.map((target: { id: string }) => target.id)).toEqual(button === '发送单项' ? [view.fixture.clip] : [view.fixture.character, view.fixture.clip])
  expect(message.sessionId).toBe('session-a')
  expect(message.allowedFields).toEqual(['prompt', 'negativePrompt'])
  expect(view.fixture.state.rows).toEqual(before)
  expect(view.fixture.state.requests[0]?.targets.map(target => target.status)).toEqual(message.targets.map(() => 'accepted'))
  expect(view.container.innerHTML).toMatchSnapshot()
  view.fixture.proposeAndConfirm()
  expect(view.fixture.state.requests[0]?.targets.every(target => target.status === 'applied')).toBe(true)
  for (const row of view.fixture.state.rows) {
    const original = before.find(item => item.id === row.id)!
    expect(row.media).toEqual(original.media)
    expect(row.generation).toEqual(original.generation)
    expect(row.version).toBe(message.targets.some((target: { id: string }) => target.id === row.id) ? 2 : original.version)
  }
  await view.fiber.dispose()
  expect(view.slots.entries('main.workbench.assets.content')).toHaveLength(0)
  expect(view.slots.entries('main.workbench')).toHaveLength(0)
})

it('preserves the captured request and newer draft while queue admission is pending across a session switch', async () => {
  const view = await assets()
  const pending = Promise.withResolvers<undefined>()
  view.send.mockImplementationOnce(() => pending.promise)
  fireEvent.click(view.getByRole('button', { name: '发送单项' }))
  await waitFor(() => { expect(view.send).toHaveBeenCalledOnce() })
  fireEvent.change(view.getByRole('textbox', { name: '资产草稿' }), { target: { value: '排队期间继续修改' } })
  fireEvent.click(view.getByRole('button', { name: zh.script }))
  fireEvent.click(view.getByRole('button', { name: '测试资产' }))
  expect((view.getByRole('textbox', { name: '资产草稿' }) as HTMLInputElement).value).toBe('排队期间继续修改')
  view.select('session-b' as SessionId)
  await act(async () => { pending.resolve(undefined) })
  await view.findByText('已入队')
  view.fixture.proposeAndConfirm()
  expect(view.fixture.state.requests[0]?.sessionId).toBe('session-a')
  expect(view.fixture.state.requests[0]?.targets[0]?.status).toBe('conflict')
  expect(view.fixture.state.drafts[view.fixture.clip]?.prompt).toBe('排队期间继续修改')
  expect(view.fixture.state.rows.find(row => row.id === view.fixture.clip)?.version).toBe(1)
})

it('refuses a source changed before send and preserves proposals when a source changes before confirmation', async () => {
  const stale = await assets()
  stale.fixture.changeSource()
  fireEvent.click(stale.getByRole('button', { name: '发送单项' }))
  await stale.findByText('Error: SOURCE_CHANGED')
  expect(stale.send).not.toHaveBeenCalled()
  stale.unmount()
  const view = await assets()
  fireEvent.click(view.getByRole('button', { name: '发送批量' }))
  await view.findByText('已入队')
  view.fixture.changeSource()
  view.fixture.proposeAndConfirm()
  expect(view.fixture.state.requests[0]?.targets.every(target => target.status === 'conflict')).toBe(true)
  expect(view.fixture.state.rows.every(row => row.version === 1)).toBe(true)
})

it('shows an unavailable asset panel after its provider unloads while retaining the shell', async () => {
  const view = await assets()
  const entry = [...view.ctx.loader.entries()].find(item => item.options.name === 'asset-fixture')!
  await act(async () => { await entry.fiber!.dispose() })
  view.rerender(<Workbench {...view.props as ComponentProps<typeof Workbench>} />)
  expect(view.getByText(zh.assetsUnavailable)).toBeTruthy()
  expect(view.queryByRole('button', { name: '测试资产' })).toBeNull()
  expect(view.slots.entries('main.workbench')).toHaveLength(1)
  expect(view.layout.closeWorkbench).not.toHaveBeenCalled()
})

it('reports rejected delivery without admission or automatic retry', async () => {
  const view = await assets()
  view.send.mockRejectedValueOnce(new Error('Queue unavailable'))
  fireEvent.click(view.getByRole('button', { name: '发送单项' }))
  await view.findByText('Error: Queue unavailable')
  expect(view.send).toHaveBeenCalledOnce()
  expect(view.fixture.state.requests[0]?.targets[0]?.status).toBe('queued')
  expect(view.queryByText('已入队')).toBeNull()
})

it('has one shell owner and removing editing leaves the script shell mounted', async () => {
  const { ctx, slots, fiber, layout } = await setup()
  const child = ctx.plugin(editing)
  await child.await()
  expect(slots.entries('main.workbench')).toHaveLength(1)
  expect(slots.entries('main.workbench')[0]?.component).toBe(Workbench)
  expect(slots.entries('main.workbench.toggle')).toHaveLength(1)
  expect(slots.entries('main.workbench.editing.content')).toHaveLength(1)
  await child.dispose()
  expect(layout.closeWorkbench).not.toHaveBeenCalled()
  expect(slots.entries('main.workbench')).toHaveLength(1)
  expect(slots.entries('main.workbench.editing.content')).toHaveLength(0)
  await fiber.dispose()
  expect(layout.closeWorkbench).toHaveBeenCalledOnce()
  expect(slots.entries('main.workbench')).toHaveLength(0)
})

it('sends the logged request only through its captured Session and rejects a switched or unavailable binding', async () => {
  const { slots, send, sessions, select, unbind } = await setup()
  const entry = slots.entries('main.workbench')[0]!
  const commands = (entry.inject as unknown as () => script.ScriptCommands)()
  const selection = { path: '/project/01.md', version: 'version' as ScriptVersion, start: 5, end: 7, selected: '台词' }
  await commands.send('session-a' as SessionId, selection, '更简练')
  expect(sessions.binding).toHaveBeenCalledWith('session-a')
  expect(JSON.parse(send.mock.calls[0]![0])).toMatchObject({ ...selection, instruction: '更简练' })
  select('session-b' as SessionId)
  await expect(commands.send('session-a' as SessionId, selection, '不得串发')).rejects.toThrow('changed')
  select('session-a' as SessionId); unbind()
  await expect(commands.send('session-a' as SessionId, selection, '缺少会话')).rejects.toThrow('unavailable')
  expect(send).toHaveBeenCalledOnce()
})
