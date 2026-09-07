/** Mantur-only sidebar navigation and marketplace page registration. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-authorization-manturhub/remote'
import manturMarketplaceRemote from '@deepseek-ai/dsh-manturhub-marketplace/remote'
import manturProjectsRemote from '@deepseek-ai/dsh-mantur-projects/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { GUIDE_NAMESPACE, type CreationMode, type GuideSettings } from '../guide-settings.ts'
import { CreationGuide, CreationModes, type GuidePreferencesInjected } from './CreationGuide.tsx'
import { ManturComposerLayout } from './ManturComposerLayout.tsx'
import { ProjectPathSettings, type ProjectPathSettingsInjected } from './ProjectPathSettings.tsx'
import { AutomaticProjectController } from './automatic-project.ts'
import { en as projectEn, zh as projectZh, type ProjectKey } from './project-locales.ts'
import { en as guideEn, zh as guideZh, type GuideKey } from './guide-locales.ts'
import {
  MarketplaceNavigation, MarketplacePage, ProjectsHeading,
} from './MarketplaceNavigation.tsx'
import { en, zh, type ManturNavigationKey } from './locales.ts'
import { ManturMarketplaceStore } from './store.ts'
import { NativeUpdates } from './desktop-updates.ts'
import { DesktopUpdate } from './DesktopUpdate.tsx'
import { en as updateEn, zh as updateZh, type UpdateKey } from './update-locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * An explicit mode selection was accepted by the settings host, including repeated selections.
     * @param mode - accepted creation mode; hydration does not emit this event.
     * @mode emit
     */
    'mantur/creation-mode-selected'(mode: CreationMode): void
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mantur marketplace navigation and empty-page copy. */
    'navigation.mantur': ManturNavigationKey
    /** Native desktop update copy. */
    'updates.mantur': UpdateKey
    /** Mantur creation-mode and assistant copy. */
    'guide.mantur': GuideKey
    /** Unassigned draft project location and creation status. */
    'projects.mantur': ProjectKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'navigation.mantur'
const ABSENT_GUIDE_INPUT = { getSnapshot: () => undefined, subscribe: () => () => {} }

/** Required UI services and declarations. */
export const inject = ['slots', 'locale', 'remote', 'sessions', 'workspaces', 'conversation', 'conversationDrafts', 'uiWorkspace', 'settingsScope']

/** Fill Mantur navigation, workspace terminology, and the root marketplace page. */
export async function apply(ctx: Context): Promise<void> {
  if (typeof window !== 'undefined' && window.manturUpdates !== undefined) {
    const native = new NativeUpdates(window.manturUpdates)
    ctx.effect(() => () => { native.dispose() }, 'ui-mantur-navigation: native updates')
    ctx.effect(() => ctx.locale.register('updates.mantur', { zh: updateZh, en: updateEn }), 'ui-mantur-navigation: update dictionaries')
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action', id: 'mantur.desktop-update', locale: 'updates.mantur',
      inject: () => ({ controller: native, hooks: { updates: native.store } }),
    }, DesktopUpdate))
  }
  const disposeMarketplace = await ctx.remote.$mount(manturMarketplaceRemote)
  ctx.effect(() => disposeMarketplace, 'ui-mantur-navigation: marketplace Remote')
  const disposeProjects = await ctx.remote.$mount(manturProjectsRemote)
  ctx.effect(() => disposeProjects, 'ui-mantur-navigation: projects Remote')
  ctx.inject(['remote.manturMarketplace', 'remote.manturAccount', 'remote.manturProjects'], (scope: Context) => {
    scope.effect(() => scope.locale.register(NS, { zh, en }), 'ui-mantur-navigation: dictionaries')
    scope.effect(() => scope.locale.register('guide.mantur', { zh: guideZh, en: guideEn }), 'ui-mantur-navigation: guide dictionaries')
    scope.effect(() => scope.locale.register('projects.mantur', { zh: projectZh, en: projectEn }), 'ui-mantur-navigation: project dictionaries')
    const projects = new AutomaticProjectController({
      remote: scope.remote.manturProjects, sessions: scope.sessions, workspace: scope.uiWorkspace,
      persistence: scope.conversation.draftPersistence, text: scope.locale.bind('projects.mantur'),
    })
    scope.effect(() => () => { projects.dispose() }, 'ui-mantur-navigation: project controller')
    scope.effect(() => scope.conversationDrafts.register(projects), 'ui-mantur-navigation: first-send project policy')
    void projects.load()
    const projectSettings: ProjectPathSettingsInjected = {
      hooks: { automaticProject: projects.store }, chooseRoot: () => projects.chooseRoot(), reloadRoot: () => projects.load(),
    }
    scope.slots.inject('settings.general.item', () => scope.slots.register({
      name: 'settings.general.item', id: 'mantur.project-path', order: 40, locale: 'projects.mantur',
      inject: () => projectSettings,
    }, ProjectPathSettings))
    const controller = new ManturMarketplaceStore(scope)
    const guideNavigation = createSnapshotStore(0)
    scope.effect(() => () => { controller.dispose() }, 'ui-mantur-navigation: marketplace controller')
    const preferences = scope.settingsScope.bind<GuideSettings>({ namespace: GUIDE_NAMESPACE })
    const guidePreferences: GuidePreferencesInjected = {
      hooks: { preferences },
      saveMode: async (mode) => {
        await preferences.set('mode', mode)
        const accepted = preferences.getSnapshot().value?.mode === mode
        if (accepted) scope.emit('mantur/creation-mode-selected', mode)
        return accepted
      },
      saveClosed: async (closed) => {
        await preferences.set('closed', closed)
        return preferences.getSnapshot().value?.closed === closed
      },
    }
    scope.slots.inject('conversation.hero.modes', () => scope.slots.register({
      name: 'conversation.hero.modes', locale: 'guide.mantur', inject: () => guidePreferences,
    }, CreationModes))
    scope.slots.inject('conversation.composer.layout', () => scope.slots.register({
      name: 'conversation.composer.layout', locale: 'projects.mantur',
      children: { 'conversation.composer.layout.permissions': { kind: 'single', scope: 'session-maybe' } },
      inject: () => ({
        hooks: projectSettings.hooks, reloadRoot: projectSettings.reloadRoot,
      }),
    }, ManturComposerLayout))
    scope.slots.inject('conversation.composer.guide', () => scope.slots.register({
      name: 'conversation.composer.guide', locale: 'guide.mantur',
      inject: (sessionId: SessionId | undefined) => ({
        ...guidePreferences,
        navigationVersion: () => guideNavigation.getSnapshot(),
        appendReference: (reference: ReferenceInsert) => {
          if (sessionId === undefined) return scope.conversationDrafts.input.appendReference(reference)
          const binding = scope.sessions.binding(sessionId)
          if (binding === undefined) return false
          return scope.conversation.input.for(binding.ctx).appendReference(reference)
        },
        hooks: {
          preferences, marketplace: controller.store, guideNavigation,
          guideInput: sessionId === undefined ? scope.conversationDrafts.input.state : (() => {
            const binding = scope.sessions.binding(sessionId)
            return binding === undefined ? ABSENT_GUIDE_INPUT : scope.conversation.input.for(binding.ctx).state
          })(),
        },
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
          yield scope.slots.register({ name: 'sidebar.navigation', locale: NS,
            inject: () => ({ beforeOpenPage: () => { guideNavigation.set(guideNavigation.getSnapshot() + 1) } }),
          }, MarketplaceNavigation)
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
