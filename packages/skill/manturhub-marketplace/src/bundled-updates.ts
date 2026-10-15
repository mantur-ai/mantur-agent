/** Verified, immutable online releases for the application's recommended Skills. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { readManturHubJson } from '@deepseek-ai/dsh-authorization-manturhub'
import { z } from 'zod'
import { extractArchive } from './archive.ts'
import { loadBundledSkill, readBundledCatalog, type BundledReadLimits } from './bundled-catalog.ts'
import { bundledSkillDigest, bundledSkillDirectory, bundledSkillSchema, type BundledSkillManifest } from './bundled-manifest.ts'
import { downloadBundle, type InstallerConfig } from './installer.ts'

const releaseSchema = z.object({ code: z.literal(0), data: z.object({
  code: bundledSkillSchema.shape.name,
  name: z.string().min(1),
  skillVersion: bundledSkillSchema.shape.version,
  bundleDigest: z.string().regex(/^[a-f0-9]{64}$/),
}) })

/**
 * Locate an immutable release outside all automatically discovered Skill directories.
 * @param root - Application-owned update store.
 * @param identity - Validated name and version.
 * @returns Release container containing its manifest and resources.
 */
export function updatedSkillRoot(root: string, identity: Pick<BundledSkillManifest, 'name' | 'version'>): string {
  return join(root, `${identity.name}@${identity.version}`)
}

async function inventory(root: string, signal: AbortSignal, prefix = ''): Promise<BundledSkillManifest['files']> {
  const files: BundledSkillManifest['files'] = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    signal.throwIfAborted()
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...await inventory(root, signal, path))
    else if (entry.isFile()) {
      const bytes = await readFile(join(root, path), { signal })
      files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    } else throw new Error(`Unsupported updated Skill entry: ${path}`)
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

/**
 * Check published releases and commit verified updates before returning homepage entries.
 * @param ctx - Host account service selecting the deployment.
 * @param seeds - Packaged allowlist of recommended Skills.
 * @param root - Application-owned update store, separate from user Skills.
 * @param config - Download, extraction and metadata limits.
 * @param signal - Cancellation propagated through requests and verification.
 * @returns Latest verified identities; failures reject instead of reporting stale entries as current.
 */
export async function updateBundledSkills(
  ctx: Context, seeds: readonly BundledSkillManifest[], root: string, config: InstallerConfig & BundledReadLimits, signal: AbortSignal,
): Promise<BundledSkillManifest[]> {
  const result: BundledSkillManifest[] = []
  await mkdir(root, { recursive: true })
  for (const seed of seeds) {
    signal.throwIfAborted()
    const response = await ctx.manturAccount.request(`/api/public/agent/v1/skills/${encodeURIComponent(seed.name)}`, {
      authenticated: false,
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.metadataTimeoutMs)]),
    })
    if (response === undefined || !response.ok) throw new Error(`Skill update metadata failed: ${seed.name}`)
    const latest = releaseSchema.parse(await readManturHubJson(response, config.maxMetadataBytes, 'metadata')).data
    if (latest.code !== seed.name) throw new Error('Skill update returned a different name')
    const release = { name: latest.code, title: latest.name, version: latest.skillVersion }
    const destination = updatedSkillRoot(root, release)
    let exists = false
    try {
      const info = await lstat(destination)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Skill update store is not a real directory')
      exists = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (exists) {
      if (await readFile(join(destination, 'archive.sha256'), 'utf8') !== latest.bundleDigest) {
        throw new Error(`Published Skill changed without a new version: ${seed.name}@${release.version}`)
      }
      const catalog = await readBundledCatalog(destination, config, signal)
      const selected = catalog[0]
      if (catalog.length !== 1 || selected === undefined || selected.name !== release.name || selected.version !== release.version) {
        throw new Error('Stored Skill release identity differs')
      }
      await loadBundledSkill(destination, selected, config, signal)
      result.push(selected)
      continue
    }
    const temporary = await mkdtemp(join(root, '.download-'))
    try {
      const archive = join(temporary, 'bundle.zip')
      const digest = await downloadBundle(ctx, seed.name, archive, config, signal)
      if (digest !== latest.bundleDigest) throw new Error(`Skill archive digest differs: ${seed.name}`)
      signal.throwIfAborted()
      const staged = join(temporary, 'resources')
      await extractArchive(archive, staged, config)
      const files = await inventory(staged, signal)
      const identity = { ...release, files, digest: bundledSkillDigest({ ...release, files }) }
      const manifest = JSON.stringify({ formatVersion: 1, skills: [identity] })
      if (Buffer.byteLength(manifest) > config.maxMetadataBytes) throw new Error('Skill update manifest exceeds metadata limit')
      const container = join(temporary, 'release')
      await mkdir(container)
      await rename(staged, join(container, bundledSkillDirectory(identity)))
      await writeFile(join(container, 'manifest.json'), manifest, { flag: 'wx', mode: 0o600 })
      await writeFile(join(container, 'archive.sha256'), digest, { flag: 'wx', mode: 0o600 })
      await loadBundledSkill(container, identity, config, signal)
      signal.throwIfAborted()
      try { await rename(container, destination) } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        // Another process may publish the same immutable release; accept only identical verified bytes.
        if (await readFile(join(destination, 'archive.sha256'), 'utf8') !== digest) throw error
        await loadBundledSkill(destination, identity, config, signal)
      }
      result.push(identity)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  return result
}
