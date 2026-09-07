// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import { ManturComposerLayout } from '../src/client/ManturComposerLayout.tsx'
import { zh } from '../src/client/project-locales.ts'
import type { AutomaticProjectState } from '../src/client/automatic-project.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

afterEach(cleanup)

it('places the existing workspace control after the editor and retains the editor when the hero closes', () => {
  const parts = {
    hero: true, heading: <h1>Heading</h1>, workspace: <button type="button">Workspace</button>,
    content: <><input aria-label="Draft" defaultValue="Keep draft" /><button type="button">Send</button></>,
    chooseRoot: async () => {}, reloadRoot: async () => {}, t: makeTranslate(zh),
    useAutomaticProject: select => select({ settings: { source: 'desktop', rootPath: '/documents/漫途项目' }, loading: false, choosing: false, preparing: false, error: null }),
  } as ComponentProps<typeof ManturComposerLayout>
  const view = render(<ManturComposerLayout {...parts} />)
  const editor = screen.getByRole('textbox')
  const workspace = screen.getByRole('button', { name: 'Workspace' })
  expect(screen.getByRole('button', { name: 'Send' }).compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  view.rerender(<ManturComposerLayout {...parts} hero={false} heading={null} workspace={null} />)
  expect(screen.getByRole('textbox')).toBe(editor)
  expect((editor as HTMLInputElement).value).toBe('Keep draft')
  expect(screen.queryByRole('button', { name: 'Workspace' })).toBeNull()
})

it('shows location loading, selection, preparation and retry states without replacing the editor', () => {
  let state: AutomaticProjectState = { settings: undefined, loading: true, choosing: false, preparing: false, error: null }
  const chooseRoot = vi.fn(async () => {})
  const reloadRoot = vi.fn(async () => {})
  const props = {
    hero: true, heading: null, workspace: null, content: <input aria-label="Draft" />,
    chooseRoot, reloadRoot, t: makeTranslate(zh), useAutomaticProject: select => select(state),
  } as ComponentProps<typeof ManturComposerLayout>
  const view = render(<ManturComposerLayout {...props} />)
  expect(screen.getByText(zh.loading)).toBeTruthy()
  state = { ...state, loading: false, error: zh.settingsFailed }
  view.rerender(<ManturComposerLayout {...props} />)
  expect(screen.getByText(zh.unconfigured)).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain(zh.settingsFailed)
  fireEvent.click(screen.getByRole('button', { name: zh.retry }))
  expect(reloadRoot).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.change, hidden: true }))
  expect(chooseRoot).toHaveBeenCalledOnce()
  state = { ...state, settings: { source: 'unconfigured' }, choosing: true, preparing: true }
  view.rerender(<ManturComposerLayout {...props} />)
  expect(screen.getByText(zh.unconfigured)).toBeTruthy()
  expect(screen.getByRole('button', { name: zh.changing, hidden: true }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('status').textContent).toBe(zh.creating)
  expect(screen.queryByRole('button', { name: zh.retry })).toBeNull()
  view.rerender(<ManturComposerLayout {...props} sessionId={'existing' as SessionId} />)
  expect(screen.queryByText(zh.automatic)).toBeNull()
  expect(screen.getByRole('textbox')).toBeTruthy()
})
