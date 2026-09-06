// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installManturTheme } from '../adapters/openchatcut-theme.mjs'

afterEach(() => { vi.restoreAllMocks(); document.documentElement.removeAttribute('style') })

it('accepts only the trusted parent and restores presentation on disposal', () => {
  const parent = { postMessage: vi.fn() }
  const target = {
    parent, document, location: { href: 'http://127.0.0.1:5299/?manturTheme=light#/editor/test' },
    addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
  }
  const dispose = installManturTheme(target, 'http://127.0.0.1:5298')
  const root = document.documentElement.style
  expect(root.getPropertyValue('--cc-panel')).toBe('#ffffff')
  const send = (data: unknown, origin = 'http://127.0.0.1:5298', source: unknown = parent) => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }))
  }
  const dark = { type: 'mantur:theme', version: 1, scheme: 'dark' }
  send(dark, 'http://evil.test')
  send(dark, undefined, window)
  send({ ...dark, version: 2 })
  send({ ...dark, scheme: 'unknown' })
  send(null)
  expect(root.getPropertyValue('--cc-color-scheme')).toBe('light')
  send(dark)
  expect(root.getPropertyValue('--cc-color-scheme')).toBe('dark')
  expect(root.getPropertyValue('--cc-panel')).toBe('#202125')
  send({ ...dark, scheme: 'light' })
  expect(root.getPropertyValue('--cc-panel')).toBe('#ffffff')
  expect(parent.postMessage).toHaveBeenCalledWith({ type: 'mantur:theme-ready', version: 1 }, 'http://127.0.0.1:5298')
  dispose()
  send(dark)
  expect(root.getPropertyValue('--cc-panel')).toBe('')
})

it('rejects ambiguous parent origins and leaves standalone editors unchanged', () => {
  expect(() => installManturTheme(window, 'https://example.com')).toThrow('loopback')
  expect(() => installManturTheme(window, 'http://localhost:5298/')).toThrow('exact')
  const dispose = installManturTheme(window, 'http://localhost:5298')
  expect(document.documentElement.style.length).toBe(0)
  dispose()
})
