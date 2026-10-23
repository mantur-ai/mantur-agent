// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { load as parseYaml } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CreationGuide, CreationModes, type CreationGuideProps, type CreationModesProps } from '../src/client/CreationGuide.tsx'
import { en, GUIDE_SKILL_LABELS, zh } from '../src/client/guide-locales.ts'
import { zh as marketZh } from '../src/client/locales.ts'
import type { GuideSettings } from '../src/guide-settings.ts'
import type { ManturMarketplaceState } from '../src/client/store.ts'

afterEach(cleanup)
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
afterEach(() => { vi.unstubAllGlobals() })
const t = makeTranslate(zh)
const mt = makeTranslate(marketZh)
const skill = { slug: 'short-drama', name: '爽文短剧剧本创作', description: '写分集剧本', category: '剧本', installed: true, version: '1.0.0', triggers: [] }
const settings: GuideSettings = { mode: 'script', closed: false, recommendations: { script: ['short-drama', 'not-in-catalog'], production: [], assets: [] } }
const ready: ManturMarketplaceState = { phase: 'ready', catalog: { skills: [skill], installedCount: 1, signedIn: true } }
const reference = `${skill.slug}@${skill.version}#${'a'.repeat(64)}`

function props(preferences = settings, market = ready) {
  const appendReference = vi.fn(() => true)
  const submit = vi.fn()
  return {
    hero: true, disabled: false, sessionId: 's1', t,
    usePreferences: (select: (value: unknown) => unknown) => select({ status: 'ready', value: preferences }),
    useMarketplace: (select: (value: unknown) => unknown) => select(market),
    useBundledSkills: (select: (value: unknown) => unknown) => select(market.phase === 'ready'
      ? { phase: 'ready', updates: [], skills: market.catalog.skills.map(item => ({ name: item.slug, title: item.name, version: item.version,
        digest: 'a'.repeat(64), reference: `${item.slug}@${item.version}#${'a'.repeat(64)}`, source: 'app-bundled' })) }
      : { phase: market.phase, skills: [], updates: [] }),
    useGuideInput: (select: (value: unknown) => unknown) => select({ draft: '我的草稿', imageIds: ['image'], occurrences: [] }),
    useGuideNavigation: (select: (value: unknown) => unknown) => select(0), navigationVersion: () => 0,
    inputActions: { appendReference, submit },
    appendReference,
    saveMode: vi.fn(() => Promise.resolve(true)), saveClosed: vi.fn(() => Promise.resolve(true)),
    load: vi.fn(), ensureCatalog: vi.fn(), loadBundled: vi.fn(), openDetail: vi.fn(), closeDetail: vi.fn(),
    install: vi.fn(() => Promise.resolve(true)), startLogin: vi.fn(), cancelLogin: vi.fn(), marketplaceText: mt,
  }
}
function guide(input: ReturnType<typeof props>) { return <CreationGuide {...input as unknown as CreationGuideProps} /> }
describe('Mantur creation guide', () => {
  it('inserts the published script identity with the complete homepage label without sending', () => {
    const ref = 'overseas-comic-script-studio@0.3.11#1f0b0a46c225dc2a7d16a5a922179714a7c5f9298f10de458780b318af19a81e'
    const p = props({ ...settings, recommendations: { ...settings.recommendations, script: ['overseas-comic-script-studio'] } })
    p.useBundledSkills = select => select({ phase: 'ready', updates: [{ name: 'overseas-comic-script-studio', status: 'verified' }],
      skills: [{ name: 'overseas-comic-script-studio', title: '出海短剧剧本创编', version: '0.3.11',
        digest: ref.split('#')[1], reference: ref, source: 'app-bundled' }] })
    render(guide(p))
    const button = screen.getByRole('button', { name: '出海短剧剧本创编' })
    fireEvent.click(button)
    expect({ label: button.textContent, reference: p.appendReference.mock.calls[0], sent: p.inputActions.submit.mock.calls.length }).toMatchInlineSnapshot(`
      {
        "label": "出海短剧剧本创编",
        "reference": [
          {
            "clipboardText": "/mantur-builtin:overseas-comic-script-studio@0.3.11#1f0b0a46c225dc2a7d16a5a922179714a7c5f9298f10de458780b318af19a81e",
            "label": "出海短剧剧本创编",
            "ref": "overseas-comic-script-studio@0.3.11#1f0b0a46c225dc2a7d16a5a922179714a7c5f9298f10de458780b318af19a81e",
            "source": "mantur-bundled-skill",
          },
        ],
        "sent": 0,
      }
    `)
    expect(screen.queryByRole('button', { name: '剧本改编' })).toBeNull()
    expect(screen.queryByText(/更新失败/)).toBeNull()
  })

  it('inserts the published editing identity with the complete homepage label without sending', () => {
    const ref = 'mantur-preroll-remix-studio@0.2.31#235d51ecb900f7e49fdd8aec9b39ba5092af307c2afb50346964e8c6698c1f70'
    const p = props({ ...settings, mode: 'assets', recommendations: { ...settings.recommendations, assets: ['mantur-preroll-remix-studio'] } })
    p.useBundledSkills = select => select({ phase: 'ready', updates: [{ name: 'mantur-preroll-remix-studio', status: 'verified' }],
      skills: [{ name: 'mantur-preroll-remix-studio', title: '短剧素材智能剪辑', version: '0.2.31',
        digest: ref.split('#')[1], reference: ref, source: 'app-bundled' }] })
    render(guide(p))
    const button = screen.getByRole('button', { name: '短剧素材智能剪辑' })
    fireEvent.click(button)
    expect({ label: button.textContent, reference: p.appendReference.mock.calls[0], sent: p.inputActions.submit.mock.calls.length }).toMatchInlineSnapshot(`
      {
        "label": "短剧素材智能剪辑",
        "reference": [
          {
            "clipboardText": "/mantur-builtin:mantur-preroll-remix-studio@0.2.31#235d51ecb900f7e49fdd8aec9b39ba5092af307c2afb50346964e8c6698c1f70",
            "label": "短剧素材智能剪辑",
            "ref": "mantur-preroll-remix-studio@0.2.31#235d51ecb900f7e49fdd8aec9b39ba5092af307c2afb50346964e8c6698c1f70",
            "source": "mantur-bundled-skill",
          },
        ],
        "sent": 0,
      }
    `)
    expect(screen.queryByRole('button', { name: '高光智剪' })).toBeNull()
    expect(screen.queryByText(/更新失败/)).toBeNull()
  })

  it('uses the pinned offline entry while marketplace access has failed, without login or installation', () => {
    const local = props()
    const p = { ...props(settings, { phase: 'failed' }), useBundledSkills: local.useBundledSkills }
    render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: '剧本改编' }))
    expect(p.appendReference).toHaveBeenCalledWith({ source: 'mantur-bundled-skill', ref: reference,
      label: '剧本改编', clipboardText: `/mantur-builtin:${reference}` })
    expect(p.ensureCatalog).not.toHaveBeenCalled()
    expect(p.install).not.toHaveBeenCalled()
    expect(p.startLogin).not.toHaveBeenCalled()
    expect(p.openDetail).not.toHaveBeenCalled()
    expect(p.inputActions.submit).not.toHaveBeenCalled()
  })

  it('shows the first welcome and never inserts invented catalog entries', () => {
    const p = props()
    render(guide(p))
    expect(screen.getByText(zh['welcome.title'])).toBeTruthy()
    expect(screen.getByText(zh['welcome.body'])).toBeTruthy()
    expect(screen.getByRole('button', { name: '馒头仔' }).querySelector('img')?.getAttribute('src')).toBe('./mantoo-script-peek@3x.png')
    expect(screen.getByRole('button', { name: '剧本改编' }).getAttribute('title')).toBe(skill.name)
    expect(screen.queryByText('not-in-catalog')).toBeNull()
    expect(screen.queryByRole('button', { name: zh.more })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '剧本改编' }))
    expect(p.inputActions.appendReference).toHaveBeenCalledWith({ source: 'mantur-bundled-skill', ref: reference, label: '剧本改编', clipboardText: `/mantur-builtin:${reference}` })
    expect(p.openDetail).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(p.inputActions.submit).not.toHaveBeenCalled()
    expect(screen.getByText(zh.selected.replace('{name}', '剧本改编'))).toBeTruthy()
  })

  it('closes with Escape, persists dismissal and never reopens on mode changes or remount', async () => {
    const p = props()
    const view = render(guide(p))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(p.saveClosed).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: '馒头仔' }).getAttribute('aria-expanded')).toBe('false')
    view.rerender(guide(props({ ...settings, mode: 'production', closed: true })))
    expect(screen.queryByText(zh['intro.production'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '馒头仔' }))
    expect(screen.getByText(zh['intro.production'])).toBeTruthy()
    view.unmount()
    render(guide(props({ ...settings, closed: true })))
    expect(screen.queryByText(zh['welcome.title'])).toBeNull()
  })

  it('updates the home guide on mode change and removes the mascot during chat', () => {
    const p = props()
    const view = render(guide(p))
    view.rerender(guide(props({ ...settings, mode: 'assets' })))
    expect(screen.getByText(zh['intro.assets'])).toBeTruthy()
    view.rerender(guide({ ...props(), hero: false }))
    expect(screen.queryByRole('button', { name: '剧本改编' })).toBeNull()
    expect(screen.queryByRole('button', { name: '馒头仔' })).toBeNull()
    expect(screen.queryByText(zh['intro.assets'])).toBeNull()
    expect(view.container.children).toHaveLength(0)
    view.rerender(guide(p))
    expect(screen.getByRole('button', { name: '馒头仔' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '剧本改编' })).toBeTruthy()
  })

  it.each(['script', 'production', 'assets'] as const)('uses the approved %s artwork without changing the draft', (mode) => {
    const p = props({ ...settings, mode })
    render(guide(p))
    const image = screen.getByRole('button', { name: '馒头仔' }).querySelector('img')!
    expect(image.getAttribute('src')).toBe(`./mantoo-${mode}-peek@3x.png`)
    expect(image.getAttribute('srcset')).toBe(`./mantoo-${mode}-peek@2x.png 2x, ./mantoo-${mode}-peek@3x.png 3x`)
    expect([image.width, image.height, image.alt]).toEqual([184, 120, ''])
    expect(p.appendReference).not.toHaveBeenCalled()
    expect(p.inputActions.submit).not.toHaveBeenCalled()
  })

  it('shows empty and failed catalog states with an explicit retry', () => {
    const p = props(settings, { phase: 'failed' })
    const view = render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: marketZh['skills.retry'] }))
    expect(p.loadBundled).toHaveBeenCalledTimes(2)
    view.rerender(guide(props({ ...settings, mode: 'production' })))
    expect(screen.getByText(zh.empty)).toBeTruthy()
  })

  it('keeps marketplace details outside the guide until a guide shortcut opens them', () => {
    render(guide(props(settings, { ...ready, detail: { ...skill, usesOperators: [] } })))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('uses arrow keys for mode selection without touching the current composer', async () => {
    const p = props()
    render(<CreationModes {...p as unknown as CreationModesProps} />)
    fireEvent.keyDown(screen.getByRole('tab', { name: '剧本创作' }), { key: 'ArrowRight' })
    expect(p.saveMode).toHaveBeenCalledWith('production')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '漫剧生产' }))
    expect(p.inputActions.appendReference).not.toHaveBeenCalled()
    expect(p.inputActions.submit).not.toHaveBeenCalled()
  })

  it('curates localized labels for every configured recommendation while preserving real references', () => {
    const composition = parseYaml(readFileSync('packages/bundle/mantur-app/cordis.patch.yml', 'utf8'), { schema: entryListSchema }) as { insert?: { id: string; config?: { recommendations: GuideSettings['recommendations'] } }[] }[]
    const recommendations = composition.flatMap(patch => patch.insert ?? []).find(plugin => plugin.id === 'ui-mantur-navigation')?.config?.recommendations
    expect(recommendations).toBeDefined()
    const slugs = [...new Set(Object.values(recommendations!).flat())]
    expect(recommendations?.production).toEqual(['mantur-drama-visual-studio'])
    expect(recommendations?.script).toEqual(['overseas-comic-script-studio'])
    expect(recommendations?.assets).toEqual(['mantur-preroll-remix-studio'])
    expect(slugs.sort()).toEqual(['mantur-drama-visual-studio', 'mantur-preroll-remix-studio', 'overseas-comic-script-studio'])
    for (const slug of slugs) {
      const key = GUIDE_SKILL_LABELS.get(slug)!
      if (slug === 'mantur-drama-visual-studio') {
        expect(zh[key]).toBe('全自动漫剧生产线')
        expect(en[key]).toBe('Automatic drama production pipeline')
        expect(en['mode.production']).toBe('Drama production')
      }
      else if (slug === 'overseas-comic-script-studio') expect(zh[key]).toBe('出海短剧剧本创编')
      else if (slug === 'mantur-preroll-remix-studio') expect(zh[key]).toBe('短剧素材智能剪辑')
      else expect(zh[key]).toMatch(/^[\p{Script=Han}]{1,4}$/u)
      expect(en[key].length).toBeGreaterThan(4)
      const actual = { ...skill, slug, name: `完整技能名称 ${slug}` }
      const p = props({ ...settings, recommendations: { ...settings.recommendations, script: [slug] } }, { phase: 'ready', catalog: { skills: [actual], installedCount: 1, signedIn: true } })
      const view = render(guide(p))
      fireEvent.click(screen.getByRole('button', { name: zh[key] }))
      const exact = `${slug}@${skill.version}#${'a'.repeat(64)}`
      expect(p.appendReference).toHaveBeenCalledWith({ source: 'mantur-bundled-skill', ref: exact, label: zh[key], clipboardText: `/mantur-builtin:${exact}` })
      expect(p.inputActions.submit).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('reports an unmapped recommendation instead of substituting or truncating its catalog name', () => {
    const unknown = { ...skill, slug: 'unmapped', name: '不能截断或回退的完整名称' }
    render(guide(props({ ...settings, recommendations: { ...settings.recommendations, script: [unknown.slug] } }, { phase: 'ready', catalog: { skills: [unknown], installedCount: 1, signedIn: true } })))
    expect(screen.getByRole('alert').textContent).toBe(zh.aliasMissing)
    expect(screen.queryByRole('button', { name: unknown.name })).toBeNull()
  })

  it('does not choose a guessed mode while preferences load or fail', () => {
    const p = props()
    const usePreferences = (select: (value: unknown) => unknown) => select({ status: 'loading', value: undefined })
    const view = render(<CreationModes {...{ ...p, usePreferences } as unknown as CreationModesProps} />)
    expect(screen.getByText(zh.preferencesLoading)).toBeTruthy()
    view.rerender(<CreationModes {...{ ...p, usePreferences: (select: (value: unknown) => unknown) => select({ status: 'error', value: undefined }) } as unknown as CreationModesProps} />)
    expect(screen.getByText(zh.preferencesUnavailable)).toBeTruthy()
    view.rerender(guide({ ...p, usePreferences }))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('wraps keyboard navigation, handles Home and End, and reports failed saves', async () => {
    const p = props()
    p.saveMode.mockResolvedValue(false)
    render(<CreationModes {...p as unknown as CreationModesProps} />)
    const first = screen.getByRole('tab', { name: '剧本创作' })
    const last = screen.getByRole('tab', { name: '素材生产' })
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['剧本创作', '漫剧生产', '素材生产'])
    expect(screen.queryByRole('tab', { name: '剪辑成片' })).toBeNull()
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(p.saveMode).toHaveBeenLastCalledWith('assets')
    fireEvent.keyDown(last, { key: 'ArrowRight' })
    expect(p.saveMode).toHaveBeenLastCalledWith('script')
    fireEvent.keyDown(last, { key: 'ArrowLeft' })
    expect(p.saveMode).toHaveBeenLastCalledWith('production')
    fireEvent.keyDown(first, { key: 'End' })
    expect(p.saveMode).toHaveBeenLastCalledWith('assets')
    fireEvent.keyDown(last, { key: 'Home' })
    expect(p.saveMode).toHaveBeenLastCalledWith('script')
    const calls = p.saveMode.mock.calls.length
    fireEvent.keyDown(first, { key: 'Tab' })
    expect(p.saveMode).toHaveBeenCalledTimes(calls)
    fireEvent.click(first)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh.saveFailed) })
  })

  it('reports failed dismissal and insertion without sending or replacing the draft', async () => {
    const p = props()
    p.saveClosed.mockResolvedValue(false)
    p.appendReference.mockReturnValue(false)
    render(guide(p))
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(p.saveClosed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '馒头仔' }))
    await waitFor(() => { expect(screen.getByText(zh.saveFailed)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '剧本改编' }))
    expect(screen.getByText(zh.insertFailed)).toBeTruthy()
    expect(p.inputActions.submit).not.toHaveBeenCalled()
  })

  it('reads occurrence identity and tolerates no input binding', () => {
    const p = props()
    const withOccurrences = { ...p, useGuideInput: (select: (value: unknown) => unknown) => select({ occurrences: [
      { source: 'file', ref: reference }, { source: 'skill', ref: skill.slug }, { source: 'mantur-bundled-skill', ref: reference },
    ] }) }
    const view = render(guide(withOccurrences))
    expect(screen.getByRole('button', { name: '剧本改编' }).getAttribute('aria-pressed')).toBe('true')
    view.rerender(guide({ ...p, useGuideInput: (select: (value: unknown) => unknown) => select(undefined) }))
    expect(screen.getByRole('button', { name: '剧本改编' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('button', { name: zh.more })).toBeNull()
  })
})


