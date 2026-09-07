/** Selected image bytes survive native serialization with stable metadata. */
import { describe, expect, it } from 'vitest'
import { saveDraftImage, restoreDraftImage } from '../src/client/input/draft-images.ts'
import type { DraftAttachmentId } from '../src/client/contract/input.ts'

const id = '00000000-0000-4000-8000-000000000001' as DraftAttachmentId
it('restores exact selected bytes and metadata without fetching a blob URL', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 255])
  const file = new File([bytes], '测试图片.png', { type: 'image/png', lastModified: 1234 })
  const saved = await saveDraftImage({ kind: 'image', id, file, previewUrl: 'blob:test-only-never-fetched' })
  expect(saved.id).toBe(id)
  expect(saved.data).not.toContain('blob:')
  const restored = await restoreDraftImage(saved)
  expect(restored.name).toBe(file.name)
  expect(restored.type).toBe(file.type)
  expect(restored.lastModified).toBe(file.lastModified)
  expect(new Uint8Array(await restored.arrayBuffer())).toEqual(bytes)
})
describe('attachment integrity', () => {
  it('rejects a missing or modified attachment', async () => {
    const saved = await saveDraftImage({ kind: 'image', id, file: new File(['fixture'], 'a.png', { type: 'image/png' }), previewUrl: 'blob:unused' })
    await expect(restoreDraftImage({ ...saved, data: '' })).rejects.toThrow('checksum')
    await expect(restoreDraftImage({ ...saved, sha256: '0'.repeat(64) })).rejects.toThrow('checksum')
  })
})
