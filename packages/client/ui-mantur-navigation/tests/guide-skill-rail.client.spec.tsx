// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { GuideSkillRail } from '../src/client/GuideSkillRail.tsx'
import { zh } from '../src/client/guide-locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('shows arrows only for overflow, scrolls both ways and releases its DOM observers', () => {
  let resize!: () => void
  const disconnect = vi.fn()
  const observe = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe = observe
    disconnect = disconnect
  })
  const view = render(<GuideSkillRail empty={false} t={makeTranslate(zh)}><button>Skill</button></GuideSkillRail>)
  const rail = screen.getByLabelText(zh.recommended)
  expect(screen.queryByLabelText(zh.nextSkills)).toBeNull()
  const scrollBy = vi.fn()
  rail.scrollBy = scrollBy
  let width = 280
  Object.defineProperty(rail.parentElement!, 'clientWidth', { get: () => width })
  Object.defineProperties(rail, { scrollWidth: { value: 600 }, clientWidth: { value: 224 } })
  act(() => { resize() })
  expect(screen.getByLabelText<HTMLButtonElement>(zh.previousSkills).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(zh.nextSkills))
  expect(scrollBy).toHaveBeenLastCalledWith({ left: 224 })
  rail.scrollLeft = 180
  fireEvent.scroll(rail)
  expect(screen.getByLabelText<HTMLButtonElement>(zh.previousSkills).disabled).toBe(false)
  fireEvent.click(screen.getByLabelText(zh.previousSkills))
  expect(scrollBy).toHaveBeenLastCalledWith({ left: -224 })
  rail.scrollLeft = 376
  fireEvent.scroll(rail)
  expect(screen.getByLabelText<HTMLButtonElement>(zh.nextSkills).disabled).toBe(true)
  width = 600
  act(() => { resize(); resize() })
  expect(screen.queryByLabelText(zh.nextSkills)).toBeNull()
  expect(screen.getByRole('button', { name: 'Skill' }).tabIndex).toBe(0)
  expect(observe).toHaveBeenCalledWith(rail)
  const remove = vi.spyOn(rail, 'removeEventListener')
  view.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
})
