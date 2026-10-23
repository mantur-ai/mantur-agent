/** Native desktop browser bounds follow the visible workbench content rectangle. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createWorkbenchStore } from './store.ts'
import { webWorkbenchUrl } from '../web-url.ts'
import css from './Workbench.module.css'

declare global {
  interface Window {
    /** Isolated desktop view; absent in ordinary browsers. */
    manturWebBrowser?: {
      show: (request: { url: string; bounds: { x: number; y: number; width: number; height: number } }) => Promise<void>
      hide: () => Promise<void>
    }
  }
}

/** @param props - Session-local address and localized controls. @returns Native browser placeholder and address toolbar. */
export function WebPanel(props: PropsStore<ReturnType<typeof createWorkbenchStore>> & PropsLocale<'script.mantur'> & { session: string }) {
  const url = props.useStore(s => s.urls[props.session])
  const [address, setAddress] = useState(url ?? '')
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const area = useRef<HTMLDivElement>(null)
  useEffect(() => { setAddress(url ?? '') }, [url])
  useEffect(() => {
    const bridge = window.manturWebBrowser
    const element = area.current
    if (bridge === undefined || element === null || url === undefined) return
    let active = true
    let last = ''
    let pending = Promise.resolve()
    let revision = 0
    const failure = (_reason: unknown) => { if (active) setError(props.t('webLoadFailed')) }
    const update = () => {
      const rect = element.getBoundingClientRect()
      const blocked = document.querySelector('[aria-modal="true"], dialog[open], [role="menu"], [role="listbox"]') !== null
      const visible = !document.hidden && !blocked && rect.width > 0 && rect.height > 0
      const bounds = {
        x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)),
        width: Math.max(0, Math.floor(Math.min(rect.width, window.innerWidth - rect.x))),
        height: Math.max(0, Math.floor(Math.min(rect.height, window.innerHeight - rect.y))),
      }
      const next = visible ? JSON.stringify(bounds) : 'hidden'
      if (next === last) return
      last = next
      const request = ++revision
      if (!visible) { void bridge.hide().catch(failure); return }
      pending = pending.then(async () => {
        if (!active || request !== revision) return
        try { await bridge.show({ url, bounds }) }
        catch (reason) { if (request === revision) failure(reason) }
      })
    }
    const resize = new ResizeObserver(update)
    resize.observe(element)
    const overlays = new MutationObserver(update)
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'open', 'hidden', 'style', 'class'] })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    document.addEventListener('visibilitychange', update)
    update()
    return () => {
      active = false
      resize.disconnect(); overlays.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      document.removeEventListener('visibilitychange', update)
      void bridge.hide().catch(() => { /* Desktop shutdown may invalidate the bridge after this panel unmounts. */ })
    }
  }, [url, attempt])
  return <div className={css.panel}>
    <form className={css.toolbar} onSubmit={(event) => {
      event.preventDefault()
      try {
        const next = webWorkbenchUrl(address)
        setError(undefined); props.actions.openWeb(props.session, next); setAttempt(value => value + 1)
      }
      catch { setError(props.t('webInvalid')) }
    }}>
      <input className={css.webAddress} aria-label={props.t('webAddress')} value={address} onChange={(event) => { setAddress(event.target.value) }} />
      <button type="submit">{props.t('webOpen')}</button>
      <button type="button" disabled={url === undefined} onClick={() => {
        props.actions.closeWeb(props.session); setAddress(''); setError(undefined)
      }}>{props.t('webClose')}</button>
    </form>
    {error !== undefined && <p role="alert" className={css.status}>{error}</p>}
    <div ref={area} className={css.panel}>
      {window.manturWebBrowser === undefined ? <p className={css.empty}>{props.t('webUnsupported')}</p>
        : url === undefined ? <p className={css.empty}>{props.t('webEmpty')}</p> : null}
    </div>
  </div>
}
