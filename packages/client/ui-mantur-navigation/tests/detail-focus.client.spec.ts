// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { focusDetailAction } from '../src/client/detail-focus.ts'

it('focuses only a connected enabled action in the visible source detail, without clicking it', () => {
  const fixture = document.createElement('div')
  const source = document.createElement('div')
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  const button = document.createElement('button')
  const click = vi.fn()
  button.addEventListener('click', click)
  dialog.append(button)
  fixture.append(source, dialog)
  document.body.append(fixture)
  try {
    const focus = vi.spyOn(button, 'focus')
    focusDetailAction(null, button)
    focusDetailAction(source, null)
    source.remove()
    focusDetailAction(source, button)
    fixture.append(source)
    button.remove()
    focusDetailAction(source, button)
    dialog.append(button)
    button.disabled = true
    focusDetailAction(source, button)
    button.disabled = false
    source.hidden = true
    focusDetailAction(source, button)
    source.hidden = false
    dialog.removeAttribute('role')
    focusDetailAction(source, button)
    dialog.setAttribute('role', 'dialog')
    const other = dialog.cloneNode(false)
    fixture.append(other)
    focusDetailAction(source, button)
    fixture.removeChild(other)
    expect(focus).not.toHaveBeenCalled()
    focusDetailAction(source, button)
    expect(document.activeElement).toBe(button)
    expect(click).not.toHaveBeenCalled()
    focus.mockRestore()
  } finally { fixture.remove() }
})
