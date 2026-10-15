/** Authenticated download and atomic installation for ManturHub Skill bundles. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm,
} from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { extractArchive, type ArchiveLimits } from './archive.ts'

/** Installer limits resolved from plugin configuration. */
export interface InstallerConfig extends ArchiveLimits {
  /** Harness data root that owns installer state and temporary files. */
  readonly dshHome: string
  /** Discoverable local Skill directory. */
  readonly skillsRoot: string
  /** Maximum compressed download size. */
  readonly maxBundleBytes: number
  /** Timeout for public metadata and redirect requests. */
  readonly metadataTimeoutMs: number
  /** Timeout for the unauthenticated bundle download. */
  readonly downloadTimeoutMs: number
}

/** Immutable result returned after a committed installation. */
export interface InstalledSkill {
  readonly slug: string
  readonly version: string
}

interface InstallRecord {
  readonly slug: string
  readonly version: string
  readonly contentSha256: string
  readonly bundleSha256: string
  readonly installedAt: string
}

interface InstallState {
  readonly stateVersion: 1
  readonly skills: Readonly<Record<string, InstallRecord>>
}

const recordSchema = z.object({
  slug: z.string().min(1),
  version: z.string().min(1),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  installedAt: z.iso.datetime(),
})

const stateSchema = z.object({
  stateVersion: z.literal(1),
  skills: z.record(z.string(), recordSchema),
})

const emptyState = (): InstallState => ({ stateVersion: 1, skills: {} })

/** Return the state file kept outside the discoverable Skill root. */
function statePath(config: InstallerConfig): string {
  return join(config.dshHome, 'manturhub-marketplace', 'installed-skills.json')
}

