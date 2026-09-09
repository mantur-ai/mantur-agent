/** Installation preparation keeps the account channel alive until the Host save receipt arrives. */

/** Native draft checkpoint and a parented, abortable cancellation dialog. */
export interface DraftSavePromptOptions {
  save(): Promise<unknown>
  cancel(): void
  show(signal: AbortSignal): Promise<void>
}

/**
 * Keep cancellation available until the draft receipt settles; close the dialog before continuing.
 * @param options - The exact draft request and its native waiting dialog.
 * @returns Only after the save succeeds and the dialog closes.
 */
export async function saveDraftsWithPrompt(options: DraftSavePromptOptions): Promise<void> {
  const closing = new AbortController()
  const save = options.save()
  const prompt = options.show(closing.signal).then(() => {
    if (!closing.signal.aborted) options.cancel()
  }, (error: unknown) => { options.cancel(); throw error })
  await Promise.all([save.finally(() => { closing.abort() }), prompt])
}

/** Existing draft, Host, and account owners used by the confirmed-install action. */
export interface PrepareUpdateOptions {
  /** Save and seal native composer drafts. */
  saveDrafts(): Promise<unknown>
  /** Release the draft seal when installation fails or is cancelled. */
  releaseDrafts(): void
  /** Stop Host work and validate this request's final saved-log receipt. */
  saveHost(): Promise<unknown>
  /** Close the native account only after Host command and body cleanup receipts arrived. */
  closeAccount(): Promise<void>
  /** Stop the saved Host and verify actual exit and diagnostic-log closure. */
  stopHost(): Promise<void>
  /** Whether normal quit or a cancelled install has superseded this attempt. */
  cancelled(): boolean
}

/**
 * Complete every required save before the updater receives permission to install.
 * @param options - the actual owners captured for this installation attempt.
 * @returns only after both durable save receipts and Host exit have completed.
 */
export async function prepareDesktopUpdate(options: PrepareUpdateOptions): Promise<void> {
  const check = (): void => { if (options.cancelled()) throw new Error('Update installation cancelled') }
  try {
    check()
    await options.saveDrafts()
    check()
    await options.saveHost()
    check()
    await options.closeAccount()
    await options.stopHost()
    check()
  } catch (error: unknown) {
    options.releaseDrafts()
    throw error
  }
}
