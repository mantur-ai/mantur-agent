/** Position the assistant outside layout, keeping composer controls unobstructed. */

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/**
 * Place guidance above/right of the mascot, beside hero controls when their lower gap clips the text.
 * @param open - whether the panel is mounted.
 * @param anchorRef - mascot button inside the resident composer.
 * @param panelRef - guidance panel whose content determines its height.
 * @returns fixed coordinates and the available scroll height, or null before measurement.
 */
export function useGuidePopover(
  open: boolean, anchorRef: RefObject<HTMLButtonElement | null>, panelRef: RefObject<HTMLElement | null>,
): CSSProperties | null {
  const [position, setPosition] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (anchor === null || panel === null) return
    const content = panel.lastElementChild
    if (content === null) return
    const seat = anchor.closest('[data-composer-seat]')
    const place = (): void => {
      const rect = anchor.getBoundingClientRect()
      let width = Math.min(240, window.innerWidth - 24)
      let left = Math.max(12, Math.min(rect.left + 24, window.innerWidth - width - 12))
      const height = Math.min(content.scrollHeight + panel.offsetHeight - content.clientHeight, 240)
      const bottom = rect.top - 8
      let topLimit = 12
      let rightLimit = left
      for (const element of seat?.querySelectorAll('[role="tablist"], button[aria-haspopup="menu"]') ?? []) {
        const control = element.getBoundingClientRect()
        if (control.width > 0 && control.left < left + width && control.right > left && control.bottom <= bottom) {
          topLimit = Math.max(topLimit, control.bottom + 8)
          rightLimit = Math.max(rightLimit, control.right + 8)
        }
      }
      const sideWidth = window.innerWidth - rightLimit - 12
      // Preserve a readable text width beside the tabs when their lower gap clips the body.
      if (bottom - topLimit < height && sideWidth >= 180) {
        left = rightLimit
        width = Math.min(width, sideWidth)
        topLimit = 12
      }
      const maxHeight = Math.max(0, Math.min(240, bottom - topLimit))
      const next = { left, top: Math.max(topLimit, bottom - Math.min(height, maxHeight)), width, maxHeight }
      setPosition(previous => previous?.left === next.left && previous.top === next.top
        && previous.width === next.width && previous.maxHeight === next.maxHeight ? previous : next)
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    observer?.observe(anchor)
    observer?.observe(panel)
    if (seat !== null) observer?.observe(seat)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, panelRef])
  return position
}
