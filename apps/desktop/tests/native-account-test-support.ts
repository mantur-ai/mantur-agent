/** Real randomized test encryption substitutes only the unavailable native OS cipher, not SQLite or lifecycle code. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { vi } from 'vitest'

/** @returns one isolated authenticated cipher with observable asynchronous OS-interface calls. */
export function nativeTestCipher() {
  const key = randomBytes(32)
  return {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (text: string): Promise<Buffer> => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    }),
    decryptStringAsync: vi.fn(async (bytes: Buffer) => {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28))
      return { result: Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'), shouldReEncrypt: false }
    }),
  }
}
