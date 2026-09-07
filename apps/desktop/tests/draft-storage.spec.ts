/** Real isolated file persistence, revision conflicts, and attachment integrity. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopDraftStorage, parseDraftCheckpoint, type DraftCheckpoint } from '../src/draft-storage.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-drafts-test-'))
  roots.push(root)
  return { root, store: new DesktopDraftStorage(root) }
}
function checkpoint(revision = 1): DraftCheckpoint {
  const bytes = Buffer.from('isolated test attachment')
  return { format: 1, revision, drafts: [{ owner: 'unassigned', editor: '{"root":{"children":[]}}', occurrenceIds: [], nextOccurrenceId: 0,
    prepareId: '00000000-0000-4000-8000-000000000001', images: [{ id: '00000000-0000-4000-8000-000000000002', name: '测试.png', type: 'image/png', lastModified: 1,
      size: bytes.length, data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }] }] }
}
describe.runIf(process.platform !== 'win32')('desktop draft checkpoint', () => {
  it('restores independently of a renderer or loopback origin and keeps private file permissions', async () => {
    const { root, store } = await setup()
    expect(await store.read()).toEqual({ format: 1, revision: 0, drafts: [] })
    expect(await store.save(checkpoint())).toBe(1)
    expect(await new DesktopDraftStorage(root).read()).toEqual(checkpoint())
    expect(JSON.parse(await readFile(join(root, 'drafts/checkpoint.json'), 'utf8'))).toEqual(checkpoint())
    if (process.platform !== 'win32') {
      expect((await stat(join(root, 'drafts/checkpoint.json'))).mode & 0o777).toBe(0o600)
      expect((await stat(join(root, 'drafts'))).mode & 0o777).toBe(0o700)
    }
  })
  it('commits both transfer owners together and rejects a stale concurrent revision', async () => {
    const { store } = await setup()
    const results = await Promise.allSettled([store.save(checkpoint()), store.save(checkpoint())])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    const moved = checkpoint(2)
    moved.drafts[0]!.owner = 'session:test-session'
    delete moved.drafts[0]!.prepareId
    moved.drafts.push({ owner: 'unassigned', editor: '{"root":{"children":[]}}', occurrenceIds: [], nextOccurrenceId: 0, images: [] })
    await store.save(moved)
    expect(await store.read()).toEqual(moved)
  })
  it('rejects incomplete attachment bytes and preserves the committed version', async () => {
    const { store } = await setup()
    await store.save(checkpoint())
    const broken = checkpoint(2)
    broken.drafts[0]!.images[0]!.data = ''
    expect(() => store.save(broken)).toThrow('checksum')
    expect(await store.read()).toEqual(checkpoint())
  })
  it('does not replace corrupt saved data with an empty checkpoint', async () => {
    const { root, store } = await setup()
    await store.save(checkpoint())
    await writeFile(join(root, 'drafts/checkpoint.json'), '{broken')
    await expect(store.read()).rejects.toThrow()
    await expect(store.save(checkpoint(2))).rejects.toThrow()
  })
  it.each([null, { format: 2 }, { ...checkpoint(), revision: -1 }, { ...checkpoint(), drafts: [...checkpoint().drafts, ...checkpoint().drafts] }])('rejects malformed input %j', (value) => {
    expect(() => parseDraftCheckpoint(value)).toThrow()
  })
})

it.runIf(process.platform === 'win32')('refuses to claim Windows durability without native write-through publication', async () => {
  const { store } = await setup()
  expect(() => store.save(checkpoint())).toThrow('Windows')
})
