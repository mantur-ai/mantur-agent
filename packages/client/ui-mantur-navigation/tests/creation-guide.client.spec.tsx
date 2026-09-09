// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { load as parseYaml } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      ? { phase: 'ready', skills: market.catalog.skills.map(item => ({ name: item.slug, title: item.name, version: item.version,
        digest: 'a'.repeat(64), reference: `${item.slug}@${item.version}#${'a'.repeat(64)}`, source: 'app-bundled' })) }
      : { phase: market.phase }),
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
function openOnlineSkill(): void {
  fireEvent.click(screen.getByRole('button', { name: zh.more }))
  fireEvent.click(screen.getByRole('button', { name: skill.name }))
}

describe('Mantur creation guide', () => {
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

  it.each([false, true])('restores the requested detail action after login with signedIn=%s', (signedIn) => {
    const detail = { ...skill, installed: false, usesOperators: [] }
    const state = { phase: 'ready' as const, catalog: { skills: [detail], installedCount: 0, signedIn: false }, detail }
    const p = props(settings, state)
    const view = render(guide(p))
    openOnlineSkill()
    fireEvent.click(screen.getByRole('button', { name: '登录后安装' }))
    view.rerender(guide(props(settings, { ...state, loginPhase: 'starting' })))
    view.rerender(guide(props(settings, { ...state, catalog: { ...state.catalog, signedIn } })))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: signedIn ? '安装后使用' : '登录后安装' }))
    expect(p.install).not.toHaveBeenCalled()
    expect(p.inputActions.submit).not.toHaveBeenCalled()
  })

  it('does not restore focus to a detail after the current Session changes during login', () => {
    const detail = { ...skill, installed: false, usesOperators: [] }
    const state = { phase: 'ready' as const, catalog: { skills: [detail], installedCount: 0, signedIn: false }, detail }
    const view = render(guide(props(settings, state)))
    openOnlineSkill()
    fireEvent.click(screen.getByRole('button', { name: '登录后安装' }))
    view.rerender(guide(props(settings, { ...state, loginPhase: 'starting' })))
    view.rerender(guide({ ...props(settings, { ...state, loginPhase: 'starting' }), sessionId: 's2' }))
    const before = document.activeElement
    view.rerender(guide({ ...props(settings, state), sessionId: 's2' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(before)
  })

  it('shows the first welcome and never inserts invented catalog entries', () => {
    const p = props()
    render(guide(p))
    expect(screen.getByText(zh['welcome.title'])).toBeTruthy()
    expect(screen.getByText(zh['welcome.body'])).toBeTruthy()
    expect(screen.getByRole('button', { name: '馒头仔' }).querySelector('img')?.getAttribute('src')).toBe('./mantoo-script-peek@3x.png')
    expect(screen.getByRole('button', { name: '剧本改编' }).getAttribute('title')).toBe(skill.name)
    expect(screen.queryByText('not-in-catalog')).toBeNull()
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

  it('shows a brief confirmation and only inserts after explicit successful installation', async () => {
    const uninstalled = { ...skill, installed: false }
    const p = props(settings, { phase: 'ready', catalog: { skills: [uninstalled], installedCount: 0, signedIn: true } })
    const view = render(guide(p))
    openOnlineSkill()
    expect(p.openDetail).toHaveBeenCalledWith(skill.slug)
    expect(p.install).not.toHaveBeenCalled()
    const detailProps = props(settings, { phase: 'ready', catalog: { skills: [uninstalled], installedCount: 0, signedIn: true }, detail: { ...uninstalled, usesOperators: [] } })
    detailProps.install.mockResolvedValueOnce(false)
    view.rerender(guide(detailProps))
    expect(screen.getByText(zh.notInstalled)).toBeTruthy()
    expect(screen.queryByText(skill.description)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '安装后使用' }))
    await waitFor(() => { expect(screen.getByText(zh.installFailed)).toBeTruthy() })
    expect(detailProps.inputActions.appendReference).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '安装后使用' }))
    await waitFor(() => { expect(detailProps.inputActions.appendReference).toHaveBeenCalledTimes(1) })
    expect(detailProps.inputActions.submit).not.toHaveBeenCalled()
  })

  it('does not insert into a changed conversation when installation settles late', async () => {
    const uninstalled = { ...skill, installed: false }
    const p = props(settings, { phase: 'ready', catalog: { skills: [uninstalled], installedCount: 0, signedIn: true }, detail: { ...uninstalled, usesOperators: [] } })
    let finish!: (value: boolean) => void
    p.install.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const view = render(guide(p))
    openOnlineSkill()
    fireEvent.click(screen.getByRole('button', { name: '安装后使用' }))
    view.rerender(guide({ ...p, sessionId: 's2' }))
    finish(true)
    await waitFor(() => { expect(p.install).toHaveBeenCalledTimes(1) })
    expect(p.inputActions.appendReference).not.toHaveBeenCalled()
  })

  it('does not install on cancellation or insert after a cancelled pending installation', async () => {
    const uninstalled = { ...skill, installed: false }
    const p = props(settings, {
      phase: 'ready', catalog: { skills: [uninstalled], installedCount: 0, signedIn: true },
      detail: { ...uninstalled, description: '很长的说明'.repeat(100), introduction: '完整介绍'.repeat(100), usesOperators: [] },
    })
    const pending = Promise.withResolvers<boolean>()
    p.install.mockReturnValue(pending.promise)
    render(guide(p))
    openOnlineSkill()
    const dialog = screen.getByRole('dialog', { name: '剧本改编' })
    expect(dialog.textContent).toContain(zh.notInstalled)
    expect(dialog.textContent).not.toContain('很长的说明')
    expect(dialog.textContent).not.toContain('完整介绍')
    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    expect(p.install).not.toHaveBeenCalled()
    openOnlineSkill()
    fireEvent.click(screen.getByRole('button', { name: zh.installAndUse }))
    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    await act(async () => { pending.resolve(true) })
    expect(p.appendReference).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(zh.installFailed)).toBeNull()
  })

  it('keeps an unmapped complete-list title and its real reference without inventing a short name', () => {
    const another = { ...skill, slug: 'another-real-skill', name: '更多列表中的完整中文技能标题' }
    const p = props(settings, { phase: 'ready', catalog: { skills: [another], installedCount: 1, signedIn: true } })
    render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: zh.more }))
    fireEvent.click(screen.getByRole('button', { name: another.name }))
    expect(p.appendReference).toHaveBeenCalledWith({
      source: 'skill', ref: another.slug, label: another.name, clipboardText: `/${another.slug}`,
    })
    expect(p.openDetail).not.toHaveBeenCalled()
    expect(p.inputActions.submit).not.toHaveBeenCalled()
  })

  it('invalidates a pending insertion before rendering navigation and never revives it on return', async () => {
    const uninstalled = { ...skill, installed: false }
    let navigation = 0
    const p = { ...props(settings, { phase: 'ready', catalog: { skills: [uninstalled], installedCount: 0, signedIn: true },
      detail: { ...uninstalled, usesOperators: [] } }),
    useGuideNavigation: (select: (value: unknown) => unknown) => select(navigation), navigationVersion: () => navigation }
    const pending = Promise.withResolvers<boolean>()
    p.install.mockReturnValue(pending.promise)
    const view = render(guide(p))
    openOnlineSkill()
    fireEvent.click(screen.getByRole('button', { name: zh.installAndUse }))
    navigation += 1
    await act(async () => { pending.resolve(true) })
    expect(p.appendReference).not.toHaveBeenCalled()
    view.rerender(guide(p))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(zh.installFailed)).toBeNull()
    expect(p.closeDetail).not.toHaveBeenCalled()
    view.rerender(guide(p))
    expect(p.appendReference).not.toHaveBeenCalled()
  })

  it('shows empty and failed catalog states with an explicit retry', () => {
    const p = props(settings, { phase: 'failed' })
    const view = render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: marketZh['skills.retry'] }))
    expect(p.loadBundled).toHaveBeenCalledTimes(1)
    view.rerender(guide(props({ ...settings, mode: 'production' })))
    expect(screen.getByText(zh.empty)).toBeTruthy()
  })

  it('keeps marketplace details outside the guide until a guide shortcut opens them', () => {
    render(guide(props(settings, { ...ready, detail: { ...skill, usesOperators: [] } })))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows an explicit empty search and closes guide dialogs when conversations change', () => {
    const p = props()
    const view = render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: zh.more }))
    fireEvent.change(screen.getByRole('textbox', { name: marketZh['skills.search'] }), { target: { value: 'no-such-skill' } })
    expect(screen.getByText(marketZh['skills.noMatches'])).toBeTruthy()
    view.rerender(guide({ ...p, sessionId: 's2' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('uses arrow keys for mode selection without touching the current composer', async () => {
    const p = props()
    render(<CreationModes {...p as unknown as CreationModesProps} />)
    fireEvent.keyDown(screen.getByRole('tab', { name: '剧本创作' }), { key: 'ArrowRight' })
    expect(p.saveMode).toHaveBeenCalledWith('production')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '漫剧制作' }))
    expect(p.inputActions.appendReference).not.toHaveBeenCalled()
    expect(p.inputActions.submit).not.toHaveBeenCalled()
  })

  it('curates at most four Chinese characters for every configured recommendation while preserving real references', () => {
    const composition = parseYaml(readFileSync('packages/bundle/mantur-app/cordis.patch.yml', 'utf8'), { schema: entryListSchema }) as { insert?: { id: string; config?: { recommendations: GuideSettings['recommendations'] } }[] }[]
    const recommendations = composition.flatMap(patch => patch.insert ?? []).find(plugin => plugin.id === 'ui-mantur-navigation')?.config?.recommendations
    expect(recommendations).toBeDefined()
    const slugs = [...new Set(Object.values(recommendations!).flat())]
    expect(slugs.sort()).toEqual([...GUIDE_SKILL_LABELS.keys()].sort())
    for (const slug of slugs) {
      const key = GUIDE_SKILL_LABELS.get(slug)!
      expect(zh[key]).toMatch(/^[\p{Script=Han}]{1,4}$/u)
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
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['剧本创作', '漫剧制作', '素材生产'])
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

  it('reads occurrence identity, tolerates no input binding, and closes the complete Skill list', () => {
    const p = props()
    const withOccurrences = { ...p, useGuideInput: (select: (value: unknown) => unknown) => select({ occurrences: [
      { source: 'file', ref: reference }, { source: 'skill', ref: skill.slug }, { source: 'mantur-bundled-skill', ref: reference },
    ] }) }
    const view = render(guide(withOccurrences))
    expect(screen.getByRole('button', { name: '剧本改编' }).getAttribute('aria-pressed')).toBe('true')
    view.rerender(guide({ ...p, useGuideInput: (select: (value: unknown) => unknown) => select(undefined) }))
    expect(screen.getByRole('button', { name: '剧本改编' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: zh.more }))
    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.more }))
    fireEvent.click(screen.getByRole('button', { name: skill.name }))
    expect(p.appendReference).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['idle', 'loading', 'failed'] as const)('shows the real %s catalog state in the complete list', (phase) => {
    const p = props(settings, { phase })
    render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: zh.more }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(marketZh[phase === 'failed' ? 'skills.failed' : 'skills.loading'])
    if (phase === 'failed') {
      fireEvent.click(dialog.querySelector('button:not([aria-label])')!)
      expect(p.load).toHaveBeenCalledOnce()
    }
  })

  it('retries detail failures, uses installed details, and closes detail explicitly', () => {
    const uninstalled = { ...skill, installed: false }
    const p = props(settings, { ...ready, detailError: skill.slug, catalog: { skills: [uninstalled], installedCount: 0, signedIn: true } })
    const view = render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: zh.more }))
    fireEvent.click(screen.getByRole('button', { name: skill.name }))
    fireEvent.click(screen.getByRole('button', { name: marketZh['skills.retry'] }))
    expect(p.openDetail).toHaveBeenCalledTimes(2)
    view.rerender(guide(props(settings, { ...ready, detail: { ...skill, introduction: '完整使用说明', usesOperators: [] } })))
    expect(screen.queryByText('完整使用说明')).toBeNull()
    expect(screen.queryByText(skill.description)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.use }))
    expect(screen.queryByRole('dialog')).toBeNull()
    view.rerender(guide(p))
    openOnlineSkill()
    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    expect(p.closeDetail).toHaveBeenCalled()
  })

  it('shows installation conflicts and login progress without hiding the failure', () => {
    const uninstalled = { ...skill, installed: false }
    const state = { phase: 'ready', catalog: { skills: [uninstalled], installedCount: 0, signedIn: false }, detail: { ...uninstalled, usesOperators: [] } } as const
    const p = props(settings, state)
    const view = render(guide(p))
    openOnlineSkill()
    fireEvent.click(screen.getByRole('button', { name: marketZh['skills.loginToInstall'] }))
    expect(p.startLogin).toHaveBeenCalledOnce()
    view.rerender(guide(props(settings, { ...state, loginPhase: 'starting' })))
    expect(screen.queryByRole('dialog')).toBeNull()
    view.rerender(guide(props(settings, { ...state, loginPhase: 'authorizing' })))
    expect(screen.queryByRole('link')).toBeNull()
    view.rerender(guide({ ...p, useMarketplace: (select: (value: unknown) => unknown) => select({ ...state, loginPhase: 'authorizing', login: { userCode: 'TEST-CODE', verificationUrl: 'https://example.test/login' } }) }))
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.test/login')
    fireEvent.click(screen.getByRole('button', { name: marketZh['skills.cancelLogin'] }))
    expect(p.cancelLogin).toHaveBeenCalledOnce()
    view.rerender(guide(props(settings, { ...state, loginPhase: 'failed', installError: 'local-conflict' })))
    expect(screen.getByText(marketZh['skills.loginFailed'])).toBeTruthy()
    expect(screen.getByText(zh.installFailed + marketZh['skills.localConflict'])).toBeTruthy()
    view.rerender(guide(props(settings, { ...state, loginPhase: 'unavailable' })))
    expect(screen.getByRole('alert').textContent).toBe(marketZh['skills.loginUnavailable'])
    view.rerender(guide(props(settings, { ...state, installError: 'failed' })))
    expect(screen.getByText(zh.installFailed)).toBeTruthy()
    view.rerender(guide(props(settings, { ...state, catalog: { ...state.catalog, signedIn: true }, installing: skill.slug })))
    expect(screen.getByRole('button', { name: marketZh['skills.installing'] }).hasAttribute('disabled')).toBe(true)
  })

  it.each([true, false])('does not insert after a late installation resolves %s into a changed composer', async (result) => {
    const uninstalled = { ...skill, installed: false }
    const p = props(settings, {
      ...ready, catalog: { skills: [uninstalled], installedCount: 0, signedIn: true }, detail: { ...uninstalled, usesOperators: [] },
    })
    let finish!: (value: boolean) => void
    p.install.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const view = render(guide(p))
    openOnlineSkill()
    fireEvent.click(screen.getByRole('button', { name: zh.installAndUse }))
    view.rerender(guide({ ...p, sessionId: 's2' }))
    await act(async () => { finish(result) })
    expect(p.appendReference).not.toHaveBeenCalled()
    expect(screen.queryByText(zh.installFailed)).toBeNull()
  })
})
