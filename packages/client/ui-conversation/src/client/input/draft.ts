/** Resident unassigned editor and its handoff to the ordinary Session submit path. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { ConversationDraftPreparation, ConversationDrafts } from '../contract/draft.ts'
import type { DraftAttachmentId } from '../contract/input.ts'
import type { InputHub } from './hub.ts'
import { SessionInputShell } from './facade.ts'

/** Owns no Host entity until its registered preparation returns a real Session. */
export class ConversationDraftController extends Service implements ConversationDrafts {
  readonly enabled = createSnapshotStore(false)
  readonly input: SessionInputShell
  private readonly live: { preparation?: ConversationDraftPreparation; ready: boolean } = { ready: false }
  private readonly ready: Promise<void>

  /**
   * @param ctx - Client owner.
   * @param sessions - real Session controller.
   * @param hub - real Session editors.
   * @param releaseImages - browser attachment cleanup.
   * @param t - localized draft preparation and restoration notices.
   */
  constructor(
    ctx: Context,
    sessions: ISessions,
    private readonly hub: InputHub,
    releaseImages: (ids: readonly DraftAttachmentId[]) => void,
    private readonly t: TranslateNS<'conversation'>,
  ) {
    super(ctx, 'conversationDrafts')
    this.input = new SessionInputShell({
      actx: ctx,
      defaultSink: () => { throw new Error('Unassigned drafts require Session preparation before sending.') },
      prepareSubmit: async (mode, signal) => {
        const preparation = this.live.preparation
        if (preparation === undefined) throw new Error(this.t('draft.prepareUnavailable'))
        const sessionId = await preparation.prepare(signal)
        const validate = () => {
          signal.throwIfAborted()
          if (this.live.preparation !== preparation) throw new Error(this.t('draft.policyChanged'))
          if (sessions.list.getSnapshot().current !== undefined) throw new Error(this.t('draft.selectionChanged'))
        }
        await this.transfer(sessionId, validate)
        const target = this.hub.shell(sessionId)
        if (signal.aborted || this.live.preparation !== preparation || sessions.list.getSnapshot().current !== undefined) {
          this.input.notify('info', this.t('draft.transferredUnsent'))
          target.notify('info', this.t('draft.transferredUnsent'))
          return
        }
        sessions.open(sessionId)
        target.submit(mode)
      },
      commandImages: {
        serialize: () => { throw new Error('Commands require a real Session.') },
        release: releaseImages,
        unsupportedNotice: token => `Command ${token} requires a real Session.`,
      },
    })
    if (hub.persistence === undefined) {
      this.live.ready = true
      this.ready = Promise.resolve()
    } else {
      this.ready = hub.persistence.attachDraft('unassigned', this.input)
      void this.ready.then(() => {
        this.live.ready = true
        this.enabled.set(this.live.preparation !== undefined)
      }, (error: unknown) => { this.input.notify('error', this.t('draft.saveFailed', { detail: String(error) })) })
    }
    ctx.effect(() => () => {
      hub.persistence?.detachDraft('unassigned')
      releaseImages(this.input.dispose())
    }, 'conversation: unassigned draft')
    ctx.effect(() => sessions.list.subscribe(() => {
      if (sessions.list.getSnapshot().current !== undefined) this.input.cancelPreparation()
    }), 'conversation: cancel unassigned preparation on navigation')
  }

  register(preparation: ConversationDraftPreparation): () => void {
    if (this.live.preparation !== undefined) throw new Error('Only one unassigned-draft creation policy may be registered.')
    this.live.preparation = preparation
    this.enabled.set(this.live.ready)
    return () => {
      this.input.cancelPreparation()
      delete this.live.preparation
      this.enabled.set(false)
    }
  }

  /**
   * Move an unassigned draft into a manually selected Workspace's empty Session.
   * @param sessionId - destination Session whose native draft must finish restoring.
   */
  async moveTo(sessionId: SessionId): Promise<void> {
    if (this.input.snapshot.phase !== 'plain') throw new Error(this.t('draft.preparing'))
    await this.transfer(sessionId, () => {
      if (!this.input.isDraftSettled()) throw new Error(this.t('draft.preparing'))
    })
  }

  private async transfer(sessionId: SessionId, validate: () => void): Promise<void> {
    await this.ready
    await this.hub.waitForDraft(sessionId)
    validate()
    const target = this.hub.shell(sessionId)
    const move = () => { this.input.moveDraftTo(target) }
    if (this.hub.persistence === undefined) move()
    else await this.hub.persistence.commitTransfer(sessionId, move, validate)
  }
}
