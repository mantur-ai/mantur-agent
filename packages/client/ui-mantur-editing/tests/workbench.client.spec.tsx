// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { Workbench } from '../src/client/Workbench.tsx'
import { localEditorUrl } from '../src/settings.ts'
import { en, zh } from '../src/client/locales.ts'
import type { ComponentProps } from 'react'
import type { EditingSettings } from '../src/settings.ts'

afterEach(cleanup)

function mount(editorUrl: string | undefined, dictionary = en) {
  const settings = stubSettingsScope<EditingSettings>()
  if (editorUrl !== undefined) settings.publish({ status: 'ready', value: { editorUrl } })
  const preferences = settings.scope
  const props = {
    usePreferences: (select: (value: ReturnType<typeof preferences.getSnapshot>) => unknown) => select(preferences.getSnapshot()),
    getColorScheme: () => 'light' as const, subscribeTheme: () => () => {},
    closeWorkbench: vi.fn(), t: (key: keyof typeof en) => dictionary[key],
  } as ComponentProps<typeof Workbench>
  return { ...render(<Workbench {...props} />), props, settings }
}

describe('local editor workbench', () => {
  it.each([['en', en], ['zh', zh]] as const)('records the %s workbench controls and embedded project', (_language, dictionary) => {
    const { getByRole } = mount('http://localhost:5299/#/editor/test', dictionary)
    expect(getByRole('region').outerHTML).toMatchSnapshot()
  })

  it('embeds the configured project and keeps close and reload explicit', () => {
    const { getByTitle, getByRole, props } = mount('http://127.0.0.1:5299/#/editor/test')
    const frame = getByTitle(en.title)
    expect(frame.getAttribute('src')).toBe('http://127.0.0.1:5299/?manturTheme=light#/editor/test')
    fireEvent.click(getByRole('button', { name: en.reload }))
    expect(getByTitle(en.title)).not.toBe(frame)
    fireEvent.click(getByRole('button', { name: en.close }))
    expect(props.closeWorkbench).toHaveBeenCalledOnce()
  })

  it('shows a clear error without embedding an external address', () => {
    const { getByRole, queryByTitle } = mount('https://example.com/')
    expect(getByRole('alert').textContent).toBe(en.invalidAddress)
    expect(queryByTitle(en.title)).toBeNull()
  })

  it('shows loading and unavailable settings without creating an editor frame', () => {
    const { getByRole, queryByTitle, props, settings, rerender } = mount(undefined)
    expect(getByRole('status').textContent).toBe(en.loading)
    expect(queryByTitle(en.title)).toBeNull()
    settings.publish({ status: 'unavailable' })
    rerender(<Workbench {...props} />)
    expect(getByRole('status').textContent).toBe(en.unavailable)
    expect(queryByTitle(en.title)).toBeNull()
    settings.publish({ status: 'ready', value: { editorUrl: 'http://localhost:5299/' } })
    rerender(<Workbench {...props} />)
    expect(queryByTitle(en.title)).not.toBeNull()
    expect(() => getByRole('status')).toThrow()
  })

  it.each(['https://127.0.0.1/', 'http://127.0.0.1.evil.test/', 'http://user:secret@127.0.0.1/', 'http://localhost/?token=secret'])('rejects an unsupported editor address %s', (url) => {
    expect(() => localEditorUrl(url)).toThrow()
  })
})

it('updates theme without replacing the iframe or changing its project URL', () => {
  const { getByTitle, props, rerender, unmount } = mount('http://127.0.0.1:5299/#/editor/test')
  const frame = getByTitle(en.title) as HTMLIFrameElement
  const send = vi.spyOn(frame.contentWindow!, 'postMessage')
  fireEvent.load(frame)
  expect(send).toHaveBeenLastCalledWith({ type: 'mantur:theme', version: 1, scheme: 'light' }, 'http://127.0.0.1:5299')
  rerender(<Workbench {...props} getColorScheme={() => 'dark'} />)
  expect(getByTitle(en.title)).toBe(frame)
  expect(frame.src).toContain('manturTheme=light#/editor/test')
  expect(send).toHaveBeenLastCalledWith({ type: 'mantur:theme', version: 1, scheme: 'dark' }, 'http://127.0.0.1:5299')
  send.mockClear()
  const ready = { type: 'mantur:theme-ready', version: 1 }
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'http://evil.test', data: ready }))
  fireEvent(window, new MessageEvent('message', { source: window, origin: 'http://127.0.0.1:5299', data: ready }))
  for (const data of [null, 'ready', {}, { type: 'mantur:theme-ready' },
    { type: 'other', version: 1 }, { type: 'mantur:theme-ready', version: 2 }]) {
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'http://127.0.0.1:5299', data }))
  }
  expect(send).not.toHaveBeenCalled()
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'http://127.0.0.1:5299', data: ready }))
  expect(send).toHaveBeenCalledOnce()
  const child = frame.contentWindow
  unmount()
  fireEvent(window, new MessageEvent('message', { source: child, origin: 'http://127.0.0.1:5299', data: ready }))
  expect(send).toHaveBeenCalledOnce()
})
