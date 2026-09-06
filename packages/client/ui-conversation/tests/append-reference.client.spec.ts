import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { DraftAttachmentId, InputTriggerController } from '../src/client/contract/input.ts'

const shells: SessionInputShell[] = []
afterEach(() => { for (const shell of shells.splice(0)) shell.dispose() })

function bench() {
  const sink = vi.fn()
  const shell = new SessionInputShell({
    actx: {} as Context,
    defaultSink: sink,
    commandImages: { serialize: () => Promise.resolve([]), release: () => {}, unsupportedNotice: () => 'unsupported' },
  })
  shells.push(shell)
  return { shell, sink }
}

const skill = { source: 'skill', ref: 'short-drama', label: '爽文短剧剧本创作', clipboardText: '/short-drama' }

describe('composer shortcut references', () => {
  it('appends after text and earlier chips without replacing the draft, attachments, or sending', () => {
    const { shell, sink } = bench()
    shell.setDraft('继续这个故事 ')
    shell.addImages(['reference-image' as DraftAttachmentId])
    expect(shell.appendReference(skill)).toBe(true)
    expect(shell.appendReference({ source: 'skill', ref: 'character-forge', label: '角色锻造师', clipboardText: '/character-forge' })).toBe(true)
    expect(shell.snapshot).toMatchObject({
      draft: '继续这个故事 /short-drama /character-forge ',
      imageIds: ['reference-image'],
      occurrences: [{ source: 'skill', ref: 'short-drama', label: skill.label }, { source: 'skill', ref: 'character-forge' }],
    })
    expect(sink).not.toHaveBeenCalled()
  })

  it('does not duplicate the same source/ref even when its label changed', () => {
    const { shell, sink } = bench()
    shell.appendReference(skill)
    const draft = shell.snapshot.draft
    expect(shell.appendReference({ ...skill, label: '新的标题' })).toBe(true)
    expect(shell.snapshot.draft).toBe(draft)
    expect(shell.snapshot.occurrences).toHaveLength(1)
    expect(sink).not.toHaveBeenCalled()
  })

  it('refuses an insertion while a command is awaiting admission', async () => {
    let settle!: () => void
    const controller = {
      adjudicate: () => new Promise<undefined>((resolve) => {
        settle = () => { resolve(undefined) }
      }),
      track: vi.fn(),
      lexicon: { getSnapshot: () => new Map(), subscribe: () => () => {} },
    } as unknown as InputTriggerController
    const shell = new SessionInputShell({
      actx: {} as Context, defaultSink: vi.fn(() => Promise.resolve({ kind: 'success' as const })), inputTriggers: () => controller,
      commandImages: { serialize: () => Promise.resolve([]), release: () => {}, unsupportedNotice: () => 'unsupported' },
    })
    shells.push(shell)
    shell.setDraft('/pending')
    shell.submit()
    expect(shell.appendReference(skill)).toBe(false)
    settle()
    await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
  })
})
