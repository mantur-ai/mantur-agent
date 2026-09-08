/** Request-bound Host save receipts; a child exit is never a substitute. */
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { updateSaveReply, type UpdateRequestId, type UpdateSessionCheckpoint } from '@deepseek-ai/dsh-mantur-app/update-protocol'

/** One explicit installation request to Main's owned Host. */
export interface UpdateSaveOptions {
  /** Main's exact running Host process. */
  child: ChildProcess
  /** Maximum wait for this receipt; expiration does not authorize installation or undo Host shutdown. */
  timeoutMs: number
  /** Cancels this installation wait; already-started Host cleanup continues. */
  signal?: AbortSignal
}

/**
 * Ask the owned Host to stop and save after the user confirms installation.
 * @param options - child identity, bounded wait, and optional installation cancellation.
 * @returns validated final session offsets for this request only.
 */
export function requestUpdateSave(options: UpdateSaveOptions): Promise<readonly UpdateSessionCheckpoint[]> {
  const { child, signal } = options
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 2_147_483_647) return Promise.reject(new Error('Invalid update save timeout'))
  if (signal?.aborted) return Promise.reject(new Error('Update installation cancelled', { cause: signal.reason }))
  if (!child.connected || child.exitCode !== null || child.signalCode !== null) return Promise.reject(new Error('Host is unavailable for update saving'))
  const id = randomUUID() as UpdateRequestId
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result: Error | readonly UpdateSessionCheckpoint[]): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('disconnect', onDisconnect)
      child.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const onMessage = (value: unknown): void => {
      const reply = updateSaveReply(value)
      if (!reply || reply.id !== id) return
      if (reply.ok) finish(reply.checkpoints)
      else finish(new Error(reply.error))
    }
    const onExit = (): void => { finish(new Error('Host exited without confirming saved work')) }
    const onDisconnect = (): void => { finish(new Error('Host disconnected without confirming saved work')) }
    const onError = (error: Error): void => { finish(error) }
    const onAbort = (): void => { finish(new Error('Update installation cancelled; Host cleanup may still be running')) }
    const timer = setTimeout(() => { finish(new Error('Host did not confirm saved work before the update deadline')) }, options.timeoutMs)
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('disconnect', onDisconnect)
    child.once('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      child.send({ type: 'mantur:update:prepare', id }, (error) => { if (error) finish(error) })
    } catch (error: unknown) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
