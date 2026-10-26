// @vitest-environment jsdom
/** Marketplace insertion through the real editor and native draft restoration lock. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ManturMarketplaceStore } from '../src/client/store.ts'
import { InputHub } from '../../ui-conversation/src/client/input/hub.ts'
import { ConversationDraftController } from '../../ui-conversation/src/client/input/draft.ts'
import { SessionInputShell } from '../../ui-conversation/src/client/input/facade.ts'
import { DraftPersistence } from '../../ui-conversation/src/client/input/draft-persistence.ts'
import { ConversationController } from '../../ui-conversation/src/client/service.ts'
import { ComposerBlockRegistry } from '../../ui-conversation/src/client/input/blocks.ts'
import { zh } from '../../ui-conversation/src/client/locales.ts'
import type { DraftCheckpoint } from '../../ui-conversation/src/client/contract/draft-persistence.ts'
import type { DraftAttachmentId } from '../../ui-conversation/src/client/contract/input.ts'

const SESSION = 'current-draft' as SessionId
const reference = { source: 'skill', ref: 'new-skill', label: '新技能', clipboardText: '/new-skill' }

async function bench(selected: boolean) {
  const runtime = await SlotTestRuntime.create()
  const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  await runtime.sessions.add({ id: SESSION, session: { prompt } }, { current: selected })
  const loaded = Promise.withResolvers<DraftCheckpoint>()
  const save = vi.fn(async (checkpoint: DraftCheckpoint) => checkpoint.revision)
  const t = makeTranslate(zh, {})
  const hub = new InputHub(runtime.ctx, t)
  const imageIds = ['reference.png'] as DraftAttachmentId[]
  const persistence = new DraftPersistence({ load: () => loaded.promise, save,
    onPrepare: () => () => {}, onRelease: () => () => {},
  }, { capture: async () => [], restore: async () => imageIds }, () => 'submission failed')
  hub.persistence = persistence
  await runtime.ctx.plugin(ConversationController, { input: hub, blocks: new ComposerBlockRegistry() }).await()
  const drafts = new ConversationDraftController(runtime.ctx, runtime.ctx.sessions, hub, () => {}, t)
  drafts.register({ prepare: async () => { throw new Error('Use must not prepare a Session') } })
  const input = selected ? hub.shell(SESSION) : drafts.input
  const seed = new SessionInputShell({ actx: {} as Context, defaultSink: vi.fn(), commandImages: {
    serialize: async () => [], release: () => {}, unsupportedNotice: () => 'unsupported',
  } })
  seed.setDraft('RC3-DRAFT-20261026 ')
  for (const ref of ['script', 'drama', 'assets']) seed.appendReference({ source: 'skill', ref, label: ref, clipboardText: `/${ref}` })
  const document = seed.captureDraft()
  seed.dispose()
  const checkpoint: DraftCheckpoint = { format: 1, revision: 4, drafts: [{
    owner: selected ? `session:${SESSION}` : 'unassigned',
    editor: document.editor, occurrenceIds: document.occurrenceIds, nextOccurrenceId: document.nextOccurrenceId, images: [],
  }] }
  const store = new ManturMarketplaceStore(runtime.ctx)
  store.store.set({ phase: 'ready', catalog: { installedCount: 1, signedIn: true, skills: [{
    slug: reference.ref, name: reference.label, description: '', category: '', version: '1', triggers: [], installed: true,
  }] } })
  const close = async () => {
    loaded.resolve(checkpoint)
    persistence.dispose()
    await runtime.dispose()
  }
  return { runtime, store, input, prompt, loaded, checkpoint, save, close }
}

describe('Skill draft restoration', () => {
  it.each([true, false])('retains the full native draft and adds one reference on the first click (selected=%s)', async (selected) => {
    const b = await bench(selected)
    try {
      // The pre-fix synchronous insertion fails while attachDraft owns the native restore lock.
      expect(b.input.appendReference(reference)).toBe(false)
      const pending = b.store.startSkill(reference.ref)
      expect(b.store.store.getSnapshot()).toMatchObject({ using: reference.ref, useError: undefined })
      b.loaded.resolve(b.checkpoint)
      await expect(pending).resolves.toBe(true)
      await expect(b.store.startSkill(reference.ref)).resolves.toBe(true)
      expect({ text: b.input.snapshot.draft, references: b.input.snapshot.occurrences.map(item => item.ref), images: b.input.snapshot.imageIds }).toMatchInlineSnapshot(`
        {
          "images": [
            "reference.png",
          ],
          "references": [
            "script",
            "drama",
            "assets",
            "new-skill",
          ],
          "text": "RC3-DRAFT-20261026 /script /drama /assets /new-skill ",
        }
      `)
      expect(b.runtime.ctx.sessions.list.getSnapshot().current).toBe(selected ? SESSION : undefined)
      expect(b.prompt).not.toHaveBeenCalled()
    } finally { await b.close() }
  })

  it.each([true, false])('does not insert or save over an unreadable native checkpoint (selected=%s)', async (selected) => {
    const b = await bench(selected)
    try {
      const pending = b.store.startSkill(reference.ref)
      b.loaded.reject(new Error('checkpoint unavailable'))
      await expect(pending).resolves.toBe(false)
      expect(b.input.snapshot.occurrences).toEqual([])
      expect(b.store.store.getSnapshot()).toMatchObject({ using: undefined, useError: 'failed' })
      expect(b.runtime.ctx.sessions.list.getSnapshot().current).toBe(selected ? SESSION : undefined)
      expect(b.save).not.toHaveBeenCalled()
      expect(b.prompt).not.toHaveBeenCalled()
    } finally { await b.close() }
  })
})
