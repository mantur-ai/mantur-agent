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

vi.mock('@deepseek-ai/dsh-client-ui-mantur-script/remote', () => ({ default: {} }))
vi.mock('@deepseek-ai/dsh-client-ui-mantur-editing/remote', () => ({ default: {} }))

async function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('theme', { getTheme: () => ({ active: { colorScheme: 'light' } }) } as never)
  const layout = { openWorkbench: vi.fn(), closeWorkbench: vi.fn() }
  ctx.provide('layout', layout as never)
  const send = vi.fn(async (_text: string) => {})
  let current: SessionId | undefined = 'session-a' as SessionId
  let bound = true
  const sessions = {
    list: { getSnapshot: () => ({ current }), subscribe: () => () => {} },
    binding: vi.fn((id: SessionId) => bound ? { ctx: { get: () => id === 'session-a' ? { send } : undefined } } : undefined),
  }
  ctx.provide('sessions', sessions as never)
  new UiConversation(ctx, sessions as never)
  ctx.provide('remote', { $mount: vi.fn(async () => async () => {}) } as never)
  ctx.provide('remote.manturScript', {} as never)
  ctx.provide('remote.manturEditing', {} as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'main.workbench': { kind: 'single', scope: 'root' }, 'main.workbench.toggle': { kind: 'single', scope: 'root' },
  } } as never, () => null)
  const fiber = ctx.plugin(script)
  await fiber.await()
  return { ctx, slots, fiber, layout, send, sessions, select: (id: SessionId) => { current = id }, unbind: () => { bound = false } }
}

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
