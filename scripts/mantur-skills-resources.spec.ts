/** Offline resource preparation against the four audited, checked-in Skill archives. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { prepareBundledSkills } from './mantur-skills-resources.ts'
import { loadBundledSkill, readBundledCatalog } from '../packages/skill/manturhub-marketplace/src/bundled-catalog.ts'

const sourceFile = fileURLToPath(new URL('../apps/desktop/mantur-skills/source.json', import.meta.url))
const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

it('stages all 49 pinned files without account credentials or online discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-bundled-skills-'))
  temporary.push(root)
  const destination = join(root, 'resources')
  const manifest = await prepareBundledSkills(sourceFile, destination)
  expect(manifest.skills.map(skill => [skill.name, skill.version])).toEqual([
    ['short-drama', '1.0.0'],
    ['drama-asset-seedance-pipeline', '1.11.0'],
    ['mantur-copyhit', '1.0.5'],
    ['mantur-smartclip', '1.0.1'],
  ])
  expect(manifest.skills.reduce((total, skill) => total + skill.files.length, 0)).toBe(49)
  expect(JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'))).toEqual(manifest)
  const limits = { maxMetadataBytes: 1024 * 1024, maxFiles: 100, maxUnpackedBytes: 10 * 1024 * 1024 }
  expect(await readBundledCatalog(destination, limits)).toEqual(manifest.skills)
  for (const identity of manifest.skills) {
    const loaded = await loadBundledSkill(destination, identity, limits)
    expect(loaded.skill.name).toBe(identity.name)
    expect(loaded.skill.content.length).toBeGreaterThan(100)
    await expect(loadBundledSkill(destination, { ...identity, version: '0.0.0' }, limits)).rejects.toThrow('identity is unavailable')
    await expect(loadBundledSkill(destination, { ...identity, digest: '0'.repeat(64) }, limits)).rejects.toThrow('identity is unavailable')
  }
  await expect(readBundledCatalog(undefined, limits)).rejects.toThrow('not configured')
  await expect(readBundledCatalog(destination, { ...limits, maxMetadataBytes: 1 })).rejects.toThrow('metadata limit')
  await expect(readBundledCatalog(destination, { ...limits, maxFiles: 1 })).rejects.toThrow('resource limits')
  await expect(readBundledCatalog(destination, { ...limits, maxUnpackedBytes: 1 })).rejects.toThrow('resource limits')
  await expect(prepareBundledSkills(sourceFile, destination)).rejects.toMatchObject({ code: 'EEXIST' })
})
