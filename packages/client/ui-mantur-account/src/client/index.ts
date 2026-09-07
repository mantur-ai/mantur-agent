/** Mantur account onboarding and Settings occupants. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import manturAccountRemote from '@deepseek-ai/dsh-authorization-manturhub/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AccountOnboarding, type AccountOnboardingInjected } from './AccountOnboarding.tsx'
import { AccountSection, type AccountSectionInjected } from './AccountSection.tsx'
import { ManturAccountStore } from './store.ts'
import { NativeAccountClient } from './native-account.ts'
import { NativeAccountOnboarding, NativeAccountSection, type NativeAccountInjected } from './NativeAccountSurfaces.tsx'
import { en, zh, type ManturAccountKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mantur account onboarding and Settings copy. */
    'settings.manturAccount': ManturAccountKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.manturAccount'

/** Services required by the two account surfaces. */
export const inject = ['slots', 'locale', 'remote']

/** Register Mantur account onboarding before model credentials and expose later sign-out. */
export async function apply(ctx: Context): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(manturAccountRemote)
  ctx.effect(() => disposeRemote, 'ui-mantur-account: Remote contribution')
  ctx.inject(['remote.manturAccount'], async (scope: Context) => {
    scope.effect(() => scope.locale.register(NS, { zh, en }), 'ui-mantur-account: dictionaries')
    const t = scope.locale.bind(NS)
    const identity = await scope.remote.manturAccount.identityMode()
    if (!identity.ok || identity.value === 'desktop-managed') {
      const client = new NativeAccountClient(identity.ok ? window.manturAccount : undefined)
      scope.effect(() => client.connect(), 'ui-mantur-account: native account observation')
      const injected = (): NativeAccountInjected => ({
        run: action => client.run(action), hooks: { nativeAccount: client.store }, t,
        formatExpiry: time => new Intl.DateTimeFormat(scope.locale.getSnapshot().active, {
          dateStyle: 'medium', timeStyle: 'short',
        }).format(time),
      })
      scope.slots.inject('settings.onboarding', () => scope.slots.register({
        name: 'settings.onboarding', id: 'mantur-account', order: -100, locale: NS, inject: injected,
      }, NativeAccountOnboarding))
      scope.slots.inject('settings.section', () => scope.slots.register({
        name: 'settings.section', id: 'mantur-account', order: 5,
        label: () => t('nav'), locale: NS, inject: injected,
      }, NativeAccountSection))
      return
    }
    const controller = new ManturAccountStore(scope)
    const injected = (): AccountOnboardingInjected & AccountSectionInjected => ({
      controller,
      hooks: { account: controller.store },
      t,
    })
    scope.effect(() => () => { controller.dispose() }, 'ui-mantur-account: controller')
    scope.slots.inject('settings.onboarding', () => scope.slots.register({
      name: 'settings.onboarding', id: 'mantur-account', order: -100, locale: NS, inject: injected,
    }, AccountOnboarding))
    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section', id: 'mantur-account', order: 5,
      label: () => t('nav'), locale: NS, inject: injected,
    }, AccountSection))
  })
}
