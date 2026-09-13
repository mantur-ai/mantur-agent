/** Exact App-bundled Skill lookup independent of installed or project Skill precedence. */
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSkillText, type ParsedSkill } from '@deepseek-ai/dsh-skill-filesystem'
import { bundledSkillDirectory, parseBundledManifest, verifyBundledSkill, type BundledSkillManifest } from './bundled-manifest.ts'

/** Bounded reads of App-owned manifests and resources. */
export interface BundledReadLimits {
  readonly maxMetadataBytes: number
  readonly maxFiles: number
  readonly maxUnpackedBytes: number
}

/**
 * Read a local manifest without consulting accounts, online catalogs or user Skill roots.
 * @param root - configured App resource directory; absence is an explicit unavailable error.
 * @param limits - configured metadata, file count and total resource limits.
 * @param signal - cancellation of the caller's read.
 * @returns validated identities of the App's pinned Skills.
 */
export async function readBundledCatalog(
  root: string | undefined,
  limits: BundledReadLimits,
  signal?: AbortSignal,
): Promise<BundledSkillManifest[]> {
  if (root === undefined) throw new Error('App-bundled Skill directory is not configured')
  signal?.throwIfAborted()
  const handle = await open(join(root, 'manifest.json'), 'r')
  let bytes: Buffer
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > limits.maxMetadataBytes) throw new Error('App-bundled Skill manifest exceeds the metadata limit')
    bytes = Buffer.alloc(info.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      signal?.throwIfAborted()
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    if (offset !== info.size) throw new Error('App-bundled Skill manifest changed during its read')
    bytes = bytes.subarray(0, offset)
  } finally {
    await handle.close()
  }
  signal?.throwIfAborted()
  const manifest = parseBundledManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  for (const skill of manifest.skills) {
    if (skill.files.length > limits.maxFiles || skill.files.reduce((sum, file) => sum + file.bytes, 0) > limits.maxUnpackedBytes) {
      throw new Error(`App-bundled Skill exceeds resource limits: ${skill.name}`)
    }
  }
  return manifest.skills
}

/**
 * Load only the requested App identity; name matches in other roots never satisfy this request.
 * @param root - configured application resource directory.
 * @param identity - name, version and digest captured when the user selected the Skill.
 * @param limits - configured manifest and resource limits.
 * @param signal - cancellation of the caller's read.
 * @returns verified instructions, identity and their resource directory.
 */
export async function loadBundledSkill(
  root: string | undefined,
  identity: Pick<BundledSkillManifest, 'name' | 'version' | 'digest'>,
  limits: BundledReadLimits,
  signal?: AbortSignal,
): Promise<{ skill: ParsedSkill; identity: BundledSkillManifest; directory: string }> {
  if (root === undefined) throw new Error('App-bundled Skill directory is not configured')
  const catalog = await readBundledCatalog(root, limits, signal)
  const selected = catalog.find(skill =>
    skill.name === identity.name && skill.version === identity.version && skill.digest === identity.digest)
  if (selected === undefined) throw new Error(`App-bundled Skill identity is unavailable: ${identity.name}@${identity.version}`)
  const directory = join(root, bundledSkillDirectory(selected))
  const raw = await verifyBundledSkill(directory, selected, signal)
  const parsed = parseSkillText(raw, (message) => { throw new Error(`Invalid App-bundled Skill ${selected.name}: ${message}`) })
  if (parsed === undefined || parsed.name !== selected.name) throw new Error(`App-bundled Skill name differs: ${selected.name}`)
  if (parsed.version !== selected.version) throw new Error(`App-bundled Skill frontmatter version differs: ${selected.name}`)
  return { skill: parsed, identity: selected, directory }
}
