/** Retained Google artwork must match the recorded original trademark asset. */
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { googleLogo } from '../src/client/google-logo.ts'

it('retains the recorded Google PNG without an artwork modification', () => {
  expect(googleLogo.startsWith('data:image/png;base64,')).toBe(true)
  const bytes = Buffer.from(googleLogo.slice('data:image/png;base64,'.length), 'base64')
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('d1ce9c2af0b10a7333abc99bc706f9a6a199e5b65bf3e3009624f076b8638e6a')
})
