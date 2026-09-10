/** Host-only native-account records; secrets are never renderer or CLI response fields. */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'

/** Stable idempotency identity generated before any authorization request. */
export type NativeRequestId = Branded<'NativeRequestId'>
/** One desktop profile, independent of another installation on the same device. */
export type NativeDeviceId = Branded<'NativeDeviceId'>

/** Immutable material sealed by the OS before verifier-first provisioning. */
export interface NativeSecrets {
  readonly requestId: NativeRequestId
  readonly deviceInstanceId: NativeDeviceId
  readonly origin: string
  readonly environment: 'production' | 'test'
  readonly deviceName: string
  readonly platform: 'macos' | 'windows'
  readonly credential: string
  readonly state: string
  readonly codeVerifier: string
  readonly exchangeRequestId: NativeRequestId
  readonly redirectUri: string
  readonly code?: string | undefined
}

const secretsSchema = z.strictObject({
  requestId: z.uuid(), deviceInstanceId: z.uuid(), origin: z.url(),
  environment: z.enum(['production', 'test']), deviceName: z.string().min(1), platform: z.enum(['macos', 'windows']),
  credential: z.string().regex(/^mtd_v2_[A-Za-z0-9_-]{43}$/u),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  exchangeRequestId: z.uuid(), redirectUri: z.url(),
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/u).optional(),
})

/** Public, server-confirmed metadata; none of these fields authenticates a caller. */
export const nativeMetadataSchema = z.strictObject({
  attempt: z.strictObject({
    id: z.uuid(), expiresAt: z.number().int().positive(),
  }).optional(),
  exchangeStarted: z.literal(true).optional(),
  credential: z.strictObject({ id: z.uuid(), generation: z.number().int().positive(),
    accountId: z.uuid(), displayName: z.string(), policyKeyId: z.uuid(), expiresAt: z.number().int().positive() }).optional(),
})

/** Metadata retained with the original sealed authorization material. */
export type NativeMetadata = z.infer<typeof nativeMetadataSchema>

/** Both server receipts are required before a local record can authorize requests. */
export interface NativeActiveMetadata {
  readonly attempt: NonNullable<NativeMetadata['attempt']>
  readonly credential: NonNullable<NativeMetadata['credential']>
}

/**
 * Generate independent 32-byte secrets for an explicit native login attempt.
 * @param device - installation and configured deployment selected by the Host.
 * @returns unsaved material; no network request is authorized until its store commit succeeds.
 */
export function createNativeSecrets(device: Omit<NativeSecrets, 'requestId' | 'credential' | 'codeVerifier' | 'exchangeRequestId' | 'code'>): NativeSecrets {
  return { ...device, requestId: randomUUID() as NativeRequestId,
    credential: `mtd_v2_${randomBytes(32).toString('base64url')}`,
    codeVerifier: randomBytes(32).toString('base64url'), exchangeRequestId: randomUUID() as NativeRequestId }
}

/**
 * Hash a browser-account-v2 device secret, state or PKCE verifier.
 * @param secret - complete Host-generated UTF-8 value, including any prefix.
 * @returns SHA-256 as unpadded base64url, not the raw secret.
 */
export function nativeVerifier(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('base64url')
}

/**
 * Validate decrypted disk data without including secret input in an error.
 * @param text - plaintext returned by the OS decryptor.
 * @returns the validated Host-only material.
 */
export function parseNativeSecrets(text: string): NativeSecrets {
  try {
    const value = secretsSchema.parse(JSON.parse(text) as unknown)
    return { ...value, requestId: value.requestId as NativeRequestId, deviceInstanceId: value.deviceInstanceId as NativeDeviceId,
      exchangeRequestId: value.exchangeRequestId as NativeRequestId }
  } catch {
    // JSON and schema errors can quote secret input; only the fixed diagnostic may escape.
    throw new Error('Native account secret record is invalid')
  }
}
