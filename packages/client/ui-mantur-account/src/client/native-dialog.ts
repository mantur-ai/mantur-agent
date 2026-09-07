/** One requested account dialog; authorization remains in the shared native client and Electron Main. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { NativeAccountAction } from '@deepseek-ai/dsh-authorization-manturhub/types'
import type { NativeAccountClient, NativeAccountOutcome } from './native-account.ts'

/** Completion of the requested view, not a credential or permission to repeat its caller's action. */
export type NativeAccountDialogOutcome = 'authenticated' | 'skipped' | 'closed'

type DialogState = { open: boolean }
type DialogActions = { setOpen: (state: DialogState, open: boolean) => void }
type BoundDialogActions = { setOpen: (open: boolean) => void }

/**
 * Keep only entry-owned visibility, without account or form inputs.
 * @returns a dialog visibility store factory.
 */
export function createNativeAccountDialogStore(): EngineStoreHandle<DialogState, DialogActions> {
  return defineStore({ init: (): DialogState => ({ open: false }),
    actions: { setOpen: (state, open: boolean) => { state.open = open } } })
}

/** Coalesce repeated openings and settle only the currently requested dialog. */
export class NativeAccountDialogController {
  private actions: BoundDialogActions | undefined
  private pending: (ReturnType<typeof Promise.withResolvers<NativeAccountDialogOutcome>> & { actions: BoundDialogActions }) | undefined

  /**
   * @param client - shared Main observer.
   * @param canOpen - whether another modal owns user interaction.
   */
  constructor(private readonly client: NativeAccountClient, private readonly canOpen: () => boolean) {}

  /**
   * Bind the currently registered overlay's visibility writer.
   * @param actions - framework-bound actions of the registered overlay.
   */
  attach(actions: BoundDialogActions): void { this.actions = actions }

  /**
   * Observe settled authentication from the shared native client.
   * @returns cleanup that removes the observer and rejects an unfinished request when its UI owner leaves.
   */
  connect(): () => void {
    const off = this.client.store.subscribe(() => {
      const state = this.client.store.getSnapshot()
      if (state.operation === undefined && state.snapshot?.busy === false && state.snapshot.authenticated) this.finish('authenticated')
    })
    return () => {
      off()
      const pending = this.pending
      this.pending = undefined
      this.actions = undefined
      pending?.reject(new Error('Native account dialog is unavailable'))
    }
  }

  /**
   * Request account interaction without replacing another active modal.
   * @returns the existing request or a new dialog result.
   */
  open(): Promise<NativeAccountDialogOutcome> {
    if (this.pending !== undefined) return this.pending.promise
    if (this.actions === undefined || !this.canOpen()) throw new Error('Native account dialog is unavailable')
    const state = this.client.store.getSnapshot()
    if (state.operation !== undefined || state.snapshot?.busy === true) throw new Error('Native account operation is already running')
    if (state.snapshot?.authenticated === true) return Promise.resolve('authenticated')
    this.pending = { ...Promise.withResolvers<NativeAccountDialogOutcome>(), actions: this.actions }
    this.actions.setOpen(true)
    return this.pending.promise
  }

  /** Dismiss only the requested view; Main keeps ownership of any accepted authorization operation. */
  close(): void { this.finish('closed') }

  /**
   * Submit through the existing native owner; a successful explicit Skip also dismisses this view.
   * @param action - guarded Main operation.
   * @returns the current operation's public form outcome.
   */
  async run(action: NativeAccountAction): Promise<NativeAccountOutcome> {
    const request = this.pending
    const result = await this.client.run(action)
    if (request === this.pending && result.ok && action.kind === 'skip') this.finish('skipped')
    return result
  }

  private finish(outcome: NativeAccountDialogOutcome): void {
    const pending = this.pending
    if (pending === undefined) return
    this.pending = undefined
    pending.actions.setOpen(false)
    pending.resolve(outcome)
  }
}
