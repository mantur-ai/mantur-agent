/** Complete editor restoration and exact-revision native draft checkpoints. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { DraftPersistence } from '../src/client/input/draft-persistence.ts'
import type { DesktopDraftBridge, DraftCheckpoint } from '../src/client/contract/draft-persistence.ts'

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
    const store = new DraftPersistence(native.bridge, images)
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
    const store = new DraftPersistence(native.bridge, images)
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
    const store = new DraftPersistence(native.bridge, images)
    await store.attachDraft('session:a', first)
    first.setDraft('port-independent draft')
    await store.save()
    store.dispose(); first.dispose()
    const second = shell()
    const reopened = new DraftPersistence(native.bridge, images)
    await reopened.attachDraft('session:a', second)
    expect(second.snapshot.draft).toBe('port-independent draft')
    reopened.dispose(); second.dispose()
  })
  it('releases earlier locks if a later composer is submitting', async () => {
    const first = shell()
    const second = shell()
    const native = nativeBridge()
    const store = new DraftPersistence(native.bridge, images)
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
    const store = new DraftPersistence(native.bridge, images)
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
    const store = new DraftPersistence(native.bridge, images)
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
    const store = new DraftPersistence(native.bridge, images)
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
