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
    hero: true, disabled: false, renderSlot: () => <button type="button">Permissions</button>,
    heading: <h1>Heading</h1>, workspace: <button type="button">Workspace</button>,
    content: <><input aria-label="Draft" defaultValue="Keep draft" /><button type="button">Send</button></>,
    reloadRoot: async () => {}, t: makeTranslate(zh),
    useAutomaticProject: select => select({ settings: { source: 'desktop', rootPath: '/documents/漫途项目' }, loading: false, choosing: false, preparing: false, error: null }),
  } as ComponentProps<typeof ManturComposerLayout>
  const view = render(<ManturComposerLayout {...parts} />)
  const editor = screen.getByRole('textbox')
  const workspace = screen.getByRole('button', { name: 'Workspace' })
  expect(screen.queryByText(zh.location)).toBeNull()
  expect(screen.queryByText('/documents/漫途项目')).toBeNull()
  expect(view.container.querySelector('details')).toBeNull()
  expect(screen.getByRole('button', { name: 'Send' }).compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(workspace.compareDocumentPosition(screen.getByRole('button', { name: 'Permissions' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  view.rerender(<ManturComposerLayout {...parts} hero={false} heading={null} workspace={null} />)
  expect(screen.getByRole('textbox')).toBe(editor)
  expect((editor as HTMLInputElement).value).toBe('Keep draft')
  expect(screen.queryByRole('button', { name: 'Workspace' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Permissions' })).toBeTruthy()
})

it('keeps location controls off the home screen while retaining creation status and recovery', () => {
  let state: AutomaticProjectState = { settings: undefined, loading: true, choosing: false, preparing: false, error: null }
  const reloadRoot = vi.fn(async () => {})
  const props = {
    hero: true, disabled: false, renderSlot: () => null, heading: null, workspace: null, content: <input aria-label="Draft" />,
    reloadRoot, t: makeTranslate(zh), useAutomaticProject: select => select(state),
  } as ComponentProps<typeof ManturComposerLayout>
  const view = render(<ManturComposerLayout {...props} />)
  const editor = screen.getByRole('textbox')
  expect(screen.queryByText(zh.loading)).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  state = { ...state, loading: false, error: zh.settingsFailed }
  view.rerender(<ManturComposerLayout {...props} />)
  expect(screen.queryByText(zh.unconfigured)).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain(zh.settingsFailed)
  fireEvent.click(screen.getByRole('button', { name: zh.retry }))
  expect(reloadRoot).toHaveBeenCalledOnce()
  expect(screen.getByText(zh.settingsHint)).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh.change })).toBeNull()
  state = { ...state, settings: { source: 'unconfigured' }, choosing: true, preparing: true }
  view.rerender(<ManturComposerLayout {...props} />)
  expect(screen.queryByRole('button', { name: zh.changing })).toBeNull()
  expect(screen.getByRole('status').textContent).toBe(zh.creating)
  expect(screen.queryByRole('button', { name: zh.retry })).toBeNull()
  view.rerender(<ManturComposerLayout {...props} sessionId={'existing' as SessionId} />)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('textbox')).toBe(editor)
})

it('does not reserve a project status container while the home draft is idle', () => {
  const props = {
    hero: true, disabled: false, renderSlot: () => null,
    heading: null, workspace: <button type="button">Workspace</button>, content: <input aria-label="Draft" />,
    reloadRoot: vi.fn(), t: makeTranslate(zh),
    useAutomaticProject: select => select({ settings: { source: 'unconfigured' }, loading: false, choosing: false, preparing: false, error: null }),
  } as ComponentProps<typeof ManturComposerLayout>
  const view = render(<ManturComposerLayout {...props} />)
  const footer = view.container.querySelector('[data-workspace-footer]')!
  expect(footer.children).toHaveLength(1)
  expect(footer.firstElementChild).toBe(screen.getByRole('button', { name: 'Workspace' }))
})