/** Read an installation state or start with an empty state on first use. */
async function loadState(config: InstallerConfig): Promise<InstallState> {
  try {
    return stateSchema.parse(JSON.parse(await readFile(statePath(config), 'utf8')) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState()
    throw error
  }
}

/** Commit state with replacement atomicity on the same filesystem. */
async function saveState(config: InstallerConfig, state: InstallState): Promise<void> {
  const target = statePath(config)
  await mkdir(dirname(target), { recursive: true })
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`)
    } finally {
      await handle.close()
    }
    await chmod(temporary, 0o600)
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** Walk files deterministically while rejecting links and special nodes. */
async function filesIn(root: string): Promise<readonly { path: string; name: string }[]> {
  const files: { path: string; name: string }[] = []
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) throw new Error(`Skill directory contains a symbolic link: ${path}`)
      if (metadata.isDirectory()) await walk(path)
      else if (metadata.isFile()) files.push({ path, name: relative(root, path).replaceAll('\\', '/') })
      else throw new Error(`Skill directory contains an unsupported file type: ${path}`)
    }
  }
  await walk(root)
  return files
}

/** Hash paths and contents so later updates can refuse local modifications. */
async function hashDirectory(root: string): Promise<string> {
  const hash = createHash('sha256')
  for (const file of await filesIn(root)) {
    hash.update(file.name)
    hash.update('\0')
    for await (const chunk of createReadStream(file.path)) {
      hash.update(chunk as Uint8Array)
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** Read name and version from the root SKILL.md frontmatter. */
async function installedMetadata(root: string): Promise<{ name: string | undefined; version: string | undefined }> {
  const text = await readFile(join(root, 'SKILL.md'), 'utf8')
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)?.[1] ?? ''
  const field = (name: string): string | undefined => frontmatter
    .match(new RegExp(`^${name}:\\s*["']?([^"'\\s]+)["']?\\s*$`, 'm'))?.[1]
  return { name: field('name'), version: field('version') }
}

/** Permit only TLS redirect targets, plus loopback HTTP used by tests. */
function secureDownloadUrl(value: string): URL {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Skill download redirect must use HTTPS')
  }
  return url
}

/** Stream one bounded response to a newly created file. */
async function downloadResponse(response: Response, target: string, maxBytes: number): Promise<string> {
  if (!response.ok) throw new Error(`Skill download failed with HTTP ${response.status}`)
  if (response.body === null) throw new Error('Skill download returned no body')
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (!Number.isSafeInteger(declared) || declared < 0) {
      await response.body.cancel()
      throw new Error('Skill download returned an invalid Content-Length')
    }
    if (declared > maxBytes) {
      await response.body.cancel()
      throw new Error(`Skill bundle exceeds ${maxBytes} bytes`)
    }
  }
  const digest = createHash('sha256')
  let received = 0
  const handle = await open(target, 'wx', 0o600)
  try {
    const reader = response.body.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received > maxBytes) {
        await reader.cancel()
        throw new Error(`Skill bundle exceeds ${maxBytes} bytes`)
      }
      digest.update(chunk.value)
      await handle.write(chunk.value)
    }
  } catch (error) {
    await handle.close()
    await rm(target, { force: true })
    throw error
  }
  await handle.close()
  return digest.digest('hex')
}

/**
 * Download a bounded public bundle without sending credentials on either hop.
 * @param ctx - Account service selecting the deployment.
 * @param slug - Validated catalog name.
 * @param target - New archive file owned by the caller.
 * @param config - Download and archive limits.
 * @param signal - Optional caller cancellation.
 * @returns SHA256 of the downloaded archive.
 */
export async function downloadBundle(
  ctx: Context, slug: string, target: string, config: InstallerConfig, signal?: AbortSignal,
): Promise<string> {
  const response = await ctx.manturAccount.request(`/api/public/agent/v1/skills/${encodeURIComponent(slug)}/bundle`, {
    authenticated: false,
    headers: { Accept: 'application/zip', 'X-ManturHub-Client': 'mantur-agent' },
    redirect: 'manual',
    signal: AbortSignal.any([AbortSignal.timeout(config.metadataTimeoutMs), ...(signal === undefined ? [] : [signal])]),
  })
  if (response === undefined) throw new Error('AUTH_REQUIRED')
  if (response.status === 401) throw new Error('AUTH_REQUIRED')
  let bundle = response
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (location === null) throw new Error('Skill download redirect omitted Location')
    bundle = await fetch(secureDownloadUrl(location), {
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(config.downloadTimeoutMs), ...(signal === undefined ? [] : [signal])]),
    })
  }
  return await downloadResponse(bundle, target, config.maxBundleBytes)
}

/** Refuse replacement unless the current tree matches this installer's record. */
async function assertReplaceable(destination: string, record: InstallRecord | undefined): Promise<boolean> {
  let metadata
  try {
    metadata = await lstat(destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('LOCAL_CONFLICT')
  if (record === undefined) throw new Error('LOCAL_CONFLICT')
  if (await hashDirectory(destination) !== record.contentSha256) throw new Error('LOCAL_CONFLICT')
  return true
}

/**
 * Install one verified bundle and commit both directory and tracking state.
 *
 * @param ctx - Host context that owns ManturHub authorization and logging.
 * @param slug - Catalog slug and required root `SKILL.md` name.
 * @param version - Catalog version required from root `SKILL.md`.
 * @param config - Resolved storage, timeout, and archive limits.
 * @returns The slug and version committed to the local Skill directory.
 */
export async function installSkill(
  ctx: Context,
  slug: string,
  version: string,
  config: InstallerConfig,
): Promise<InstalledSkill> {
  await mkdir(config.dshHome, { recursive: true })
  await mkdir(config.skillsRoot, { recursive: true })
  const rootMetadata = await lstat(config.skillsRoot)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('Skill installation root is not a real directory')
  }
  const state = await loadState(config)
  const destination = join(config.skillsRoot, slug)
  const replacing = await assertReplaceable(destination, state.skills[slug])
  const temporaryRoot = await mkdtemp(join(config.dshHome, '.mantur-marketplace-'))
  const archive = join(temporaryRoot, `${slug}.zip`)
  const staged = join(temporaryRoot, 'staged')
  const recoveryRoot = join(dirname(config.skillsRoot), '.manturhub-recovery', randomUUID())
  const backup = join(recoveryRoot, slug)
  let installed = false
  let backedUp = false
  try {
    const bundleSha256 = await downloadBundle(ctx, slug, archive, config)
    await extractArchive(archive, staged, config)
    const metadata = await installedMetadata(staged)
    if (metadata.name !== slug) throw new Error('Skill bundle name does not match the requested slug')
    if (metadata.version !== version) throw new Error('Skill bundle version does not match catalog metadata')
    const contentSha256 = await hashDirectory(staged)
    if (replacing) {
      await mkdir(recoveryRoot, { recursive: true })
      try {
        await rename(destination, backup)
        backedUp = true
      } catch (error) {
        await rm(recoveryRoot, { recursive: true, force: true })
        throw error
      }
    }
    try {
      await rename(staged, destination)
      installed = true
      await saveState(config, {
        stateVersion: 1,
        skills: {
          ...state.skills,
          [slug]: {
            slug,
            version,
            contentSha256,
            bundleSha256,
            installedAt: new Date().toISOString(),
          },
        },
      })
    } catch (error) {
      if (installed) {
        try {
          await rm(destination, { recursive: true, force: true })
        } catch (recoveryError) {
          const location = backedUp ? ` The previous Skill remains at ${backup}.` : ''
          throw new AggregateError(
            [error, recoveryError],
            `Skill installation rollback could not remove the new destination.${location}`,
          )
        }
      }
      if (backedUp) {
        try {
          await rename(backup, destination)
        } catch (recoveryError) {
          throw new AggregateError(
            [error, recoveryError],
            `Skill installation rollback could not restore the previous Skill; recovery files remain at ${backup}.`,
          )
        }
        await rm(recoveryRoot, { recursive: true, force: true }).catch((cleanupError: unknown) => {
          ctx.logger.warn(`manturhub-marketplace: empty recovery directory cleanup failed at ${recoveryRoot}: ${String(cleanupError)}`)
        })
      }
      throw error
    }
    if (backedUp) {
      await rm(recoveryRoot, { recursive: true, force: true }).catch((error: unknown) => {
        ctx.logger.warn(`manturhub-marketplace: obsolete recovery directory cleanup failed at ${backup}: ${String(error)}`)
      })
    }
    return { slug, version }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch((error: unknown) => {
      ctx.logger.warn(`manturhub-marketplace: temporary directory cleanup failed: ${String(error)}`)
    })
  }
}
