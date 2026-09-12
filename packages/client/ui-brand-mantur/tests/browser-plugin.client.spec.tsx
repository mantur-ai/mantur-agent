// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import {
  ManturHeroBadge, ManturHeroBrand, ManturHeroHeadline, ManturSidebarMark, ManturSidebarName,
} from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
  'conversation.hero.headline',
  'conversation.hero.badge',
] as const

afterEach(cleanup)

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const slots = ctx.get('slots') as SlotRegistry
  slots.installLocale(locale)
  const disposeHoles = slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  return { ctx, slots, disposeHoles }
}

describe('Mantur browser-brand plugin', () => {
  it('keeps the host Loader entry inert and declares its browser services', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('fills every declared brand surface and removes them together', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(document.body.dataset.manturTheme).toBe('storyboard')
    const palette = document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-client-ui-brand-mantur/storyboard.css"]')
    expect(palette).not.toBeNull()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
    subject.disposeHoles()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
    await fiber.dispose()
    expect(palette?.isConnected).toBe(false)
    expect(document.body.hasAttribute('data-mantur-theme')).toBe(false)
  })

  it('renders the approved logo with the localized product copy', () => {
    const t = (() => '漫途Agent') as never
    const sidebarName = render(<ManturSidebarName t={t} />)
    expect(sidebarName.getByText('漫途Agent')).toBeTruthy()
    sidebarName.unmount()

    const hero = render(<ManturHeroBrand size={34} className="hero-mark" />)
    const heroLogo = hero.container.querySelector('img')
    expect(heroLogo?.getAttribute('src')).toBe('./mantur-logo.png')
    expect(heroLogo?.getAttribute('class')).toBe('hero-mark')
    expect(heroLogo?.getAttribute('width')).toBe('34')
    hero.unmount()

    const headline = render(<ManturHeroHeadline t={key => key === 'headline'
      ? '故事起于一念，余下交给漫途'
      : '漫途Agent'} />)
    expect(headline.getByText('故事起于一念，余下交给漫途')).toBeTruthy()
    headline.unmount()

    const expanded = render(<ManturSidebarMark size={24} placement="expanded" />)
    expect(expanded.container.querySelector('img')?.getAttribute('src')).toBe('./mantur-logo.png')
    expanded.rerender(<ManturSidebarMark size={24} placement="rail" />)
    expect(expanded.container.querySelector('img')?.getAttribute('width')).toBe('24')
    expanded.unmount()

    const badge = render(<ManturHeroBadge />)
    expect(badge.container.childElementCount).toBe(0)
  })
})
