// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
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
