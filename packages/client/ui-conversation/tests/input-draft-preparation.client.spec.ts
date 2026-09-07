/** Session preparation preserves the complete draft until a successful handoff. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DraftAttachmentId } from '../src/client/contract/input.ts'
import { SessionInputShell, type SessionInputDeps } from '../src/client/input/facade.ts'

const shells: SessionInputShell[] = []
afterEach(() => { for (const shell of shells.splice(0)) shell.dispose() })

function input(prepareSubmit?: SessionInputDeps['prepareSubmit']): SessionInputShell {
  const shell = new SessionInputShell({
    actx: {} as Context,
    defaultSink: vi.fn(),
    ...(prepareSubmit === undefined ? {} : { prepareSubmit }),
    commandImages: {
      serialize: async () => [], release: () => {}, unsupportedNotice: token => token,
    },
  })
  shells.push(shell)
  return shell
}

describe('draft Session preparation', () => {
  it.each(['storage', 'preparation'] as const)('keeps editing locked until both locks release, with %s released first', async (first) => {
    const pending = Promise.withResolvers<undefined>()
    const source = input(() => pending.promise)
    source.setDraft('locked draft')
    source.submit()
    const unlock = source.lockDraft()
    if (first === 'storage') unlock()
    else source.cancelPreparation()
    expect(source.editor.isEditable()).toBe(false)
    expect(source.snapshot.phase).toBe('adjudicating')
    source.setDraft('must not replace')
    expect(source.snapshot.draft).toBe('locked draft')
    if (first === 'storage') source.cancelPreparation()
    else unlock()
    expect(source.editor.isEditable()).toBe(true)
    expect(source.snapshot.phase).toBe('plain')
    pending.resolve(undefined)
    await pending.promise
  })

  it('retains both composers when the final transfer precondition fails', () => {
    const source = input()
    const target = input()
    source.setDraft('unsent')
    source.addImages(['image-one' as DraftAttachmentId])
    expect(() => { source.moveDraftTo(target, () => { throw new Error('retirement failed') }) }).toThrow('retirement failed')
    expect(source.snapshot).toMatchObject({ draft: 'unsent', imageIds: ['image-one'] })
    expect(target.snapshot).toMatchObject({ draft: '', imageIds: [] })
  })

  it('transfers an image-only draft without installing an empty editor state', async () => {
    const target = input()
    const source = input(async () => { source.moveDraftTo(target) })
    source.addImages(['image-only' as DraftAttachmentId])
    source.submit()
    await vi.waitFor(() => { expect(source.snapshot.phase).toBe('plain') })
    expect(source.notices.getSnapshot()).toBeNull()
    expect(source.snapshot).toMatchObject({ draft: '', imageIds: [] })
    expect(target.snapshot).toMatchObject({ draft: '', imageIds: ['image-only'], occurrences: [] })
  })

  it('does not prepare whitespace and shares one pending send while preserving references and images', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const target = input()
    const prepare = vi.fn(async () => { await pending; source.moveDraftTo(target) })
    const source = input(prepare)
    source.setDraft('  ')
    source.submit()
    expect(prepare).not.toHaveBeenCalled()
    source.setDraft('请制作 ')
    source.appendReference({ source: 'skill', ref: 'drama', label: '漫剧制作', clipboardText: '/drama' })
    source.addImages(['image-one' as DraftAttachmentId])
    const original = source.snapshot
    source.submit()
    source.submit()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(source.snapshot).toMatchObject({ ...original, phase: 'adjudicating' })
    expect(source.appendReference({ source: 'skill', ref: 'other', label: '其他', clipboardText: '/other' })).toBe(false)
    source.setDraft('replacement')
    source.paste('replacement')
    expect(source.snapshot.draft).toBe(original.draft)
    finish()
    await vi.waitFor(() => { expect(source.snapshot.phase).toBe('plain') })
    expect(target.snapshot).toMatchObject({
      draft: original.draft, occurrences: original.occurrences, imageIds: original.imageIds,
    })
    expect(source.snapshot).toMatchObject({ draft: '', imageIds: [], occurrences: [] })
    target.setDraft('changed destination')
    expect(source.snapshot.draft).toBe('')
  })

  it('keeps a rejected preparation editable and permits a retry', async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new Error('directory denied')).mockResolvedValueOnce(undefined)
    const source = input(prepare)
    source.setDraft('original')
    source.addImages(['image-one' as DraftAttachmentId])
    source.submit()
    await vi.waitFor(() => { expect(source.notices.getSnapshot()?.text).toBe('directory denied') })
    expect(source.snapshot).toMatchObject({ draft: 'original', imageIds: ['image-one'], phase: 'plain' })
    source.submit()
    await vi.waitFor(() => { expect(prepare).toHaveBeenCalledTimes(2) })
  })

  it('refuses to overwrite a destination draft', async () => {
    const target = input()
    target.setDraft('existing')
    const source = input(async () => { source.moveDraftTo(target) })
    source.setDraft('unsent')
    source.submit()
    await vi.waitFor(() => { expect(source.notices.getSnapshot()?.level).toBe('error') })
    expect(source.snapshot.draft).toBe('unsent')
    expect(target.snapshot.draft).toBe('existing')
  })

  it('cancels preparation on disposal without publishing a late failure', async () => {
    let reject!: (error: Error) => void
    let signal!: AbortSignal
    const pending = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise })
    const source = input((_mode, activeSignal) => { signal = activeSignal; return pending })
    source.setDraft('unsent')
    source.submit()
    source.dispose()
    expect(signal.aborted).toBe(true)
    reject(new Error('late failure'))
    await pending.catch(() => {})
    expect(source.notices.getSnapshot()).toBeNull()
  })
})