it('scrolls the guide text with Home and End without hijacking other keys', () => {
  const view = render(guide(props()))
  const text = view.container.querySelector('[tabindex="0"]') as HTMLDivElement
  Object.defineProperty(text, 'scrollHeight', { value: 240 })
  text.scrollTop = 30
  fireEvent.keyDown(text, { key: 'End' })
  expect(text.scrollTop).toBe(240)
  fireEvent.keyDown(text, { key: 'Home' })
  expect(text.scrollTop).toBe(0)
  fireEvent.keyDown(text, { key: 'ArrowDown' })
  expect(text.scrollTop).toBe(0)
  fireEvent.keyDown(text.firstElementChild!, { key: 'End' })
  expect(text.scrollTop).toBe(0)
})

it.each(['idle', 'loading'] as const)('shows %s bundled resources without inserting a shortcut', (phase) => {
  const p = { ...props(), useBundledSkills: (select: (value: unknown) => unknown) => select({ phase, skills: [], updates: [] }) }
  render(guide(p))
  expect(screen.getByRole('status').textContent).toBe(marketZh['skills.updating'])
  expect(p.appendReference).not.toHaveBeenCalled()
})

it.each(['ready', 'loading', 'failed'] as const)('keeps a local shortcut usable with per-item update failure in %s state', (phase) => {
  const p = props()
  const local = p.useBundledSkills(value => value) as { skills: unknown[] }
  render(guide({ ...p, useBundledSkills: select => select({ phase, skills: local.skills,
    updates: [{ name: 'short-drama', status: 'failed', stage: 'metadata', error: 'HTTP 404' }],
  }) }))
  const status = screen.getByText('「剧本改编」更新失败，本地版本可用。')
  expect(status.title).toBe('发布信息: HTTP 404')
  expect(status.textContent).toMatchInlineSnapshot('"「剧本改编」更新失败，本地版本可用。"')
  fireEvent.click(screen.getByRole('button', { name: '剧本改编' }))
  expect(p.appendReference).toHaveBeenCalledWith({ source: 'mantur-bundled-skill', ref: reference,
    label: '剧本改编', clipboardText: `/mantur-builtin:${reference}` })
  expect(screen.getByRole('button', { name: marketZh['skills.retry'] }).hasAttribute('disabled')).toBe(phase === 'loading')
  expect(p.inputActions.submit).not.toHaveBeenCalled()
})

