// @vitest-environment jsdom

import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ManturComposerLayout } from '../src/client/ManturComposerLayout.tsx'

afterEach(cleanup)

it('places the existing workspace control after the editor and retains the editor when the hero closes', () => {
  const parts = {
    hero: true, heading: <h1>Heading</h1>, workspace: <button type="button">Workspace</button>,
    content: <><input aria-label="Draft" defaultValue="Keep draft" /><button type="button">Send</button></>,
  } as PropsRuntime<'conversation.composer.layout'>
  const view = render(<ManturComposerLayout {...parts} />)
  const editor = screen.getByRole('textbox')
  const workspace = screen.getByRole('button', { name: 'Workspace' })
  expect(screen.getByRole('button', { name: 'Send' }).compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  view.rerender(<ManturComposerLayout {...parts} hero={false} heading={null} workspace={null} />)
  expect(screen.getByRole('textbox')).toBe(editor)
  expect((editor as HTMLInputElement).value).toBe('Keep draft')
  expect(screen.queryByRole('button', { name: 'Workspace' })).toBeNull()
})
