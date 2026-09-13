/** Stage the desktop's pinned Skill archives without network or user-directory discovery. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { extractArchive } from '../packages/skill/manturhub-marketplace/src/archive.ts'
import { bundledSkillDirectory, bundledSourceSchema, parseBundledManifest, verifyBundledSkill } from '../packages/skill/manturhub-marketplace/src/bundled-manifest.ts'

/**
 * Extract pinned archives into a new resource directory and verify all contents before writing its manifest.
 * @param sourceFile - checked-in archive manifest, adjacent to its archives directory.
 * @param destination - new staging directory; existing destinations are rejected.
 * @returns the verified runtime manifest.
 */
export async function prepareBundledSkills(sourceFile: string, destination: string): Promise<ReturnType<typeof parseBundledManifest>> {
  const source = bundledSourceSchema.parse(JSON.parse(await readFile(sourceFile, 'utf8')))
  const manifest = parseBundledManifest({
    formatVersion: source.formatVersion,
    skills: source.skills.map(({ archive: _archive, archiveSha256: _hash, archiveBytes: _bytes, ...skill }) => skill),
  })
  await mkdir(destination)
  for (const entry of source.skills) {
    const skill = entry
    const archive = join(dirname(sourceFile), entry.archive)
    const info = await lstat(archive)
    if (!info.isFile() || info.size !== entry.archiveBytes) throw new Error(`Bundled archive size differs: ${skill.name}`)
    const bytes = await readFile(archive)
    if (bytes.length !== entry.archiveBytes || createHash('sha256').update(bytes).digest('hex') !== entry.archiveSha256) {
      throw new Error(`Bundled archive hash differs: ${skill.name}`)
    }
    const directory = join(destination, bundledSkillDirectory(skill))
    const directories = new Set(skill.files.flatMap((file) => {
      const parts = file.path.split('/')
      return parts.slice(0, -1).map((_, depth) => parts.slice(0, depth + 1).join('/'))
    }))
    await extractArchive(archive, directory, {
      maxFiles: skill.files.length + directories.size,
      maxUnpackedBytes: skill.files.reduce((total, file) => total + file.bytes, 0),
    })
    await verifyBundledSkill(directory, skill)
  }
  await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return manifest
}
