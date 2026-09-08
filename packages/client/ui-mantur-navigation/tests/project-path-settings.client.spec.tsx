// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ProjectPathSettings } from '../src/client/ProjectPathSettings.tsx'
import type { AutomaticProjectState } from '../src/client/automatic-project.ts'
import { zh } from '../src/client/project-locales.ts'

afterEach(cleanup)

it('reads the existing root on mount and invokes the shared directory picker', () => {
  const chooseRoot = vi.fn(async () => {})
  const reloadRoot = vi.fn(async () => {})
  const path = '/documents/漫途项目/很长的项目目录名称/保留完整路径'
  let state: AutomaticProjectState = { settings: { source: 'custom', rootPath: path }, loading: false, choosing: false, preparing: false, error: null }
  const props = {
    chooseRoot, reloadRoot, t: makeTranslate(zh), useAutomaticProject: select => select(state),
  } as ComponentProps<typeof ProjectPathSettings>
  const view = render(<ProjectPathSettings {...props} />)
  expect(reloadRoot).toHaveBeenCalledOnce()
  expect(screen.getByText(zh.location)).toBeTruthy()
  expect(screen.getByText(path)).toBeTruthy()
  expect(screen.getByText(zh.futureOnly)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.change }))
  expect(chooseRoot).toHaveBeenCalledOnce()
  state = { ...state, choosing: true }
  view.rerender(<ProjectPathSettings {...props} />)
  expect(screen.getByRole('button', { name: zh.changing }).hasAttribute('disabled')).toBe(true)
  expect(reloadRoot).toHaveBeenCalledOnce()
})

it('shows loading, unconfigured and failed reads instead of a guessed or stale directory', () => {
  let state: AutomaticProjectState = { settings: undefined, loading: true, choosing: false, preparing: false, error: null }
  const reloadRoot = vi.fn(async () => {})
  const props = {
    chooseRoot: vi.fn(), reloadRoot, t: makeTranslate(zh), useAutomaticProject: select => select(state),
  } as ComponentProps<typeof ProjectPathSettings>
  const view = render(<ProjectPathSettings {...props} />)
  expect(screen.getByText(zh.loading)).toBeTruthy()
  state = { ...state, loading: false, settings: { source: 'unconfigured' } }
  view.rerender(<ProjectPathSettings {...props} />)
  expect(screen.getByText(zh.unconfigured)).toBeTruthy()
  state = { ...state, settings: undefined, error: zh.settingsFailed }
  view.rerender(<ProjectPathSettings {...props} />)
  expect(screen.getByRole('alert').textContent).toBe(zh.settingsFailed)
  fireEvent.click(screen.getByRole('button', { name: zh.retry }))
  expect(reloadRoot).toHaveBeenCalledTimes(2)
  state = { ...state, choosing: true }
  view.rerender(<ProjectPathSettings {...props} />)
  expect(screen.getByRole('button', { name: zh.retry }).hasAttribute('disabled')).toBe(true)
  state = { ...state, choosing: false, loading: true }
  view.rerender(<ProjectPathSettings {...props} />)
  expect(screen.getByRole('button', { name: zh.retry }).hasAttribute('disabled')).toBe(true)
})
