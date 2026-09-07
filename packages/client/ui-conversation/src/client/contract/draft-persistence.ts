/** Desktop draft wire records; image bytes replace runtime-only object URLs. */
import type { DraftAttachmentId } from './input.ts'

/** Complete editor state and occurrence identities in document order. */
export interface DraftDocument {
  editor: string
  occurrenceIds: number[]
  nextOccurrenceId: number
  imageIds: readonly DraftAttachmentId[]
}

/** An image already selected by the user, encoded without filesystem access. */
export interface PersistedDraftImage {
  id: string
  name: string
  type: string
  lastModified: number
  data: string
  size: number
  sha256: string
}

/** One stable draft owner in the desktop application's data root. */
export interface PersistedDraft {
  owner: string
  editor: string
  occurrenceIds: number[]
  nextOccurrenceId: number
  images: PersistedDraftImage[]
  prepareId?: string
}

/** Atomic application-wide checkpoint; the revision covers source and destination of a transfer. */
export interface DraftCheckpoint {
  format: 1
  revision: number
  drafts: PersistedDraft[]
}

/** Restricted contextBridge capability implemented by the desktop carrier. */
export interface DesktopDraftBridge {
  load(): Promise<DraftCheckpoint>
  save(checkpoint: DraftCheckpoint): Promise<number>
  onPrepare(handler: () => Promise<number>): () => void
  onRelease(handler: () => void): () => void
}

declare global {
  interface Window {
    /** Present only inside the native, isolated desktop renderer. */
    manturDrafts?: DesktopDraftBridge
  }
}

/** Native-only preparation identity and atomic unassigned-draft transfer operations. */
export interface ConversationDraftPersistence {
  /** Persist a stable project preparation identity before the Host creates a project. */
  prepareIdentity(): Promise<string>
  /**
   * Persist both draft owners before a prevalidated synchronous memory move.
   * @param targetSessionId - Real destination Session id.
   * @param move - Synchronous, already-validated memory move.
   * @param beforeCommit - Final synchronous cancellation and navigation check before the native write.
   * @returns the committed owner and revision; a committed memory failure requires reload.
   */
  commitTransfer(targetSessionId: string, move: () => void, beforeCommit?: () => void): Promise<{ owner: string; revision: number }>
}
