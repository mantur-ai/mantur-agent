import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  MarketplaceNavigation, MarketplacePage, ProjectsHeading,
} from '../src/client/MarketplaceNavigation.tsx'
import * as clientEntry from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { CreationGuide, CreationModes, type CreationGuideInjected, type GuidePreferencesInjected } from '../src/client/CreationGuide.tsx'
import { ManturComposerLayout } from '../src/client/ManturComposerLayout.tsx'
import { GUIDE_NAMESPACE, type GuideSettings } from '../src/guide-settings.ts'
import type { ManturMarketplaceStore } from '../src/client/store.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

afterEach(() => { vi.restoreAllMocks() })

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
  const binding = vi.fn()
  const appendReference = vi.fn(() => true)
  ctx.provide('sessions', { binding } as never)
  ctx.provide('workspaces', {} as never)
  ctx.provide('conversation', { input: { for: () => ({ appendReference }) } } as never)
  const preferences = {
    getSnapshot: vi.fn(() => ({ value: undefined as GuideSettings | undefined })), subscribe: () => () => {}, set: vi.fn(),
  }
  ctx.provide('settingsScope', { bind: vi.fn(() => preferences) } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'sidebar.navigation': { kind: 'single', scope: 'root' },
      'sidebar.workspaces.heading': { kind: 'single', scope: 'root' },
      'main.page': { kind: 'single', scope: 'root' },
      'conversation.hero.modes': { kind: 'single', scope: 'root' },
      'conversation.composer.guide': { kind: 'single', scope: 'session-maybe' },
      'conversation.composer.layout': { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
  return { ctx, locale, slots, preferences, binding, appendReference }
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
    expect(subject.slots.entries('conversation.composer.layout')[0]?.component).toBe(ManturComposerLayout)

    await fiber.dispose()
    expect(subject.slots.entries('sidebar.navigation')).toEqual([])
    expect(subject.slots.entries('sidebar.workspaces.heading')).toEqual([])
    expect(subject.slots.entries('main.page')).toEqual([])
    expect(subject.slots.entries('conversation.hero.modes')).toEqual([])
    expect(subject.slots.entries('conversation.composer.guide')).toEqual([])
    expect(subject.slots.entries('conversation.composer.layout')).toEqual([])
  })

  it('confirms persisted choices and delegates guide actions to their existing owners', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      const modeProps = (subject.slots.entries('conversation.hero.modes')[0]!.inject as unknown as () => GuidePreferencesInjected)()
      expect(await modeProps.saveMode('editing')).toBe(false)
      expect(await modeProps.saveClosed(true)).toBe(false)
      const value: GuideSettings = { mode: 'editing', closed: true, recommendations: { script: [], editing: [], production: [], assets: [] } }
      subject.preferences.getSnapshot.mockReturnValue({ value })
      expect(await modeProps.saveMode('editing')).toBe(true)
      expect(await modeProps.saveClosed(true)).toBe(true)
      expect(subject.preferences.set).toHaveBeenCalledWith('mode', 'editing')
      expect(subject.preferences.set).toHaveBeenCalledWith('closed', true)
      const createGuide = subject.slots.entries('conversation.composer.guide')[0]!.inject as unknown as
        (id: SessionId | undefined) => CreationGuideInjected
      const reference = { source: 'skill', ref: 'short-drama', label: '爽文短剧剧本创作', clipboardText: '/short-drama' }
      expect(createGuide(undefined).appendReference(reference)).toBe(false)
      const guide = createGuide('guide-session' as SessionId)
      expect(guide.appendReference(reference)).toBe(false)
      subject.binding.mockReturnValue({ ctx: subject.ctx })
      expect(guide.appendReference(reference)).toBe(true)
      expect(subject.appendReference).toHaveBeenCalledWith(reference)
      const { controller } = (subject.slots.entries('main.page')[0]!.inject as () => { controller: ManturMarketplaceStore })()
      const load = vi.spyOn(controller, 'load').mockResolvedValue()
      const catalog = vi.spyOn(controller, 'ensureSkillCatalog').mockResolvedValue()
      const detail = vi.spyOn(controller, 'openDetail').mockResolvedValue()
      const close = vi.spyOn(controller, 'closeDetail').mockImplementation(() => {})
      const login = vi.spyOn(controller, 'startLogin').mockResolvedValue()
      const cancel = vi.spyOn(controller, 'cancelLogin').mockResolvedValue()
      const install = vi.spyOn(controller, 'install').mockResolvedValue()
      await guide.load()
      await guide.ensureCatalog()
      await guide.openDetail('short-drama')
      guide.closeDetail()
      await guide.startLogin()
      await guide.cancelLogin()
      expect(load).toHaveBeenCalledOnce()
      expect(catalog).toHaveBeenCalledOnce()
      expect(detail).toHaveBeenCalledWith('short-drama')
      expect(close).toHaveBeenCalledOnce()
      expect(login).toHaveBeenCalledOnce()
      expect(cancel).toHaveBeenCalledOnce()
      expect(await guide.install('short-drama')).toBe(false)
      const skill = { slug: 'short-drama', name: '剧本', description: '', category: '', installed: false, version: '1', triggers: [] }
      controller.store.set({ phase: 'ready', catalog: { skills: [{ ...skill, slug: 'different' }, skill], installedCount: 0, signedIn: true } })
      expect(await guide.install('short-drama')).toBe(false)
      controller.store.set({ phase: 'ready', catalog: { skills: [{ ...skill, installed: true }], installedCount: 1, signedIn: true } })
      expect(await guide.install('short-drama')).toBe(true)
      expect(install).toHaveBeenCalledWith('short-drama')
    } finally {
      await fiber.dispose()
    }
  })
})
