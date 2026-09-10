/** Native horizontal skill navigation with overflow controls and no scrollbar. */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronLeftOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CreationGuide.module.css'

/**
 * Keep shortcut focus and trackpad scrolling native; measure only the local scrollport.
 * @param props - Skill buttons, empty-catalog posture, and guide dictionary.
 * @returns A single-line skill rail with controls only when its contents overflow.
 */
export function GuideSkillRail({ children, empty, t }: { children: ReactNode; empty: boolean } & PropsLocale<'guide.mantur'>) {
  const rail = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  useLayoutEffect(() => {
    const node = rail.current
    const frame = node?.parentElement
    /* v8 ignore next -- React attaches the rail and its parent before this effect; detached refs have no scrollport. */
    if (node === null || frame == null) return
    const measure = (): void => {
      const overflowing = node.scrollWidth > frame.clientWidth + 1
      const left = overflowing && node.scrollLeft > 1
      const right = overflowing && node.scrollWidth - node.clientWidth - node.scrollLeft > 1
      setEdges(previous => previous.left === left && previous.right === right ? previous : { left, right })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    observer.observe(frame)
    for (const child of node.children) observer.observe(child)
    node.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => { observer.disconnect(); node.removeEventListener('scroll', measure) }
  }, [children])
  const scroll = (direction: -1 | 1): void => {
    const node = rail.current
    /* v8 ignore next -- Only a mounted rail's arrow can dispatch this handler; an unmounted ref has no scroll target. */
    if (node !== null) node.scrollBy({ left: direction * node.clientWidth })
  }
  const overflow = edges.left || edges.right
  return <div className={css.skillRail} data-skill-rail data-overflow={overflow}>
    <div ref={rail} className={clsx(css.shortcuts, empty && css.noRecommendations)} aria-label={t('recommended')}>
      {children}
    </div>
    {overflow && <>
      <div className={css.railEdge} data-side="left" data-active={edges.left}>
        <button type="button" aria-label={t('previousSkills')} disabled={!edges.left}
          onClick={() => { scroll(-1) }}><IconChevronLeftOutline14 /></button>
      </div>
      <div className={css.railEdge} data-side="right" data-active={edges.right}>
        <button type="button" aria-label={t('nextSkills')} disabled={!edges.right}
          onClick={() => { scroll(1) }}><IconChevronRightOutline14 /></button>
      </div>
    </>}
  </div>
}
