import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  MarketplaceNavigation, MarketplacePage, ProjectsHeading,
} from '../src/client/MarketplaceNavigation.tsx'
import * as clientEntry from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { CreationGuide, CreationModes } from '../src/client/CreationGuide.tsx'
import { GUIDE_NAMESPACE } from '../src/guide-settings.ts'

vi.mock('@deepseek-ai/dsh-manturhub-marketplace/remote', () => ({
  default: { package: '@deepseek-ai/dsh-manturhub-marketplace', descriptors: [] },
}))

async function bench() {
  const ctx = new Context()
  const remote = new TestRemote(ctx, { manturMarketplace: {}, manturAccount: {} })
  remote.$mount = () => Promise.resolve(() => Promise.resolve())
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('sessions', {} as never)
  ctx.provide('workspaces', {} as never)
  ctx.provide('conversation', {} as never)
  ctx.provide('settingsScope', { bind: vi.fn(() => ({ getSnapshot: () => ({ value: undefined }), subscribe: () => () => {}, set: vi.fn() })) } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'sidebar.navigation': { kind: 'single', scope: 'root' },
      'sidebar.workspaces.heading': { kind: 'single', scope: 'root' },
      'main.page': { kind: 'single', scope: 'root' },
      'conversation.hero.modes': { kind: 'single', scope: 'root' },
      'conversation.composer.guide': { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
  return { ctx, locale, slots }
}

describe('ui-mantur-navigation apply', () => {
  it('registers host preferences and declares browser services', () => {
    const register = vi.fn()
    const ctx = { inject: (_services: string[], callback: (scope: unknown) => void) => { callback({ settings: { register } }) } }
    const config = { recommendations: { script: [], production: [], editing: [], assets: [] } }
    hostApply(ctx as unknown as Context, config)
    expect(register).toHaveBeenCalledWith(GUIDE_NAMESPACE, expect.anything(), { base: { ...config, mode: 'script', closed: false } })
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation', 'settingsScope'])
    expect(Object.keys(clientEntry).sort()).toEqual(['apply', 'inject'])
  })

  it('registers all Mantur occupants and removes them together on unload', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(subject.slots.entries('sidebar.navigation')[0]?.component).toBe(MarketplaceNavigation)
    expect(subject.slots.entries('sidebar.workspaces.heading')[0]?.component).toBe(ProjectsHeading)
    const mainPage = subject.slots.entries('main.page')[0]
    expect(mainPage?.component).toBe(MarketplacePage)
    const injected = (mainPage?.inject as (() => {
      controller: unknown
      hooks: { marketplace: unknown; recipes: unknown }
    }))()
    expect(injected.controller).toBeTruthy()
    expect(injected.hooks.marketplace).toBeTruthy()
    expect(injected.hooks.recipes).toBeTruthy()
    expect(subject.locale.bind('navigation.mantur')('projects')).toBe('项目')
    expect(subject.slots.entries('conversation.hero.modes')[0]?.component).toBe(CreationModes)
    expect(subject.slots.entries('conversation.composer.guide')[0]?.component).toBe(CreationGuide)

    await fiber.dispose()
    expect(subject.slots.entries('sidebar.navigation')).toEqual([])
    expect(subject.slots.entries('sidebar.workspaces.heading')).toEqual([])
    expect(subject.slots.entries('main.page')).toEqual([])
    expect(subject.slots.entries('conversation.hero.modes')).toEqual([])
    expect(subject.slots.entries('conversation.composer.guide')).toEqual([])
  })
})