it('reports a corrupt local resource as unavailable without offering a shortcut', () => {
  const p = props()
  render(guide({ ...p, useBundledSkills: select => select({ phase: 'ready', skills: [], updates: [
    { name: 'short-drama', status: 'failed', stage: 'verification', error: 'Digest mismatch', localError: 'Invalid local resource' },
  ] }) }))
  const status = screen.getByText('「剧本改编」更新失败，暂无可用版本。')
  expect(status.title).toBe('安全校验: Digest mismatch; Invalid local resource')
  expect(screen.queryByRole('button', { name: '剧本改编' })).toBeNull()
  expect(p.appendReference).not.toHaveBeenCalled()
})

it.each([
  { locale: 'zh', copy: zh, tabLabel: '漫剧生产', skillLabel: '全自动漫剧生产线' },
  { locale: 'en', copy: en, tabLabel: 'Drama production', skillLabel: 'Automatic drama production pipeline' },
])('offers only the configured automatic production skill and inserts its verified identity in $locale', ({ copy, tabLabel, skillLabel }) => {
  const composition = parseYaml(readFileSync('packages/bundle/mantur-app/cordis.patch.yml', 'utf8'), { schema: entryListSchema }) as { insert?: { id: string; config?: { recommendations: GuideSettings['recommendations'] } }[] }[]
  const recommendations = composition.flatMap(patch => patch.insert ?? []).find(plugin => plugin.id === 'ui-mantur-navigation')!.config!.recommendations
  const production = { ...skill, slug: 'mantur-drama-visual-studio', name: '全自动漫剧生产线（可视化）' }
  const p = props({ ...settings, mode: 'production', recommendations }, { phase: 'ready', catalog: {
    skills: [production, { ...skill, slug: 'mantur-copyhit' }], installedCount: 2, signedIn: true,
  } })
  p.t = makeTranslate(copy)
  const local = p.useBundledSkills(value => value) as { skills: unknown[] }
  const productionProps = { ...p, useBundledSkills: (select: (value: unknown) => unknown) => select({
    phase: 'ready', skills: local.skills, updates: [{ name: 'mantur-copyhit', status: 'failed', stage: 'metadata', error: 'HTTP 404' }],
  }) }
  render(<><CreationModes {...p as unknown as CreationModesProps} />{guide(productionProps)}</>)
  expect(screen.queryByText(p.t('updateFailedAvailable', { name: copy['alias.mantur-copyhit'] }))).toBeNull()
  expect(screen.queryByRole('button', { name: marketZh['skills.retry'] })).toBeNull()
  expect(screen.getByRole('tab', { name: tabLabel })).toBeTruthy()
  expect(screen.queryByRole('button', { name: copy['alias.mantur-copyhit'] })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: skillLabel }))
  expect(p.appendReference).toHaveBeenCalledWith(expect.objectContaining({ source: 'mantur-bundled-skill',
    ref: `mantur-drama-visual-studio@1.0.0#${'a'.repeat(64)}`, label: skillLabel }))
  expect(p.inputActions.submit).not.toHaveBeenCalled()
})
