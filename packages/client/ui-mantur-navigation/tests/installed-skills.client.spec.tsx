// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ManturInstalledSkill } from '@deepseek-ai/dsh-manturhub-marketplace/types'
import { InstalledSkills } from '../src/client/InstalledSkills.tsx'
import type { ManturMarketplaceStore } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('lists installed skills, searches them, and changes a switch only after persistence succeeds', async () => {
  let enabled = true
  const controller = {
    installedSkills: vi.fn(async () => [{ name: 'example', title: '测试技能', description: '描述', source: 'local', enabled }]),
    setSkillEnabled: vi.fn(async (_name: string, value: boolean) => { enabled = value }),
  }
  render(<InstalledSkills controller={controller as unknown as ManturMarketplaceStore} close={() => {}} t={makeTranslate(zh)} />)
  const toggle = await screen.findByRole('switch', { name: '启用技能：测试技能' })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(toggle)
  await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('false') })
  expect(controller.setSkillEnabled).toHaveBeenCalledWith('example', false)
  controller.setSkillEnabled.mockRejectedValueOnce(new Error('Disk unavailable'))
  fireEvent.click(toggle)
  await screen.findByRole('alert')
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '不存在' } })
  expect(screen.queryByRole('switch')).toBeNull()
})


it('retries a failed local catalog and shows bundled skills with a name when the description is empty', async () => {
  const installedSkills = vi.fn().mockRejectedValueOnce(new Error('Read failed')).mockResolvedValueOnce([
    { name: 'bundled-example', title: '内置技能', description: '', source: 'bundled', enabled: false },
  ])
  const controller = { installedSkills, setSkillEnabled: vi.fn() }
  render(<InstalledSkills controller={controller as unknown as ManturMarketplaceStore} close={() => {}} t={makeTranslate(zh)} />)
  expect(screen.getByRole('status').textContent).toBe(zh['skills.loadingInstalled'])
  expect((await screen.findByRole('alert')).textContent).toContain(zh['skills.manageFailed'])
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh['skills.retry'] }))
  expect((await screen.findByRole('switch')).getAttribute('aria-checked')).toBe('false')
  expect(screen.getByRole('heading', { name: `${zh['skills.bundledGroup']} (1)` })).toBeTruthy()
  expect(screen.getByText('bundled-example')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(installedSkills).toHaveBeenCalledTimes(2)
})

it.each(['resolve', 'reject'] as const)('ignores an obsolete installed catalog that later %ss', async (outcome) => {
  const request = Promise.withResolvers<ManturInstalledSkill[]>()
  const oldController = { installedSkills: vi.fn(() => request.promise) }
  const currentController = { installedSkills: vi.fn(async () => [
    { name: 'current', title: '当前技能', description: '当前版本', source: 'local', enabled: true },
  ]) }
  const view = render(<InstalledSkills controller={oldController as unknown as ManturMarketplaceStore}
    close={() => {}} t={makeTranslate(zh)} />)
  view.rerender(<InstalledSkills controller={currentController as unknown as ManturMarketplaceStore}
    close={() => {}} t={makeTranslate(zh)} />)
  await screen.findByRole('switch', { name: '启用技能：当前技能' })
  await act(async () => {
    if (outcome === 'resolve') request.resolve([])
    else request.reject(new Error('Obsolete request failed'))
    await Promise.allSettled([request.promise])
  })
  expect(screen.getByRole('switch', { name: '启用技能：当前技能' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(currentController.installedSkills).toHaveBeenCalledOnce()
})
