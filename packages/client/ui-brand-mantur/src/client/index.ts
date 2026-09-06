/** Mantur occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  ManturHeroBadge, ManturHeroBrand, ManturHeroHeadline, ManturSidebarMark, ManturSidebarName,
} from './Brand.tsx'
import { en, zh, type ManturBrandKey } from './locales.ts'
import storyboard from './storyboard.css?inline'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mantur product-name copy. */
    'brand.mantur': ManturBrandKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'brand.mantur'

/** Required services: UI slots and locale dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Fill every Mantur brand surface as one declaration-aware registration set.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = '@deepseek-ai/dsh-client-ui-brand-mantur/storyboard.css'
    style.textContent = storyboard
    document.head.append(style)
    document.body.dataset.manturTheme = 'storyboard'
    return () => {
      style.remove()
      delete document.body.dataset.manturTheme
    }
  }, 'ui-brand-mantur: storyboard palette')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-brand-mantur: dictionaries')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', () =>
        ctx.slots.inject('conversation.hero.headline', () =>
          ctx.slots.inject('conversation.hero.badge', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, ManturSidebarMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, ManturSidebarName)
            yield ctx.slots.register({ name: 'conversation.hero.brand.mark', locale: NS }, ManturHeroBrand)
            yield ctx.slots.register({ name: 'conversation.hero.headline', locale: NS }, ManturHeroHeadline)
            yield ctx.slots.register({ name: 'conversation.hero.badge' }, ManturHeroBadge)
          })))))
}
