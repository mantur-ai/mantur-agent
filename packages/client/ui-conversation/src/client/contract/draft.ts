/** Optional Session preparation for a browser-owned, unassigned conversation draft. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionInput } from './input.ts'

/** Feature-owned creation policy, invoked only after a non-empty Send gesture. */
export interface ConversationDraftPreparation {
  /**
   * Create or recover the same Session after partial failure; never send a message.
   * @param signal - cancellation of subsequent creation steps for this draft.
   * @returns the real Session that can receive the draft.
   */
  prepare(signal: AbortSignal): Promise<SessionId>
}

/** Unassigned input extension; registration alone creates no Host directory or Session. */
export interface ConversationDrafts {
  /** Whether a creation policy currently accepts an unassigned draft. */
  readonly enabled: ObservableSnapshot<boolean>
  /** Browser-owned editor and attachments; not a fabricated Session. */
  readonly input: SessionInput
  /**
   * Install the sole Session creation policy.
   * @param preparation - feature-owned Session creation policy.
   * @returns disposer which disables drafting and cancels pending preparation.
   */
  register(preparation: ConversationDraftPreparation): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional creation policy over a resident browser-only conversation draft. */
    conversationDrafts: ConversationDrafts
  }
}
