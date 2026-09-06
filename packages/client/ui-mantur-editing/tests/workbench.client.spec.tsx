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

function mount(editorUrl: string, dictionary = en) {
  const settings = stubSettingsScope<EditingSettings>()
  settings.publish({ status: 'ready', value: { editorUrl } })
  const preferences = settings.scope
  const props = {
    usePreferences: (select: (value: ReturnType<typeof preferences.getSnapshot>) => unknown) => select(preferences.getSnapshot()),
    closeWorkbench: vi.fn(), t: (key: keyof typeof en) => dictionary[key],
  } as ComponentProps<typeof Workbench>
  return { ...render(<Workbench {...props} />), props }
}

describe('local editor workbench', () => {
  it.each([['en', en], ['zh', zh]] as const)('records the %s workbench controls and embedded project', (_language, dictionary) => {
    const { getByRole } = mount('http://localhost:5299/#/editor/test', dictionary)
    expect(getByRole('region').outerHTML).toMatchSnapshot()
  })

  it('embeds the configured project and keeps close and reload explicit', () => {
    const { getByTitle, getByRole, props } = mount('http://127.0.0.1:5299/#/editor/test')
    const frame = getByTitle(en.title)
    expect(frame.getAttribute('src')).toBe('http://127.0.0.1:5299/#/editor/test')
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

  it.each(['https://127.0.0.1/', 'http://127.0.0.1.evil.test/', 'http://user:secret@127.0.0.1/', 'http://localhost/?token=secret'])('rejects an unsupported editor address %s', (url) => {
    expect(() => localEditorUrl(url)).toThrow()
  })
})
