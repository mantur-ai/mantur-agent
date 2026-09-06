/** Native state ordering and lifetime without a simulated product updater. */
import { describe, expect, it, vi } from 'vitest'
import { NativeUpdates, type NativeUpdateBridge, type NativeUpdateSnapshot } from '../src/client/desktop-updates.ts'

function fixture() {
  let changed!: (value: NativeUpdateSnapshot) => void
  let loaded!: (value: NativeUpdateSnapshot) => void
  const unsubscribe = vi.fn()
  const bridge: NativeUpdateBridge = {
    getSnapshot: () => new Promise((resolve) => { loaded = resolve }),
    subscribe: (listener) => { changed = listener; return unsubscribe },
    check: vi.fn(async () => {}), download: vi.fn(async () => {}), install: vi.fn(async () => {}),
  }
  const controller = new NativeUpdates(bridge)
  return { controller, bridge, unsubscribe,
    changed: (value: NativeUpdateSnapshot) => { changed(value) }, loaded: (value: NativeUpdateSnapshot) => { loaded(value) } }
}
const snapshot: NativeUpdateSnapshot = { revision: 2, enabled: true, currentVersion: '1.0.0', state: { kind: 'available', version: '1.2.0', prompting: false } }

describe('native update view', () => {
  it('retains a newer event when the initial snapshot arrives late', async () => {
    const subject = fixture()
    try {
      subject.changed(snapshot)
      subject.loaded({ ...snapshot, revision: 1, state: { kind: 'idle' } })
      await Promise.resolve()
      expect(subject.controller.store.getSnapshot().snapshot).toEqual(snapshot)
    } finally { subject.controller.dispose() }
  })
  it('detaches and ignores late data and actions after unload', async () => {
    const subject = fixture()
    subject.controller.dispose()
    subject.loaded(snapshot)
    subject.changed(snapshot)
    subject.controller.run('download')
    await Promise.resolve()
    expect(subject.controller.store.getSnapshot()).toEqual({})
    expect(subject.unsubscribe).toHaveBeenCalledOnce()
    expect(subject.bridge.download).not.toHaveBeenCalled()
  })
  it('reports IPC rejection while preserving the ready download', async () => {
    const subject = fixture()
    try {
      subject.changed({ ...snapshot, state: { kind: 'ready', version: '1.2.0', prompting: false } })
      vi.mocked(subject.bridge.install).mockRejectedValueOnce(new Error('wrong frame'))
      subject.controller.run('install')
      await vi.waitFor(() => { expect(subject.controller.store.getSnapshot().failure).toBe('wrong frame') })
      expect(subject.controller.store.getSnapshot().snapshot?.state.kind).toBe('ready')
    } finally { subject.controller.dispose() }
  })
})
