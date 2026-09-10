import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import ManturProjects from '../src/index.ts'
import type { ProjectCreationId } from '../src/types.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, mkdir: vi.fn(actual.mkdir), lstat: vi.fn(actual.lstat) }
})

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const creationId = (): ProjectCreationId => brandString<ProjectCreationId>(randomUUID())

async function temporaryRoot(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'mantur-projects-test-')))
  cleanup.push(async () => { await rm(directory, { recursive: true, force: true }) })
  return directory
}

async function harness(defaultRoot?: string, pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const domain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', domain)
  ctx.provide('storageDomain', domain)
  // Project preparation only needs persisted headers, never a running Session.
  ctx.provide('sessionPersistence', { list: async () => [] } as never)
  const workspaceFiber = await ctx.plugin(WorkspaceRegistry)
  const projectFiber = await ctx.plugin(ManturProjects, defaultRoot === undefined ? {} : { defaultRoot })
  const dispose = async (): Promise<void> => {
    await projectFiber.dispose()
    await workspaceFiber.dispose()
  }
  cleanup.push(dispose)
  return { ctx, projects: ctx.manturProjects, pool, dispose }
}

describe('first-send project preparation', () => {
  it('rejects new preparations after the Host owner closes', async () => {
    const root = await temporaryRoot()
    const b = await harness(root)
    await b.dispose()
    expect(() => b.projects.prepare(creationId(), '新项目')).toThrow('shutting down')
    expect(await readdir(root)).toEqual([])
  })

  it('retains the original child-directory failure without reporting a conflict', async () => {
    const root = await temporaryRoot()
    const { projects } = await harness(root)
    const denied = Object.assign(new Error('directory access denied'), { code: 'EACCES' })
    const create = vi.mocked(mkdir)
    const original = create.getMockImplementation()!
    try {
      create.mockImplementationOnce(original).mockRejectedValueOnce(denied)
      await expect(projects.prepare(creationId(), '新项目')).rejects.toBe(denied)
      expect(await readdir(root)).toEqual([])
    } finally { create.mockReset().mockImplementation(original) }
  })

  it('retains inspection failures instead of reporting a missing directory', async () => {
    const root = await temporaryRoot()
    const { projects } = await harness(root)
    const id = creationId()
    const project = await projects.prepare(id, '新项目')
    const denied = Object.assign(new Error('inspection access denied'), { code: 'EACCES' })
    const inspect = vi.mocked(lstat)
    const original = inspect.getMockImplementation()!
    try {
      inspect.mockRejectedValueOnce(denied)
      await expect(projects.prepare(id, '新项目')).rejects.toBe(denied)
    } finally { inspect.mockReset().mockImplementation(original) }
    expect(await projects.prepare(id, '新项目')).toEqual(project)
  })

  it('reads and changes the root without creating directories or Workspaces', async () => {
    const parent = await temporaryRoot()
    const root = join(parent, 'Documents', '漫途项目')
    const { ctx, projects } = await harness(root)
    expect(projects.settings()).toEqual({ source: 'desktop', rootPath: root })
    expect(ctx.workspaceRegistry.list()).toEqual([])
    expect(await readdir(parent)).toEqual([])
    const selected = join(parent, 'selected')
    expect(await projects.setRoot(selected)).toEqual({ source: 'custom', rootPath: selected })
    expect(await readdir(parent)).toEqual([])
  })

  it('requires an explicit root when the desktop default is absent', async () => {
    const { projects } = await harness()
    expect(projects.settings()).toEqual({ source: 'unconfigured' })
    await expect(projects.prepare(creationId(), '新项目')).rejects.toMatchObject({ code: 'mantur-project/creation-failed', details: { reason: 'root-unconfigured' } })
  })

  it('rejects relative paths, null bytes and non-UUID creation identities before writing', async () => {
    const root = await temporaryRoot()
    const { projects } = await harness(root)
    await expect(projects.setRoot('relative')).rejects.toThrow('absolute')
    await expect(projects.setRoot(`${root}\0suffix`)).rejects.toThrow('absolute')
    expect(() => projects.prepare(brandString<ProjectCreationId>('../outside'), '新项目')).toThrow()
    expect(() => projects.prepare(creationId(), '  ')).toThrow()
    expect(await readdir(root)).toEqual([])
  })

  it('creates one directory and Workspace for concurrent and repeated first sends', async () => {
    const root = await temporaryRoot()
    const { ctx, projects } = await harness(root)
    const id = creationId()
    const [first, second] = await Promise.all([projects.prepare(id, '新项目'), projects.prepare(id, 'New project')])
    expect(first).toEqual(second)
    expect(await projects.prepare(id, 'New project')).toEqual(first)
    expect(first.sessionId).toBe(`session-${id}`)
    expect((await lstat(first.path)).isDirectory()).toBe(true)
    expect(await readdir(root)).toEqual([`project-${id}`])
    expect(ctx.workspaceRegistry.list()).toHaveLength(1)
    expect(ctx.workspaceRegistry.list()[0]?.title).toBe('新项目')
  })

  it('persists the selected root and prepared project across Host reloads', async () => {
    const root = await temporaryRoot()
    const initial = await harness()
    await initial.projects.setRoot(root)
    const id = creationId()
    const project = await initial.projects.prepare(id, '新项目')
    await initial.dispose()
    const reloaded = await harness(undefined, initial.pool)
    expect(reloaded.projects.settings()).toEqual({ source: 'custom', rootPath: root })
    expect(await reloaded.projects.prepare(id, 'New project')).toEqual(project)
    expect(reloaded.ctx.workspaceRegistry.list()).toHaveLength(1)
  })

  it('uses root changes only for new creation identities', async () => {
    const parent = await temporaryRoot()
    const root = join(parent, 'first')
    const secondRoot = join(parent, 'second')
    const { projects } = await harness(root)
    const id = creationId()
    const first = await projects.prepare(id, '新项目')
    await projects.setRoot(secondRoot)
    expect(await projects.prepare(id, '新项目')).toEqual(first)
    const secondId = creationId()
    const second = await projects.prepare(secondId, '新项目')
    expect(second.path).toBe(join(secondRoot, `project-${secondId}`))
  })

  it('retries a failed Workspace attachment using the same owned directory', async () => {
    const root = await temporaryRoot()
    const { ctx, projects } = await harness(root)
    const create = vi.spyOn(ctx.workspaceRegistry, 'create').mockRejectedValueOnce(new Error('storage unavailable'))
    const id = creationId()
    await expect(projects.prepare(id, '新项目')).rejects.toThrow('storage unavailable')
    const project = await projects.prepare(id, '新项目')
    expect(create).toHaveBeenCalledTimes(2)
    expect(await readdir(root)).toEqual([`project-${id}`])
    expect(ctx.workspaceRegistry.list()[0]?.id).toBe(project.workspaceId)
  })

  it('retains the reserved path after a failed mkdir even when the root changes', async () => {
    const parent = await temporaryRoot()
    const blocked = join(parent, 'blocked')
    await writeFile(blocked, 'user file')
    const { projects } = await harness(blocked)
    const id = creationId()
    await expect(projects.prepare(id, '新项目')).rejects.toThrow()
    await projects.setRoot(join(parent, 'new-root'))
    await expect(projects.prepare(id, '新项目')).rejects.toThrow()
    expect(await readFile(blocked, 'utf8')).toBe('user file')
    expect(await readdir(parent)).toEqual(['blocked'])
  })

  it('never adopts or deletes an existing directory with the reserved name', async () => {
    const root = await temporaryRoot()
    const { ctx, projects } = await harness(root)
    const id = creationId()
    const path = join(root, `project-${id}`)
    await mkdir(path)
    await writeFile(join(path, 'keep.txt'), 'user data')
    await expect(projects.prepare(id, '新项目')).rejects.toMatchObject({ details: { reason: 'directory-conflict', path } })
    await expect(projects.prepare(id, '新项目')).rejects.toMatchObject({ details: { reason: 'directory-conflict', path } })
    expect(await readFile(join(path, 'keep.txt'), 'utf8')).toBe('user data')
    expect(ctx.workspaceRegistry.list()).toEqual([])
  })

  it.each(['missing', 'file', 'symlink'])('rejects a prepared directory replaced by %s', async (replacement) => {
    const root = await temporaryRoot()
    const { projects } = await harness(root)
    const id = creationId()
    const project = await projects.prepare(id, '新项目')
    // The directory created by this test is empty; the replacement simulates external edits.
    await rm(project.path, { recursive: true })
    if (replacement === 'symlink') await symlink(root, project.path, 'junction')
    if (replacement === 'file') await writeFile(project.path, 'user file')
    await expect(projects.prepare(id, '新项目')).rejects.toMatchObject({ details: { reason: 'directory-invalid' } })
  })
})
