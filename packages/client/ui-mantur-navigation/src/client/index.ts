/** Mantur-only sidebar navigation and marketplace page registration. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-authorization-manturhub/remote'
import manturMarketplaceRemote from '@deepseek-ai/dsh-manturhub-marketplace/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { GUIDE_NAMESPACE, type GuideSettings } from '../guide-settings.ts'
import { CreationGuide, CreationModes, type GuidePreferencesInjected } from './CreationGuide.tsx'
import { en as guideEn, zh as guideZh, type GuideKey } from './guide-locales.ts'
import {
  MarketplaceNavigation, MarketplacePage, ProjectsHeading,
} from './MarketplaceNavigation.tsx'
import { en, zh, type ManturNavigationKey } from './locales.ts'
import { ManturMarketplaceStore } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mantur marketplace navigation and empty-page copy. */
    'navigation.mantur': ManturNavigationKey
    /** Mantur creation-mode and assistant copy. */
    'guide.mantur': GuideKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'navigation.mantur'

/** Required UI services and declarations. */
export const inject = ['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation', 'settingsScope']

/** Fill Mantur navigation, workspace terminology, and the root marketplace page. */
export async function apply(ctx: Context): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(manturMarketplaceRemote)
  ctx.effect(() => disposeRemote, 'ui-mantur-navigation: marketplace Remote')
  ctx.inject(['remote.manturMarketplace', 'remote.manturAccount'], (scope: Context) => {
    scope.effect(() => scope.locale.register(NS, { zh, en }), 'ui-mantur-navigation: dictionaries')
    scope.effect(() => scope.locale.register('guide.mantur', { zh: guideZh, en: guideEn }), 'ui-mantur-navigation: guide dictionaries')
    const controller = new ManturMarketplaceStore(scope)
    scope.effect(() => () => { controller.dispose() }, 'ui-mantur-navigation: marketplace controller')
    const preferences = scope.settingsScope.bind<GuideSettings>({ namespace: GUIDE_NAMESPACE })
    const guidePreferences: GuidePreferencesInjected = {
      hooks: { preferences },
      saveMode: async (mode) => {
        await preferences.set('mode', mode)
        return preferences.getSnapshot().value?.mode === mode
      },
      saveClosed: async (closed) => {
        await preferences.set('closed', closed)
        return preferences.getSnapshot().value?.closed === closed
      },
    }
    scope.slots.inject('conversation.hero.modes', () => scope.slots.register({
      name: 'conversation.hero.modes', locale: 'guide.mantur', inject: () => guidePreferences,
    }, CreationModes))
    scope.slots.inject('conversation.composer.guide', () => scope.slots.register({
      name: 'conversation.composer.guide', locale: 'guide.mantur',
      inject: (sessionId: SessionId | undefined) => ({
        ...guidePreferences,
        appendReference: (reference: ReferenceInsert) => {
          if (sessionId === undefined) return false
          const binding = scope.sessions.binding(sessionId)
          if (binding === undefined) return false
          return scope.conversation.input.for(binding.ctx).appendReference(reference)
        },
        hooks: { preferences, marketplace: controller.store },
        marketplaceText: scope.locale.bind(NS),
        load: () => controller.load(),
        ensureCatalog: () => controller.ensureSkillCatalog(),
        openDetail: (slug: string) => controller.openDetail(slug),
        closeDetail: () => { controller.closeDetail() },
        install: async (slug: string) => {
          await controller.install(slug)
          const state = controller.store.getSnapshot()
          return state.phase === 'ready' && state.catalog.skills.some(skill => skill.slug === slug && skill.installed)
        },
        startLogin: () => controller.startLogin(),
        cancelLogin: () => controller.cancelLogin(),
      }),
    }, CreationGuide))
    scope.slots.inject('sidebar.navigation', () =>
      scope.slots.inject('sidebar.workspaces.heading', () =>
        scope.slots.inject('main.page', function* () {
          yield scope.slots.register({ name: 'sidebar.navigation', locale: NS }, MarketplaceNavigation)
          yield scope.slots.register({ name: 'sidebar.workspaces.heading', locale: NS }, ProjectsHeading)
          yield scope.slots.register({
            name: 'main.page', locale: NS,
            inject: () => ({
              controller,
              hooks: { marketplace: controller.store, recipes: controller.recipes },
            }),
          }, MarketplacePage)
        })))
  })
}

export type {
  ManturMarketPageId, MarketplaceNavigationProps, MarketplacePageProps,
} from './MarketplaceNavigation.tsx'
export type { ManturNavigationKey } from './locales.ts'
