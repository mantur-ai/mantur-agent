/** Serialize only browser-selected images; never fetch preview URLs or read arbitrary paths. */
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import type { PersistedDraftImage } from '../contract/draft-persistence.ts'
import type { ComposerAttachment } from '../contract/slots.ts'

/**
 * Encode a selected image with its stable id and digest for private desktop storage.
 * @param attachment - Selected browser image and stable id.
 * @returns - The original file bytes, metadata, and digest.
 */
export async function saveDraftImage(attachment: ComposerAttachment): Promise<PersistedDraftImage> {
  const bytes = new Uint8Array(await attachment.file.arrayBuffer())
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return { id: attachment.id, name: attachment.file.name, type: attachment.file.type,
    lastModified: attachment.file.lastModified, data: bytesToBase64(bytes), size: bytes.length,
    sha256: Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') }
}

/**
 * Reconstruct a File only after checking its exact bytes against the recorded digest and size.
 * @param image - Saved image bytes and metadata.
 * @returns - A verified browser File.
 */
export async function restoreDraftImage(image: PersistedDraftImage): Promise<File> {
  const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  if (bytes.length !== image.size || Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') !== image.sha256) {
    throw new Error('Saved draft image checksum mismatch')
  }
  return new File([bytes], image.name, { type: image.type, lastModified: image.lastModified })
}
