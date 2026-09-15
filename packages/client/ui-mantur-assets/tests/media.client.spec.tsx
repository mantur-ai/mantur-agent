// @vitest-environment jsdom
/** Media bindings retain the current selection across delayed success and failure. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { MediaPreview } from '../src/client/MediaPreview.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function props(): ComponentProps<typeof MediaPreview> {
  return { path: 'local.png', kind: 'image', name: 'asset', session: 'media-test' as never, binding: '',
    resolve: vi.fn(async () => ({ id: null, name: 'asset', kind: 'image' as const, url: '/local.png' })),
    resolveBound: vi.fn(async () => ({ id: 'asset', name: 'asset', kind: 'image' as const, url: '/bound.png' })), t: key => zh[key as keyof typeof zh] }
}
it.each(['image', 'video'] as const)('reports browser decoding failure for %s', async (kind) => {
  const view = render(<MediaPreview {...props()} kind={kind} />)
  await waitFor(() => { expect(view.container.querySelector(kind === 'image' ? 'img' : 'video')).toBeTruthy() })
  fireEvent.error(view.container.querySelector(kind === 'image' ? 'img' : 'video')!)
  expect(screen.getByRole('alert').textContent).toContain(zh.unavailable)
})
it('shows an empty video and a failed thumbnail without a detail alert', async () => {
  const subject = props()
  const view = render(<MediaPreview {...subject} path="" kind="video" />)
  expect(screen.getByText(zh.noVideo)).toBeTruthy()
  view.rerender(<MediaPreview {...subject} path="ftp://invalid" thumbnail />)
  expect(screen.getByText(`${zh.mediaError} ${zh.invalidMedia}`)).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
it.each([true, false])('loads and reports both error forms for bound=%s', async (bound) => {
  const subject = props()
  const resolver = bound ? subject.resolveBound : subject.resolve
  const binding = bound ? 'asset' : ''
  const view = render(<MediaPreview {...subject} binding={binding} />)
  expect((await screen.findByRole('img')).getAttribute('src')).toBe(bound ? '/bound.png' : '/local.png')
  vi.mocked(resolver).mockRejectedValueOnce(new Error('missing')).mockRejectedValueOnce('unavailable')
  view.rerender(<MediaPreview {...subject} binding={binding} path="second.png" />)
  expect((await screen.findByRole('alert')).textContent).toContain('missing')
  view.rerender(<MediaPreview {...subject} binding={binding} path="third.png" />)
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(zh.error) })
})
it.each([true, false])('ignores old success and rejection after a new selection, bound=%s', async (bound) => {
  const subject = props()
  const resolver = bound ? subject.resolveBound : subject.resolve
  let success!: (value: Awaited<ReturnType<typeof resolver>>) => void
  let failure!: (reason: unknown) => void
  vi.mocked(resolver).mockImplementationOnce(() => new Promise((resolve) => { success = resolve }))
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { failure = reject }))
  const view = render(<MediaPreview {...subject} binding={bound ? 'first' : ''} />)
  view.rerender(<MediaPreview {...subject} path="second.png" binding={bound ? 'second' : ''} />)
  view.rerender(<MediaPreview {...subject} path="third.png" binding={bound ? 'third' : ''} />)
  await screen.findByRole('img')
  await act(async () => { success({ id: null, name: 'old', kind: 'image', url: '/old.png' }); failure(new Error('old failure')) })
  expect(screen.getByRole('img').getAttribute('src')).toBe(bound ? '/bound.png' : '/local.png')
  expect(screen.queryByRole('alert')).toBeNull()
})
