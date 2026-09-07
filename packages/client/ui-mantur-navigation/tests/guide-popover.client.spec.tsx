// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useGuidePopover } from '../src/client/useGuidePopover.ts'

const fixtures: HTMLElement[] = []
afterEach(() => {
  cleanup()
  for (const fixture of fixtures.splice(0)) fixture.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function elements() {
  vi.stubGlobal('innerWidth', 1024)
  const seat = document.createElement('div')
  seat.setAttribute('data-composer-seat', '')
  const anchor = document.createElement('button')
  const panel = document.createElement('section')
  const content = document.createElement('div')
  panel.append(content)
  seat.append(anchor, panel)
  document.body.append(seat)
  fixtures.push(seat)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 400, 100, 50))
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: 160 })
  Object.defineProperty(content, 'clientHeight', { configurable: true, value: 120 })
  Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 120 })
  return { seat, anchor: { current: anchor }, panel: { current: panel } }
}

it('anchors above/right and clamps narrow viewports without modifying composer layout', () => {
  const fixture = elements()
  const view = renderHook(() => useGuidePopover(true, fixture.anchor, fixture.panel))
  expect(view.result.current).toEqual({ left: 624, top: 232, width: 240, maxHeight: 240 })
  vi.stubGlobal('innerWidth', 720)
  act(() => { window.dispatchEvent(new Event('resize')) })
  expect(view.result.current?.left).toBe(468)
  act(() => { window.dispatchEvent(new Event('scroll')) })
  expect(view.result.current?.top).toBe(232)
  expect(fixture.seat.style.cssText).toBe('')
})

it('stays below hero controls and limits the scrollable panel to the space above the mascot', () => {
  const fixture = elements()
  const control = document.createElement('button')
  control.setAttribute('aria-haspopup', 'menu')
  fixture.seat.append(control)
  const bounds = vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 240, 295, 40))
  const view = renderHook(() => useGuidePopover(true, fixture.anchor, fixture.panel))
  expect(view.result.current).toEqual({ left: 624, top: 288, width: 240, maxHeight: 104 })
  bounds.mockReturnValue(new DOMRect(600, 280, 295, 40))
  act(() => { window.dispatchEvent(new Event('scroll')) })
  expect(view.result.current).toEqual({ left: 624, top: 328, width: 240, maxHeight: 64 })
  bounds.mockReturnValue(new DOMRect(0, 600, 200, 40))
  act(() => { window.dispatchEvent(new Event('scroll')) })
  expect(view.result.current).toEqual({ left: 624, top: 232, width: 240, maxHeight: 240 })
})

it('uses the space right of the mode tabs when a short desktop window would clip the body', () => {
  const fixture = elements()
  vi.stubGlobal('innerWidth', 880)
  const bounds = vi.spyOn(fixture.anchor.current, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(640, 248, 176, 96))
  const control = document.createElement('div')
  control.setAttribute('role', 'tablist')
  fixture.seat.append(control)
  vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(new DOMRect(285, 140, 358, 49))
  const view = renderHook(() => useGuidePopover(true, fixture.anchor, fixture.panel))
  expect(view.result.current).toEqual({ left: 651, top: 80, width: 217, maxHeight: 228 })
  expect(fixture.seat.style.cssText).toBe('')
  bounds.mockReturnValue(new DOMRect(640, 450, 176, 96))
  act(() => { window.dispatchEvent(new Event('resize')) })
  expect(view.result.current).toEqual({ left: 628, top: 282, width: 240, maxHeight: 240 })
})

it('disconnects observation and removes listeners when closed or unmounted', () => {
  const fixture = elements()
  const disconnect = vi.fn()
  const observe = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect = disconnect })
  const remove = vi.spyOn(window, 'removeEventListener')
  const view = renderHook(({ open }) => useGuidePopover(open, fixture.anchor, fixture.panel), { initialProps: { open: true } })
  expect(observe).toHaveBeenCalledWith(fixture.seat)
  view.rerender({ open: false })
  expect(view.result.current).toBeNull()
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true)
  view.rerender({ open: true })
  view.unmount()
  expect(disconnect).toHaveBeenCalledTimes(2)
})

it('uses viewport placement when the anchor has no composer ancestor', () => {
  const fixture = elements()
  fixture.seat.removeAttribute('data-composer-seat')
  const view = renderHook(() => useGuidePopover(true, fixture.anchor, fixture.panel))
  expect(view.result.current).toEqual({ left: 624, top: 232, width: 240, maxHeight: 240 })
})

it('does not subscribe before the anchor and panel content mount', () => {
  const fixture = elements()
  const missing = renderHook(() => useGuidePopover(true, { current: null }, fixture.panel))
  expect(missing.result.current).toBeNull()
  fixture.panel.current.replaceChildren()
  const empty = renderHook(() => useGuidePopover(true, fixture.anchor, fixture.panel))
  expect(empty.result.current).toBeNull()
})
