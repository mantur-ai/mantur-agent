/** Concurrent draft edits and explicit adoption of externally modified script files. */
import { expect, it } from 'vitest'
import { createWorkbenchStore, type Draft } from '../src/client/store.ts'
import type { ScriptDocument } from '../src/types.ts'

const original: ScriptDocument = { path: '/project/script.md', content: 'original', version: 'v1' as ScriptDocument['version'] }
const disk: ScriptDocument = { ...original, content: 'disk', version: 'v2' as ScriptDocument['version'] }

it('ignores updates for unopened files and preserves edits across repeated opens', () => {
  const view = createWorkbenchStore().create()
  view.actions.edit('absent', original.path, 'unowned')
  view.actions.observed('absent', disk)
  view.actions.saved('absent', { base: original, text: original.content }, disk)
  view.actions.useDisk('absent', original.path)
  expect(view.store.getSnapshot().drafts).toEqual({})
  view.actions.open('session', original)
  view.actions.edit('session', '/missing', 'unowned')
  view.actions.observed('session', { ...disk, path: '/missing' })
  view.actions.saved('session', { base: original, text: original.content }, { ...disk, path: '/missing' })
  view.actions.useDisk('session', '/missing')
  view.actions.useDisk('session', original.path)
  view.actions.observed('session', original)
  view.actions.edit('session', original.path, 'local edit')
  view.actions.open('session', original)
  expect(view.store.getSnapshot().drafts.session?.[original.path]?.text).toBe('local edit')
})

it('adopts a new disk generation only explicitly while a local draft is dirty', () => {
  const view = createWorkbenchStore().create()
  view.actions.open('session', original)
  view.actions.edit('session', original.path, 'local edit')
  view.actions.observed('session', disk)
  expect(view.store.getSnapshot().drafts.session?.[original.path]).toEqual({ base: original, text: 'local edit', conflict: disk })
  view.actions.useDisk('session', original.path)
  expect(view.store.getSnapshot().drafts.session?.[original.path]).toEqual({ base: disk, text: disk.content, previous: original })
})

it('preserves edits made while a save is in flight and records the saved disk generation', () => {
  const view = createWorkbenchStore().create()
  view.actions.open('session', original)
  view.actions.edit('session', original.path, 'saving')
  const before = view.store.getSnapshot().drafts.session?.[original.path] as Draft
  view.actions.edit('session', original.path, 'newer local edit')
  view.actions.saved('session', before, disk)
  expect(view.store.getSnapshot().drafts.session?.[original.path]).toEqual({ base: disk, text: 'newer local edit', previous: original })
})


it('refreshes an untouched draft from disk and keeps the preceding generation for comparison', () => {
  const view = createWorkbenchStore().create()
  view.actions.open('session', original)
  view.actions.observed('session', disk)
  expect(view.store.getSnapshot().drafts.session?.[original.path]).toEqual({ base: disk, text: disk.content, previous: original })
})
