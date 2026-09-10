/** Main/Host update-save messages carried only by their inherited child IPC channel. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one Main installation attempt; never reused for a later request. */
export type UpdateRequestId = Branded<'UpdateRequestId'>
/** Final exclusive event offset after a session writer closed. */
export interface UpdateSessionCheckpoint { readonly sessionId: Branded<'SessionId'>; readonly nextSeq: number }
/** Main asks its exact child to save before installation. */
export interface UpdateSaveRequest { readonly type: 'mantur:update:prepare'; readonly id: UpdateRequestId }
/** Host reports only after all owned shutdown operations and a fresh writer check. */
export type UpdateSaveReply =
  | { readonly type: 'mantur:update:prepared'; readonly id: UpdateRequestId; readonly ok: true; readonly checkpoints: readonly UpdateSessionCheckpoint[] }
  | { readonly type: 'mantur:update:prepared'; readonly id: UpdateRequestId; readonly ok: false; readonly error: string }

/**
 * Validate an IPC installation request without interpreting unrelated account messages.
 * @param value - message received from the parent process.
 * @returns a validated request, or undefined for an unrelated/invalid message.
 */
export function updateSaveRequest(value: unknown): UpdateSaveRequest | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.type !== 'mantur:update:prepare' || typeof record.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.id)) return undefined
  return { type: 'mantur:update:prepare', id: record.id as UpdateRequestId }
}

/**
 * Validate the reply fields before Main can accept a saved-work receipt.
 * @param value - message received from Main's exact child.
 * @returns a validated reply, or undefined for an unrelated/invalid message.
 */
export function updateSaveReply(value: unknown): UpdateSaveReply | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.type !== 'mantur:update:prepared' || typeof record.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.id)) return undefined
  const id = record.id as UpdateRequestId
  if (record.ok === false && typeof record.error === 'string') return { type: 'mantur:update:prepared', id, ok: false, error: record.error }
  if (record.ok !== true || !Array.isArray(record.checkpoints)) return undefined
  const checkpoints: UpdateSessionCheckpoint[] = []
  const seen = new Set<string>()
  for (const value of record.checkpoints as unknown[]) {
    if (!value || typeof value !== 'object') return undefined
    const checkpoint = value as Record<string, unknown>
    if (typeof checkpoint.sessionId !== 'string' || !checkpoint.sessionId || seen.has(checkpoint.sessionId)
      || typeof checkpoint.nextSeq !== 'number' || !Number.isSafeInteger(checkpoint.nextSeq) || checkpoint.nextSeq < 0) return undefined
    seen.add(checkpoint.sessionId)
    checkpoints.push({ sessionId: checkpoint.sessionId as Branded<'SessionId'>, nextSeq: checkpoint.nextSeq })
  }
  return { type: 'mantur:update:prepared', id, ok: true, checkpoints }
}
