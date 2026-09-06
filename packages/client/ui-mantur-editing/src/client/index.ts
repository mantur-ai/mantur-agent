/** Opt-in editor presentation driven by explicit Mantur mode selections. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-mantur-navigation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { EditingSettings } from '../settings.ts'
import { en, zh, type EditingKey } from './locales.ts'
import { Workbench } from './Workbench.tsx'

/** Private settings observable bound to a framework hook at the slot. */
export interface WorkbenchInjection {
  hooks: { preferences: SettingsScope<EditingSettings> }
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
export const inject = ['slots', 'locale', 'layout', 'settingsScope', 'theme']

/**
 * Register the editor and release its mode listener with the plugin.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('editing.mantur', { en, zh }), 'editing: dictionaries')
  const preferences = ctx.settingsScope.bind<EditingSettings>({ namespace: 'ui-mantur-editing' })
  ctx.slots.inject('main.workbench', () => ctx.slots.register({
    name: 'main.workbench', locale: 'editing.mantur',
    inject: (): WorkbenchInjection => ({
      hooks: { preferences },
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
