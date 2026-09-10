/** Client-safe ManturHub account and device-login types. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Named ManturHub deployment selected for every online Mantur request. */
export type ManturEnvironment = 'production' | 'test'

/** Explicit identity owner selected by the application profile, never an automatic fallback. */
export type ManturIdentityMode = 'standalone' | 'desktop-managed'

/** Opaque identity for one process-local ManturHub device-login attempt. */
export type ManturLoginAttemptId = Branded<'ManturLoginAttemptId'>

/** Account fields safe to show in the Mantur client. */
export type ManturAccount = { readonly email: string } | { readonly displayName: string }

/** Current durable ManturHub account state. */
export type ManturAccountStatus =
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly account: ManturAccount }

/** Browser-safe instructions for one device-login attempt. */
export interface ManturLoginStart {
  readonly attemptId: ManturLoginAttemptId
  readonly verificationUrl: string
  readonly userCode: string
  readonly expiresAt: number
}

/** Current process-local outcome of one device-login attempt. */
export type ManturLoginProgress =
  | { readonly status: 'pending' }
  | { readonly status: 'authorized'; readonly account: ManturAccount }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed' }

/** Public native-account failure classification; arbitrary provider text is never transported. */
export interface NativeAccountProblem {
  readonly kind: string
  readonly code?: string | undefined
  readonly retryAfterMs?: number | undefined
}

/** Main-owned native account metadata, excluding device credentials and registration inputs. */
export interface NativeAccountSnapshot {
  readonly phase: 'idle' | 'signed-out' | 'authorizing' | 'signed-in' | 'pending-activation' | 'link-required' | 'failed'
  readonly busy: boolean
  /** Locally active and unexpired; an offline validation failure does not erase this fact. */
  readonly authenticated: boolean
  readonly skipped: boolean
  readonly pendingRevocations: number
  readonly account?: { readonly displayName: string; readonly expiresAt: number } | undefined
  readonly attempt?: { readonly expiresAt: number; readonly exchangePending?: true | undefined } | undefined
  readonly failure?: NativeAccountProblem | undefined
}

/** Fixed browser-account operations; no credential, URL or account form input crosses preload. */
export type NativeAccountAction = {
  readonly kind: 'snapshot' | 'refresh' | 'browser' | 'reopen-browser' | 'skip' | 'sign-out' | 'switch-account' | 'retry-revocations'
}

/** Revision orders both command replies and unsolicited Main publications. */
export interface NativeAccountPublication {
  readonly revision: number
  readonly snapshot: NativeAccountSnapshot
}

/** A command result never contains the credential returned by a server. */
export interface NativeAccountReply {
  readonly ok: boolean
  readonly revision: number
  readonly snapshot?: NativeAccountSnapshot | undefined
  readonly failure?: NativeAccountProblem | undefined
}

/** Browser capability exposed by the sandboxed preload; received IPC values require decoding. */
export interface NativeAccountBridge {
  /** @param action - fixed account operation. @returns an untrusted IPC reply. */
  invoke(action: NativeAccountAction): Promise<unknown>
  /** @param listener - receives untrusted Main publications. @returns removal of this listener. */
  subscribe(listener: (publication: unknown) => void): () => void
}
