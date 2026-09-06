/** Client-safe ManturHub account and device-login types. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Named ManturHub deployment selected for every online Mantur request. */
export type ManturEnvironment = 'production' | 'test'

/** Explicit identity owner selected by the application profile, never an automatic fallback. */
export type ManturIdentityMode = 'standalone' | 'desktop-managed'

/** Opaque identity for one process-local ManturHub device-login attempt. */
export type ManturLoginAttemptId = Branded<'ManturLoginAttemptId'>

/** Account fields safe to show in the Mantur client. */
export interface ManturAccount {
  readonly email: string
}

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
