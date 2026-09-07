/** Opt-in editor presentation driven by explicit Mantur mode selections. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-mantur-navigation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import editingRemote from '@deepseek-ai/dsh-client-ui-mantur-editing/remote'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { EditingWorkspace } from '../types.ts'
import { en, zh, type EditingKey } from './locales.ts'
import { EditingAction, Workbench } from './Workbench.tsx'

/** Host workspace command and Mantur appearance subscriptions. */
export interface WorkbenchInjection {
  /** Open the Session's local editor. @param sessionId - Selected Session. @returns Its workspace. */
  openWorkspace: (sessionId: SessionId) => Promise<EditingWorkspace>
  /** Read Mantur's locale. @returns Active language id. */
  getLocale: () => string
  /** Follow Mantur's language. @param notify - React invalidation. @returns Listener disposer. */
  subscribeLocale: (notify: () => void) => () => void
  /** Read Mantur's resolved palette. @returns Active light or dark scheme. */
  getColorScheme: () => 'light' | 'dark'
  /** Subscribe to theme changes. @param notify - React invalidation callback. @returns Listener disposer. */
  subscribeTheme: (notify: () => void) => () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mantur local editing controls. */
    'editing.mantur': EditingKey
  }
}

/** Services used by this optional workbench. */
export const inject = ['slots', 'locale', 'layout', 'theme', 'remote']

/**
 * Register the editor and release its mode listener with the plugin.
 * @param ctx - plugin context.
 */
export async function apply(ctx: Context): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(editingRemote)
  ctx.effect(() => disposeRemote, 'editing: client remote')
  await ctx.inject(['remote.manturEditing'], installWorkbench).await()
}

function installWorkbench(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('editing.mantur', { en, zh }), 'editing: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'mantur-editing', order: 30, locale: 'editing.mantur',
    inject: () => ({ openWorkbench: () => { ctx.layout.openWorkbench() } }),
  }, EditingAction))
  ctx.slots.inject('main.workbench', () => ctx.slots.register({
    name: 'main.workbench', locale: 'editing.mantur',
    inject: (): WorkbenchInjection => ({
      openWorkspace: async (sessionId) => {
        const result = await ctx.remote.manturEditing.open(sessionId, window.location.origin)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      getLocale: () => ctx.locale.getSnapshot().active,
      subscribeLocale: notify => ctx.on('locale/change', notify),
      getColorScheme: () => ctx.theme.getTheme().active.colorScheme,
      subscribeTheme: notify => ctx.on('theme/change', notify),
    }),
  }, Workbench))
  ctx.on('mantur/creation-mode-selected', (mode) => {
    if (mode === 'editing') ctx.layout.openWorkbench()
    else ctx.layout.closeWorkbench()
  })
  ctx.effect(() => () => { ctx.layout.closeWorkbench() }, 'editing: close on unload')
}
