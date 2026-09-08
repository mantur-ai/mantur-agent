// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { EditingAction, Workbench } from '../src/client/Workbench.tsx'
import { localEditorUrl } from '../src/settings.ts'
import { en, zh } from '../src/client/locales.ts'
import type { ComponentProps } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { EditingWorkspace } from '../src/types.ts'

afterEach(cleanup)
type Props = ComponentProps<typeof Workbench>
const workspace = { editorUrl: 'http://127.0.0.1:5299/', directory: '/project/editing/session-a' }
function propsFor(dictionary = en): Props {
  return {
    useSessions: select => select({ current: 'session-a' as SessionId } as never),
    openWorkspace: vi.fn(async () => workspace),
    getColorScheme: () => 'light', subscribeTheme: () => () => {},
    getLocale: () => dictionary === zh ? 'zh' : 'en', subscribeLocale: () => () => {},
    closeWorkbench: vi.fn(), t: (key: keyof typeof en) => dictionary[key],
  } as Props
}

async function mount(dictionary = en) {
  const props = propsFor(dictionary)
  const view = render(<Workbench {...props} />)
  await view.findByTitle(dictionary.title)
  return { ...view, props }
}

describe('Session editor workbench', () => {
  it.each([en, zh])('reopens editing from an existing conversation header', (dictionary) => {
    const openWorkbench = vi.fn()
    const view = render(<EditingAction openWorkbench={openWorkbench} t={propsFor(dictionary).t} />)
    fireEvent.click(view.getByRole('button', { name: dictionary.open }))
    expect(openWorkbench).toHaveBeenCalledOnce()
    expect(view.container.innerHTML).toMatchSnapshot()
  })
  it.each([['en', en], ['zh', zh]] as const)('records the %s workspace and controls', async (_language, dictionary) => {
    const { getByRole } = await mount(dictionary)
    expect(getByRole('region').outerHTML).toMatchSnapshot()
  })

  it('opens the selected Session and gives close and reload explicit controls', async () => {
    const { getByTitle, findByTitle, getByRole, props } = await mount()
    expect(props.openWorkspace).toHaveBeenCalledWith('session-a')
    const frame = getByTitle(en.title)
    expect(frame.getAttribute('src')).toBe('http://127.0.0.1:5299/?manturTheme=light&manturLocale=en')
    fireEvent.click(getByRole('button', { name: en.reload }))
    expect(await findByTitle(en.title)).not.toBe(frame)
    fireEvent.click(getByRole('button', { name: en.close }))
    expect(props.closeWorkbench).toHaveBeenCalledOnce()
  })

  it('does not start an editor before a Session is selected', () => {
    const props = propsFor()
    props.useSessions = select => select({ current: undefined } as never)
    const view = render(<Workbench {...props} />)
    expect(view.getByRole('status').textContent).toBe(en.selectSession)
    expect(props.openWorkspace).not.toHaveBeenCalled()
  })

  it.each([[new Error('Directory is unavailable'), 'Directory is unavailable'], ['plain failure', 'plain failure']] as const)('shows startup failure %p without using a previous or external editor', async (failure, message) => {
    const props = propsFor()
    props.openWorkspace = async () => { throw failure }
    const view = render(<Workbench {...props} />)
    expect((await view.findByRole('alert')).textContent).toContain(message)
    expect(view.queryByTitle(en.title)).toBeNull()
  })

  it('ignores a previous Session startup that completes after switching', async () => {
    const props = propsFor()
    let first!: (value: EditingWorkspace) => void
    props.openWorkspace = id => id === 'session-a' ? new Promise((resolve) => { first = resolve }) : Promise.resolve({ ...workspace, editorUrl: 'http://127.0.0.1:5300/' })
    const view = render(<Workbench {...props} />)
    view.rerender(<Workbench {...props} useSessions={select => select({ current: 'session-b' as SessionId } as never)} />)
    expect((await view.findByTitle(en.title)).getAttribute('src')).toContain(':5300/')
    await act(async () => { first(workspace) })
    expect(view.getByTitle(en.title).getAttribute('src')).toContain(':5300/')
  })

  it('ignores a previous Session failure that arrives after switching', async () => {
    const props = propsFor()
    let rejectFirst!: (error: unknown) => void
    props.openWorkspace = id => id === 'session-a'
      ? new Promise((_resolve, reject) => { rejectFirst = reject })
      : Promise.resolve({ ...workspace, editorUrl: 'http://127.0.0.1:5300/' })
    const view = render(<Workbench {...props} />)
    view.rerender(<Workbench {...props} useSessions={select => select({ current: 'session-b' as SessionId } as never)} />)
    expect((await view.findByTitle(en.title)).getAttribute('src')).toContain(':5300/')
    await act(async () => { rejectFirst(new Error('stale failure')) })
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('shows loading until the selected Session runtime is ready', async () => {
    const props = propsFor()
    let ready!: (value: EditingWorkspace) => void
    props.openWorkspace = () => new Promise((resolve) => { ready = resolve })
    const view = render(<Workbench {...props} />)
    try {
      expect(view.getByRole('status').textContent).toBe(en.loading)
      expect(view.queryByTitle(en.title)).toBeNull()
    } finally {
      await act(async () => { ready(workspace) })
    }
    expect(view.getByTitle(en.title)).not.toBeNull()
    expect(view.queryByRole('status')).toBeNull()
  })

  it.each(['https://127.0.0.1/', 'http://127.0.0.1.evil.test/', 'http://user:secret@127.0.0.1/', 'http://localhost/?token=secret'])('rejects an unsupported editor address %s', (url) => {
    expect(() => localEditorUrl(url)).toThrow()
  })
})

it('updates theme and locale without replacing the iframe and checks ready-message origin', async () => {
  const { getByTitle, props, rerender, unmount } = await mount()
  const frame = getByTitle(en.title) as HTMLIFrameElement
  const send = vi.spyOn(frame.contentWindow!, 'postMessage')
  rerender(<Workbench {...props} getColorScheme={() => 'dark'} getLocale={() => 'zh'} />)
  expect(getByTitle(en.title)).toBe(frame)
  expect(send).toHaveBeenCalledWith({ type: 'mantur:theme', version: 1, scheme: 'dark' }, 'http://127.0.0.1:5299')
  expect(send).toHaveBeenCalledWith({ type: 'mantur:locale', version: 1, locale: 'zh' }, 'http://127.0.0.1:5299')
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
  expect(send).toHaveBeenCalledTimes(2)
  const child = frame.contentWindow
  unmount()
  fireEvent(window, new MessageEvent('message', { source: child, origin: 'http://127.0.0.1:5299', data: ready }))
  expect(send).toHaveBeenCalledTimes(2)
})
