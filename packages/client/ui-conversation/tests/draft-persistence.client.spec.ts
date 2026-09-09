/** Complete editor restoration and exact-revision native draft checkpoints. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { DraftPersistence } from '../src/client/input/draft-persistence.ts'
import type { DesktopDraftBridge, DraftCheckpoint } from '../src/client/contract/draft-persistence.ts'
import type { DraftAttachmentId, SubmitOutcome } from '../src/client/contract/input.ts'

function shell() {
  return new SessionInputShell({ actx: {} as Context, defaultSink: vi.fn(), commandImages: {
    serialize: async () => [], release: () => {}, unsupportedNotice: () => 'unsupported',
  } })
}
function nativeBridge() {
  let data: DraftCheckpoint = { format: 1, revision: 0, drafts: [] }
  const bridge: DesktopDraftBridge = {
    load: vi.fn(async () => structuredClone(data)),
    save: vi.fn(async (next: DraftCheckpoint) => { data = structuredClone(next); return data.revision }),
    onPrepare: () => () => {}, onRelease: () => () => {},
  }
  return { bridge, read: () => data }
}
const images = { capture: async () => [], restore: async () => [] }

describe('native draft persistence', () => {
  it('does not remove a saved owner attached while another draft is being captured', async () => {
    const native = nativeBridge()
    const previous = shell()
    const seed = new DraftPersistence(native.bridge, images, () => 'submission failed')
    await seed.attachDraft('session:b', previous)
    previous.setDraft('saved B')
    await seed.save()
    seed.dispose(); previous.dispose()
    const entered = Promise.withResolvers<undefined>()
    const capture = Promise.withResolvers<never[]>()
    const a = shell()
    const b = shell()
    const registry = { ...images, capture: vi.fn(images.capture) }
    const saved = vi.spyOn(native.bridge, 'save')
    const store = new DraftPersistence(native.bridge, registry, () => 'submission failed')
    let pending: Promise<void> | undefined
    try {
      await store.attachDraft('session:a', a)
      await store.save()
      saved.mockClear()
      registry.capture.mockImplementationOnce(() => { entered.resolve(undefined); return capture.promise })
      a.setDraft('changed A')
      pending = store.save()
      await entered.promise
      await store.attachDraft('session:b', b)
      expect(b.snapshot.draft).toBe('saved B')
      capture.resolve([])
      await pending
      expect(saved.mock.calls.length).toBeGreaterThan(0)
      for (const [checkpoint] of saved.mock.calls) {
        expect(checkpoint.drafts.some(draft => draft.owner === 'session:b')).toBe(true)
      }
    } finally { capture.resolve([]); await pending; store.dispose(); a.dispose(); b.dispose() }
  })

  it.each(['success', 'error', 'rejection', 'image-success'] as const)('waits for %s admission without sending again or losing another composer', async (outcome) => {
    const admission = Promise.withResolvers<SubmitOutcome>()
    const observed = Promise.withResolvers<undefined>()
    const sink = vi.fn(() => admission.promise)
    const input = new SessionInputShell({ actx: {} as Context, defaultSink: sink, commandImages: {
      serialize: async () => [], release: () => {}, unsupportedNotice: () => 'unsupported',
    } })
    const other = shell()
    const native = nativeBridge()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    let settled: Promise<unknown> | undefined
    try {
      await store.attachDraft('session:submitting', input)
      await store.attachDraft('unassigned', other)
      other.setDraft('unsent homepage draft')
      await store.save()
      if (outcome === 'image-success') input.addImages(['photo' as DraftAttachmentId])
      else input.setDraft('submitted once')
      input.submit()
      expect(() => input.lockDraft()).toThrow('Draft submission is still in progress')
      const isSettled = input.isRestartSettled.bind(input)
      vi.spyOn(input, 'isRestartSettled').mockImplementation(() => { observed.resolve(undefined); return isSettled() })
      const prepare = store.prepare()
      settled = prepare.then(() => {}, () => {})
      const failed = outcome === 'error' || outcome === 'rejection'
      const result = failed ? expect(prepare).rejects.toThrow('submission failed; restart cancelled') : undefined
      await observed.promise
      await expect(store.prepare()).rejects.toThrow('already preparing')
      expect(input.editor.isEditable()).toBe(true)
      expect(sink).toHaveBeenCalledOnce()
      if (outcome === 'rejection') admission.reject(new Error('connection lost'))
      else admission.resolve({ kind: failed ? 'error' : 'success' })
      if (failed) {
        await result
        expect(input.snapshot.draft).toBe('submitted once')
        expect(input.editor.isEditable()).toBe(true)
      } else {
        expect(await prepare).toBe(native.read().revision)
        expect(input.snapshot).toMatchObject({ draft: '', imageIds: [] })
        expect(input.editor.isEditable()).toBe(false)
        const saved = native.read().drafts.find(draft => draft.owner === 'unassigned')!
        const restored = shell()
        try {
          restored.restoreDraft({ ...saved, imageIds: [] })
          expect(restored.snapshot.draft).toBe('unsent homepage draft')
        } finally { restored.dispose() }
      }
      expect(other.snapshot.draft).toBe('unsent homepage draft')
      expect(sink).toHaveBeenCalledOnce()
    } finally {
      admission.resolve({ kind: 'success' })
      store.release()
      await settled
      store.dispose(); input.dispose(); other.dispose()
    }
  })

  it.each(['cancel', 'detach', 'attach'] as const)('cancels a waiting restart on %s without cancelling or repeating the send', async (action) => {
    const admission = Promise.withResolvers<SubmitOutcome>()
    const observed = Promise.withResolvers<undefined>()
    const sink = vi.fn(() => admission.promise)
    const input = new SessionInputShell({ actx: {} as Context, defaultSink: sink, commandImages: {
      serialize: async () => [], release: () => {}, unsupportedNotice: () => 'unsupported',
    } })
    const other = shell()
    const native = nativeBridge()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    let settled: Promise<unknown> | undefined
    try {
      await store.attachDraft('session:a', input)
      input.setDraft('send once')
      input.submit()
      input.setDraft('next unsent message')
      const isSettled = input.isRestartSettled.bind(input)
      vi.spyOn(input, 'isRestartSettled').mockImplementation(() => { observed.resolve(undefined); return isSettled() })
      const prepare = store.prepare()
      settled = prepare.then(() => {}, () => {})
      const rejected = expect(prepare).rejects.toThrow('cancelled')
      await observed.promise
      if (action === 'cancel') store.release()
      else if (action === 'detach') store.detachDraft('session:a')
      else await store.attachDraft('session:b', other)
      await rejected
      admission.resolve({ kind: 'success' })
      await vi.waitFor(() => { expect(input.isDraftSettled()).toBe(true) })
      expect(input.snapshot.draft).toBe('next unsent message')
      expect(input.editor.isEditable()).toBe(true)
      expect(sink).toHaveBeenCalledOnce()
    } finally {
      admission.resolve({ kind: 'success' }); store.release(); await settled
      store.dispose(); input.dispose(); other.dispose()
    }
  })

  it('waits for automatic project preparation before locking the unassigned draft', async () => {
    const preparation = Promise.withResolvers<undefined>()
    const source = new SessionInputShell({ actx: {} as Context, prepareSubmit: () => preparation.promise,
      defaultSink: vi.fn(), commandImages: { serialize: async () => [], release: () => {}, unsupportedNotice: () => 'unsupported' } })
    const native = nativeBridge()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    let settled: Promise<unknown> | undefined
    try {
      await store.attachDraft('unassigned', source)
      source.setDraft('project draft')
      source.submit()
      expect(source.isDraftSettled()).toBe(true)
      expect(source.isRestartSettled()).toBe(false)
      const prepare = store.prepare()
      settled = prepare.then(() => {}, () => {})
      preparation.resolve(undefined)
      await prepare
      expect(source.snapshot.draft).toBe('project draft')
      expect(source.editor.isEditable()).toBe(false)
    } finally { preparation.resolve(undefined); store.release(); await settled; store.dispose(); source.dispose() }
  })

  it.each([true, false])('does not let cancelled preparation settle or unlock a newer one (older failure: %s)', async (fails) => {
    const native = nativeBridge()
    const input = shell()
    const capture = vi.fn(async () => [])
    const store = new DraftPersistence(native.bridge, { capture, restore: async () => [] }, () => 'submission failed; restart cancelled')
    const firstEntered = Promise.withResolvers<undefined>()
    const firstCapture = Promise.withResolvers<never[]>()
    const secondEntered = Promise.withResolvers<undefined>()
    const secondCapture = Promise.withResolvers<never[]>()
    let currentSettled: Promise<void> | undefined
    try {
      await store.attachDraft('session:a', input)
      input.setDraft('keep locked until current save settles')
      await store.save()
      await store.save()
      capture.mockImplementationOnce(() => { firstEntered.resolve(undefined); return firstCapture.promise })
        .mockImplementationOnce(() => { secondEntered.resolve(undefined); return secondCapture.promise })
      const old = store.prepare()
      const oldRejected = expect(old).rejects.toThrow(fails ? 'old attachment failure' : 'cancelled')
      await firstEntered.promise
      store.release()
      const current = store.prepare()
      currentSettled = current.then(() => {}, () => {})
      if (fails) firstCapture.reject(new Error('old attachment failure'))
      else firstCapture.resolve([])
      await oldRejected
      await secondEntered.promise
      input.setDraft('must remain blocked')
      expect(input.snapshot.draft).toBe('keep locked until current save settles')
      await expect(store.prepare()).rejects.toThrow('already preparing')
      secondCapture.resolve([])
      expect(await current).toBe(native.read().revision)
    } finally {
      firstCapture.resolve([])
      secondCapture.resolve([])
      await currentSettled
      store.release()
      store.dispose()
      input.dispose()
    }
  })

  it('uses a durable identity during automatic preparation without releasing its editor lock', async () => {
    const native = nativeBridge()
    const target = shell()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    const finished = Promise.withResolvers<undefined>()
    const source = new SessionInputShell({
      actx: {} as Context, defaultSink: vi.fn(),
      prepareSubmit: async () => {
        const id = await store.prepareIdentity()
        expect(native.read().drafts.find(draft => draft.owner === 'unassigned')?.prepareId).toBe(id)
        expect(source.editor.isEditable()).toBe(false)
        await store.commitTransfer('target', () => { source.moveDraftTo(target) })
        expect(source.editor.isEditable()).toBe(false)
        finished.resolve(undefined)
      },
      commandImages: { serialize: async () => [], release: () => {}, unsupportedNotice: () => 'unsupported' },
    })
    try {
      await store.attachDraft('unassigned', source)
      await store.attachDraft('session:target', target)
      source.appendReference({ source: 'skill', ref: 'script', label: '中文编剧', clipboardText: '/script' })
      source.submit()
      await finished.promise
      await vi.waitFor(() => { expect(source.snapshot.phase).toBe('plain') })
      expect(target.snapshot.occurrences[0]?.label).toBe('中文编剧')
      expect(native.read().drafts.find(draft => draft.owner === 'unassigned')?.prepareId).toBeUndefined()
      await store.save()
    } finally { store.dispose(); source.dispose(); target.dispose() }
  })

  it.each(['cancelled', 'navigation changed'])('checks %s after a queued save and before publishing the transfer', async (message) => {
    const native = nativeBridge()
    const source = shell()
    const target = shell()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    try {
      await store.attachDraft('unassigned', source)
      await store.attachDraft('session:target', target)
      source.setDraft('retained source')
      await store.prepareIdentity()
      const saved = structuredClone(native.read())
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      // The actual save queue is held inside image capture; cancellation arrives while transfer awaits it.
      const captureSpy = vi.spyOn(images, 'capture').mockImplementationOnce(async () => {
        entered.resolve(undefined)
        await release.promise
        return []
      })
      const move = vi.fn(() => { source.moveDraftTo(target) })
      let cancelled = false
      const transfer = store.commitTransfer('target', move, () => { if (cancelled) throw new Error(message) })
      const rejected = expect(transfer).rejects.toThrow(message)
      try {
        await entered.promise
        cancelled = true
        release.resolve(undefined)
        await rejected
        expect(move).not.toHaveBeenCalled()
        expect(native.read().drafts).toEqual(saved.drafts)
        expect(source.snapshot.draft).toBe('retained source')
        expect(target.snapshot.draft).toBe('')
      } finally { release.resolve(undefined); captureSpy.mockRestore() }
    } finally { store.dispose(); source.dispose(); target.dispose() }
  })

  it('confirms an exact committed transfer after its save receipt is lost without writing it again', async () => {
    const native = nativeBridge()
    const source = shell()
    const target = shell()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    try {
      await store.attachDraft('unassigned', source)
      await store.attachDraft('session:target', target)
      source.setDraft('recover the exact transfer')
      await store.prepareIdentity()
      const save = vi.spyOn(native.bridge, 'save')
      const original = save.getMockImplementation()!
      save.mockClear()
      save.mockImplementationOnce(async (next) => {
        await original(next)
        throw new Error('receipt lost after publication')
      })
      const move = vi.fn(() => { source.moveDraftTo(target) })
      const result = await store.commitTransfer('target', move)
      expect(save).toHaveBeenCalledOnce()
      expect(move).toHaveBeenCalledOnce()
      expect(result.revision).toBe(native.read().revision)
      expect(target.snapshot.draft).toBe('recover the exact transfer')
    } finally { store.dispose(); source.dispose(); target.dispose() }
  })

  it('preserves full Skill references and occurrence identities across a new editor instance', () => {
    const original = shell()
    original.appendReference({ source: 'skill', ref: 'drama-write', label: '短剧编剧', clipboardText: '/drama-write' })
    const restored = shell()
    restored.restoreDraft(original.captureDraft())
    expect(restored.snapshot.draft).toBe(original.snapshot.draft)
    expect(restored.snapshot.occurrences).toEqual(original.snapshot.occurrences)
    expect(restored.captureDraft()).toEqual(original.captureDraft())
    expect(restored.captureDraft()).toMatchSnapshot()
    original.dispose(); restored.dispose()
  })
  it('rejects invalid reference counts without replacing current content', () => {
    const original = shell()
    original.appendReference({ source: 'skill', ref: 'skill-id', label: '技能', clipboardText: '/skill-id' })
    const restored = shell()
    expect(() =>{  restored.restoreDraft({ ...original.captureDraft(), occurrenceIds: [] }) }).toThrow('count')
    expect(restored.snapshot.draft).toBe('')
    original.dispose(); restored.dispose()
  })
  it('does not restore a detached composer after a pending native read completes', async () => {
    const native = nativeBridge()
    let resolveLoad!: (value: DraftCheckpoint) => void
    vi.spyOn(native.bridge, 'load').mockReturnValue(new Promise<DraftCheckpoint>((resolve) => { resolveLoad = resolve }))
    const input = shell()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    const attaching = store.attachDraft('session:a', input)
    const rejection = expect(attaching).rejects.toThrow('detached')
    store.detachDraft('session:a')
    resolveLoad({ format: 1, revision: 0, drafts: [] })
    await rejection
    input.setDraft('still editable')
    await store.save()
    expect(native.read().drafts).toEqual([])
    store.dispose(); input.dispose()
  })
  it('locks mutations through save and releases them when installation is deferred', async () => {
    const input = shell()
    const native = nativeBridge()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    await store.attachDraft('session:a', input)
    input.setDraft('用户草稿')
    const revision = await store.prepare()
    expect(native.read().revision).toBe(revision)
    input.setDraft('should not replace')
    expect(input.snapshot.draft).toBe('用户草稿')
    store.release()
    input.setDraft('继续编辑')
    expect(input.snapshot.draft).toBe('继续编辑')
    await store.save()
    store.dispose(); input.dispose()
  })
  it('restores from a new native instance without localStorage or an old renderer', async () => {
    const native = nativeBridge()
    const first = shell()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    await store.attachDraft('session:a', first)
    first.setDraft('port-independent draft')
    await store.save()
    store.dispose(); first.dispose()
    const second = shell()
    const reopened = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    await reopened.attachDraft('session:a', second)
    expect(second.snapshot.draft).toBe('port-independent draft')
    reopened.dispose(); second.dispose()
  })
  it('releases earlier locks if a later composer is submitting', async () => {
    const first = shell()
    const second = shell()
    const native = nativeBridge()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    await store.attachDraft('session:a', first)
    await store.attachDraft('session:b', second)
    vi.spyOn(second, 'lockDraft').mockImplementation(() => { throw new Error('submission pending') })
    await expect(store.prepare()).rejects.toThrow('submission pending')
    first.setDraft('still editable')
    expect(first.snapshot.draft).toBe('still editable')
    await store.save()
    store.dispose(); first.dispose(); second.dispose()
  })
  it('fails closed on a stale receipt and preserves editing after save failure', async () => {
    const native = nativeBridge()
    vi.spyOn(native.bridge, 'save').mockResolvedValue(-1)
    const input = shell()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    await store.attachDraft('unassigned', input)
    input.setDraft('kept')
    await expect(store.prepare()).rejects.toThrow('receipt')
    input.setDraft('kept and editable')
    expect(input.snapshot.draft).toBe('kept and editable')
    store.dispose(); input.dispose()
  })
  it('commits the preparation identity and both transfer owners together', async () => {
    const native = nativeBridge()
    const source = shell()
    const target = shell()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    await store.attachDraft('unassigned', source)
    await store.attachDraft('session:target', target)
    source.appendReference({ source: 'skill', ref: 'script', label: '编剧', clipboardText: '/script' })
    const identity = await store.prepareIdentity()
    expect(native.read().drafts.find(item => item.owner === 'unassigned')?.prepareId).toBe(identity)
    const document = source.captureDraft()
    const result = await store.commitTransfer('target', () => { target.restoreDraft(document); source.setDraft('') })
    expect(result.owner).toBe('session:target')
    expect(native.read().drafts.find(item => item.owner === 'session:target')?.editor).toBe(document.editor)
    expect(native.read().drafts.find(item => item.owner === 'unassigned')?.prepareId).toBeUndefined()
    expect(source.snapshot.draft).toBe('')
    expect(target.snapshot.occurrences[0]?.label).toBe('编剧')
    await store.save()
    store.dispose(); source.dispose(); target.dispose()
  })

  it('retains the committed destination if a memory transfer unexpectedly fails', async () => {
    const native = nativeBridge()
    const source = shell()
    const target = shell()
    const store = new DraftPersistence(native.bridge, images, () => 'submission failed; restart cancelled')
    await store.attachDraft('unassigned', source)
    await store.attachDraft('session:target', target)
    source.setDraft('must recover at destination')
    const document = source.captureDraft()
    await expect(store.commitTransfer('target', () => { throw new Error('memory fixture failure') })).rejects.toThrow('reload')
    await expect(store.save()).rejects.toThrow('Reload')
    expect(native.read().drafts.find(item => item.owner === 'session:target')?.editor).toBe(document.editor)
    store.dispose(); source.dispose(); target.dispose()
  })

})
