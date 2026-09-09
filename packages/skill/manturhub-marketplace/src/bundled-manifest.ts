/** Exact file identities for read-only skills distributed with the desktop application. */
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const relativePath = z.string().min(1).refine(value =>
  !value.startsWith('/') && !value.includes('\\') && !value.includes(':') && !value.includes('\0')
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
)
const file = z.object({ path: relativePath, bytes: z.number().int().nonnegative(), sha256: digest }).strict()

/** One complete bundle, identified independently of user-installed skills with the same name. */
export const bundledSkillSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/),
  digest,
  files: z.array(file).min(1),
}).strict()

/** Versioned package manifest; absent or malformed files are not a request for online discovery. */
export const bundledManifestSchema = z.object({ formatVersion: z.literal(1), skills: z.array(bundledSkillSchema) }).strict()

/** Build-time archive identities accompanying the runtime file inventory. */
export const bundledSourceSchema = z.object({
  formatVersion: z.literal(1),
  skills: z.array(bundledSkillSchema.extend({
    archive: z.string().regex(/^archives\/[a-z0-9.-]+\.zip$/),
    archiveSha256: digest,
    archiveBytes: z.number().int().positive(),
  }).strict()),
}).strict()

/** Parsed immutable bundle metadata. */
export type BundledSkillManifest = z.infer<typeof bundledSkillSchema>

/**
 * Encode the exact version for a persisted input reference.
 * @param skill - verified App identity.
 * @returns version-qualified reference text, without the slash gesture prefix.
 */
export function bundledSkillReference(skill: Pick<BundledSkillManifest, 'name' | 'version' | 'digest'>): string {
  return `${skill.name}@${skill.version}#${skill.digest}`
}

/**
 * Validate a serialized App reference without accepting directory paths.
 * @param reference - version-qualified reference received from a draft or prompt.
 * @returns the captured name, version and digest.
 */
export function parseBundledSkillReference(reference: string): Pick<BundledSkillManifest, 'name' | 'version' | 'digest'> {
  const parts = /^([a-z0-9]+(?:-[a-z0-9]+)*)@([0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?)#([a-f0-9]{64})$/.exec(reference)
  if (parts === null || parts[1] === undefined || parts[2] === undefined || parts[3] === undefined) {
    throw new Error('Invalid App-bundled Skill reference')
  }
  return { name: parts[1], version: parts[2], digest: parts[3] }
}

/**
 * Hash the canonical identity and sorted file inventory of one skill.
 * @param skill - name, version and exact file inventory.
 * @returns SHA256 used by references and package validation.
 */
export function bundledSkillDigest(skill: Pick<BundledSkillManifest, 'name' | 'version' | 'files'>): string {
  return createHash('sha256').update(JSON.stringify({ name: skill.name, version: skill.version, files: skill.files })).digest('hex')
}

/**
 * Resolve the version-specific directory without accepting caller-provided paths.
 * @param skill - validated bundle identity.
 * @returns one directory name below the application-owned bundle root.
 */
export function bundledSkillDirectory(skill: Pick<BundledSkillManifest, 'name' | 'digest'>): string {
  return `${skill.name}-${skill.digest}`
}

/**
 * Validate inventory ordering, unique names and content identities.
 * @param value - JSON decoded from the package manifest.
 * @returns the validated manifest.
 */
export function parseBundledManifest(value: unknown): z.infer<typeof bundledManifestSchema> {
  const manifest = bundledManifestSchema.parse(value)
  const names = new Set<string>()
  for (const skill of manifest.skills) {
    if (names.has(skill.name)) throw new Error(`Duplicate bundled skill: ${skill.name}`)
    names.add(skill.name)
    const paths = skill.files.map(item => item.path)
    const sortedPaths = [...paths].sort()
    if (!paths.includes('SKILL.md') || new Set(paths.map(path => path.toLowerCase())).size !== paths.length
      || paths.some((path, index) => path !== sortedPaths[index])) {
      throw new Error(`Invalid bundled skill inventory: ${skill.name}`)
    }
    if (bundledSkillDigest(skill) !== skill.digest) throw new Error(`Bundled skill identity mismatch: ${skill.name}`)
  }
  return manifest
}

async function filesBelow(directory: string, prefix = ''): Promise<string[]> {
  if (!(await lstat(directory)).isDirectory()) throw new Error('Bundled skill root must be a directory, not a link')
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...await filesBelow(join(directory, entry.name), path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`Unsupported bundled skill entry: ${path}`)
  }
  return files.sort()
}

/**
 * Verify every packaged resource and return the same SKILL.md bytes that were hashed.
 * @param directory - exact bundle directory, not a user or project skill search root.
 * @param skill - validated expected inventory.
 * @param signal - cancellation of the caller's read.
 * @returns verified UTF-8 Markdown for the normal skill parser.
 */
export async function verifyBundledSkill(directory: string, skill: BundledSkillManifest, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const paths = await filesBelow(directory)
  if (JSON.stringify(paths) !== JSON.stringify(skill.files.map(item => item.path))) {
    throw new Error(`Bundled skill files differ: ${skill.name}`)
  }
  let markdown: string | undefined
  for (const expected of skill.files) {
    signal?.throwIfAborted()
    const path = join(directory, expected.path)
    const info = await lstat(path)
    if (!info.isFile() || info.size !== expected.bytes) throw new Error(`Bundled skill file differs: ${expected.path}`)
    const bytes = await readFile(path, { signal })
    if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
      throw new Error(`Bundled skill file differs: ${expected.path}`)
    }
    if (expected.path === 'SKILL.md') markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  if (markdown === undefined) throw new Error(`Bundled skill has no SKILL.md: ${skill.name}`)
  return markdown
}
