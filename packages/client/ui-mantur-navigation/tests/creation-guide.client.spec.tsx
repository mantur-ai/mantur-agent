// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CreationGuide, CreationModes, type CreationGuideProps, type CreationModesProps } from '../src/client/CreationGuide.tsx'
import { zh } from '../src/client/guide-locales.ts'
import { zh as marketZh } from '../src/client/locales.ts'
import type { GuideSettings } from '../src/guide-settings.ts'
import type { ManturMarketplaceState } from '../src/client/store.ts'

afterEach(cleanup)
const t = makeTranslate(zh)
const mt = makeTranslate(marketZh)
const skill = { slug: 'short-drama', name: '爽文短剧剧本创作', description: '写分集剧本', category: '剧本', installed: true, version: '1.0.0', triggers: [] }
const settings: GuideSettings = { mode: 'script', closed: false, recommendations: { script: ['short-drama', 'not-in-catalog'], production: [], editing: [], assets: [] } }
const ready: ManturMarketplaceState = { phase: 'ready', catalog: { skills: [skill], installedCount: 1, signedIn: true } }

function props(preferences = settings, market = ready) {
  const appendReference = vi.fn(() => true)
  const submit = vi.fn()
  return {
    hero: true, disabled: false, sessionId: 's1', t,
    usePreferences: (select: (value: unknown) => unknown) => select({ status: 'ready', value: preferences }),
    useMarketplace: (select: (value: unknown) => unknown) => select(market),
    useInput: (select: (value: unknown) => unknown) => select({ draft: '我的草稿', imageIds: ['image'], occurrences: [] }),
    inputActions: { appendReference, submit },
    appendReference,
    saveMode: vi.fn(() => Promise.resolve(true)), saveClosed: vi.fn(() => Promise.resolve(true)),
    load: vi.fn(), ensureCatalog: vi.fn(), openDetail: vi.fn(), closeDetail: vi.fn(),
    install: vi.fn(() => Promise.resolve(true)), startLogin: vi.fn(), cancelLogin: vi.fn(), marketplaceText: mt,
  }
}
function guide(input: ReturnType<typeof props>) { return <CreationGuide {...input as unknown as CreationGuideProps} /> }

describe('Mantur creation guide', () => {
  it('shows the first welcome and never inserts invented catalog entries', () => {
    const p = props()
    render(guide(p))
    expect(screen.getByText(zh['welcome.title'])).toBeTruthy()
    expect(screen.getByText(zh['welcome.body'])).toBeTruthy()
    expect(screen.getByRole('button', { name: '馒头仔' }).querySelector('img')?.getAttribute('src')).toBe('./mantou-clapper.png')
    expect(screen.getByRole('button', { name: skill.name })).toBeTruthy()
    expect(screen.queryByText('not-in-catalog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: skill.name }))
    expect(p.inputActions.appendReference).toHaveBeenCalledWith({ source: 'skill', ref: skill.slug, label: skill.name, clipboardText: '/short-drama' })
    expect(p.inputActions.submit).not.toHaveBeenCalled()
    expect(screen.getByText(zh.selected.replace('{name}', skill.name))).toBeTruthy()
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

  it('updates an open guide on mode change and collapses after the first message', () => {
    const p = props()
    const view = render(guide(p))
    view.rerender(guide(props({ ...settings, mode: 'editing' })))
    expect(screen.getByText(zh['intro.editing'])).toBeTruthy()
    view.rerender(guide({ ...props(), hero: false }))
    expect(screen.queryByRole('button', { name: skill.name })).toBeNull()
    expect(screen.getByRole('button', { name: '馒头仔' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: '馒头仔' }).getAttribute('data-hero')).toBe('false')
  })

  it('shows details before installation and only inserts after successful installation', async () => {
    const uninstalled = { ...skill, installed: false }
    const p = props(settings, { phase: 'ready', catalog: { skills: [uninstalled], installedCount: 0, signedIn: true } })
    const view = render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: skill.name }))
    expect(p.openDetail).toHaveBeenCalledWith(skill.slug)
    expect(p.install).not.toHaveBeenCalled()
    const detailProps = props(settings, { phase: 'ready', catalog: { skills: [uninstalled], installedCount: 0, signedIn: true }, detail: { ...uninstalled, usesOperators: [] } })
    detailProps.install.mockResolvedValueOnce(false)
    view.rerender(guide(detailProps))
    fireEvent.click(screen.getByRole('button', { name: '安装并使用' }))
    await waitFor(() => { expect(screen.getByText(zh.installFailed)).toBeTruthy() })
    expect(detailProps.inputActions.appendReference).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '安装并使用' }))
    await waitFor(() => { expect(detailProps.inputActions.appendReference).toHaveBeenCalledTimes(1) })
    expect(detailProps.inputActions.submit).not.toHaveBeenCalled()
  })

  it('does not insert into a changed conversation when installation settles late', async () => {
    const uninstalled = { ...skill, installed: false }
    const p = props(settings, { phase: 'ready', catalog: { skills: [uninstalled], installedCount: 0, signedIn: true }, detail: { ...uninstalled, usesOperators: [] } })
    let finish!: (value: boolean) => void
    p.install.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const view = render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: skill.name }))
    fireEvent.click(screen.getByRole('button', { name: '安装并使用' }))
    view.rerender(guide({ ...p, sessionId: 's2' }))
    finish(true)
    await waitFor(() => { expect(p.install).toHaveBeenCalledTimes(1) })
    expect(p.inputActions.appendReference).not.toHaveBeenCalled()
  })

  it('shows empty and failed catalog states with an explicit retry', () => {
    const p = props(settings, { phase: 'failed' })
    const view = render(guide(p))
    fireEvent.click(screen.getByRole('button', { name: marketZh['skills.retry'] }))
    expect(p.load).toHaveBeenCalledTimes(1)
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
})
