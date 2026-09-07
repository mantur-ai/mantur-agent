import { describe, expect, it, vi } from 'vitest'
import type { AutomaticProjectDeps } from '../src/client/automatic-project.ts'
import { AutomaticProjectController } from '../src/client/automatic-project.ts'
import type { PreparedProject, ProjectCreationId, ProjectRootSettings } from '@deepseek-ai/dsh-mantur-projects/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

function bench() {
  const persistence = {
    prepareIdentity: vi.fn(async () => '51f643d0-1a79-4a3d-8f81-56a55c978621'),
    commitTransfer: vi.fn(),
  }
  const remote = {
    settings: vi.fn<AutomaticProjectDeps['remote']['settings']>(async () => ({ ok: true, value: { source: 'desktop', rootPath: '/documents/漫途项目' } })),
    setRoot: vi.fn<AutomaticProjectDeps['remote']['setRoot']>(async (path: string) => ({ ok: true, value: { source: 'custom', rootPath: path } })),
    prepare: vi.fn<AutomaticProjectDeps['remote']['prepare']>(async (id: ProjectCreationId) => ({
      ok: true, value: { workspaceId: `workspace-${id}` as PreparedProject['workspaceId'], sessionId: `session-${id}` as SessionId, path: `/projects/${id}` },
    })),
  }
  const sessions = { create: vi.fn<AutomaticProjectDeps['sessions']['create']>(async options => options!.sessionId!) }
  const workspace = { pickDirectory: vi.fn<AutomaticProjectDeps['workspace']['pickDirectory']>(async () => '/chosen') }
  const controller = new AutomaticProjectController({ remote, sessions, workspace, persistence, text: key => key })
  return { controller, persistence, remote, sessions, workspace }
}

describe('Mantur automatic project policy', () => {
  it('loads the default location without reserving a project or creating a Session', async () => {
    const b = bench()
    await b.controller.load()
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: { source: 'desktop', rootPath: '/documents/漫途项目' }, loading: false })
    expect(b.remote.prepare).not.toHaveBeenCalled()
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.persistence.prepareIdentity).not.toHaveBeenCalled()
  })

  it('uses one retained identity for failed Session creation, reload and retry', async () => {
    const b = bench()
    b.sessions.create.mockRejectedValueOnce(new Error('attach failed'))
    await expect(b.controller.prepare(new AbortController().signal)).rejects.toThrow('sessionFailed')
    const firstId = b.remote.prepare.mock.calls[0]![0]
    const reloaded = new AutomaticProjectController({ ...b, text: key => key })
    const session = await reloaded.prepare(new AbortController().signal)
    expect(session).toBe(`session-${firstId}`)
    expect(b.remote.prepare.mock.calls.map((args: [ProjectCreationId, string]) => args[0])).toEqual([firstId, firstId])
    expect(b.remote.prepare).toHaveBeenCalledWith(firstId, `newProject ${firstId.slice(0, 8)}`)
    expect(b.sessions.create.mock.calls[0]).toEqual(b.sessions.create.mock.calls[1])
    expect(b.persistence.commitTransfer).not.toHaveBeenCalled()
  })

  it('fails before Host writes when native storage cannot retain the identity', async () => {
    const b = bench()
    b.persistence.prepareIdentity.mockRejectedValueOnce(new Error('storage denied'))
    await expect(b.controller.prepare(new AbortController().signal)).rejects.toThrow('storageFailed')
    expect(b.remote.prepare).not.toHaveBeenCalled()
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it.each([
    ['root-unconfigured', 'rootRequired'],
    ['directory-conflict', 'directoryConflict'],
    ['directory-invalid', 'directoryInvalid'],
  ] as const)('shows %s without creating a Session', async (reason, message) => {
    const b = bench()
    b.remote.prepare.mockResolvedValue({ ok: false, error: { code: 'mantur-project/creation-failed', message: 'Host detail', details: { reason } } })
    await expect(b.controller.prepare(new AbortController().signal)).rejects.toThrow(message)
    expect(b.controller.store.getSnapshot()).toMatchObject({ preparing: false, error: message })
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.persistence.prepareIdentity).toHaveBeenCalledOnce()
  })

  it('cancels the next step after a late Host preparation without retiring the identity', async () => {
    const b = bench()
    let resolve!: (result: RemoteResult<PreparedProject>) => void
    b.remote.prepare.mockImplementation(() => new Promise((finish) => { resolve = finish }))
    const cancel = new AbortController()
    const pending = b.controller.prepare(cancel.signal)
    await vi.waitFor(() => { expect(b.remote.prepare).toHaveBeenCalledOnce() })
    cancel.abort()
    resolve({ ok: true, value: { workspaceId: 'workspace' as PreparedProject['workspaceId'], sessionId: 'session' as SessionId, path: '/project' } })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.persistence.prepareIdentity).toHaveBeenCalledOnce()
    expect(b.controller.store.getSnapshot()).toMatchObject({ preparing: false, error: null })
  })

  it('does not change a location when the picker is cancelled', async () => {
    const b = bench()
    await b.controller.load()
    b.workspace.pickDirectory.mockResolvedValue(null)
    await b.controller.chooseRoot()
    expect(b.remote.setRoot).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot()).toMatchObject({ choosing: false, settings: { rootPath: '/documents/漫途项目' } })
  })

  it('does not save a location returned after the plugin was disposed', async () => {
    const b = bench()
    const picked = Promise.withResolvers<string | null>()
    b.workspace.pickDirectory.mockReturnValue(picked.promise)
    const choosing = b.controller.chooseRoot()
    b.controller.dispose()
    const state = b.controller.store.getSnapshot()
    picked.resolve('/late')
    await choosing
    expect(b.remote.setRoot).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot()).toBe(state)
  })

  it('does not replace a newly selected location with an older read', async () => {
    const b = bench()
    let resolve!: (result: RemoteResult<ProjectRootSettings>) => void
    b.remote.settings.mockImplementation(() => new Promise((finish) => { resolve = finish }))
    const loading = b.controller.load()
    await b.controller.chooseRoot()
    resolve({ ok: true, value: { source: 'desktop', rootPath: '/old' } })
    await loading
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: { source: 'custom', rootPath: '/chosen' }, loading: false })
  })

  it('does not erase a newly selected location when an older read fails', async () => {
    const b = bench()
    const read = Promise.withResolvers<RemoteResult<ProjectRootSettings>>()
    b.remote.settings.mockReturnValue(read.promise)
    const loading = b.controller.load()
    await b.controller.chooseRoot()
    read.reject(new Error('old read lost connection'))
    await loading
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: { rootPath: '/chosen' }, error: null, loading: false })
  })

  it('reports Host-rejected settings reads and root changes as unavailable', async () => {
    const b = bench()
    b.remote.settings.mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'read failed' } })
    await b.controller.load()
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: undefined, error: 'settingsFailed', loading: false })
    b.remote.setRoot.mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'save failed' } })
    await b.controller.chooseRoot()
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: undefined, error: 'selectionFailed', choosing: false })
  })

  it('does not open a second picker while the first selection is pending', async () => {
    const b = bench()
    const picked = Promise.withResolvers<string | null>()
    b.workspace.pickDirectory.mockReturnValue(picked.promise)
    const first = b.controller.chooseRoot()
    await b.controller.chooseRoot()
    expect(b.workspace.pickDirectory).toHaveBeenCalledOnce()
    picked.resolve('/first')
    await first
    expect(b.remote.setRoot).toHaveBeenCalledExactlyOnceWith('/first')
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: { rootPath: '/first' }, choosing: false })
  })

  it('does not load settings or open a picker after disposal', async () => {
    const b = bench()
    b.controller.dispose()
    const state = b.controller.store.getSnapshot()
    await b.controller.load()
    await b.controller.chooseRoot()
    expect(b.remote.settings).not.toHaveBeenCalled()
    expect(b.workspace.pickDirectory).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot()).toBe(state)
  })

  it('reports a non-project Host rejection without creating a Session', async () => {
    const b = bench()
    b.remote.prepare.mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'unavailable' } })
    await expect(b.controller.prepare(new AbortController().signal)).rejects.toThrow('createFailed')
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: 'createFailed', preparing: false })
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('uses localized failure copy when a transport rejects without an Error', async () => {
    const b = bench()
    b.remote.prepare.mockRejectedValue('connection closed')
    await expect(b.controller.prepare(new AbortController().signal)).rejects.toBe('connection closed')
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: 'createFailed', preparing: false })
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('marks failed reads and uncertain writes as unavailable rather than fresh cached locations', async () => {
    const b = bench()
    await b.controller.load()
    b.remote.settings.mockRejectedValueOnce(new Error('offline'))
    await b.controller.load()
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: undefined, error: 'settingsFailed' })
    b.remote.setRoot.mockRejectedValueOnce(new Error('connection lost after write'))
    await b.controller.chooseRoot()
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: undefined, error: 'selectionFailed', choosing: false })
  })

  it('does not reload a location while its change is unsettled', async () => {
    const b = bench()
    await b.controller.load()
    const saving = Promise.withResolvers<RemoteResult<ProjectRootSettings>>()
    b.remote.setRoot.mockReturnValue(saving.promise)
    const choosing = b.controller.chooseRoot()
    await vi.waitFor(() => { expect(b.remote.setRoot).toHaveBeenCalledOnce() })
    await b.controller.load()
    expect(b.remote.settings).toHaveBeenCalledOnce()
    saving.reject(new Error('write result unknown'))
    await choosing
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: undefined, choosing: false, error: 'selectionFailed' })
    b.remote.settings.mockResolvedValue({ ok: true, value: { source: 'custom', rootPath: '/committed' } })
    await b.controller.load()
    expect(b.controller.store.getSnapshot()).toMatchObject({ settings: { rootPath: '/committed' }, error: null })
  })

  it('refuses Host creation when the native checkpoint service is unavailable', async () => {
    const b = bench()
    const controller = new AutomaticProjectController({ ...b, persistence: undefined, text: key => key })
    await expect(controller.prepare(new AbortController().signal)).rejects.toThrow('storageFailed')
    expect(b.remote.prepare).not.toHaveBeenCalled()
  })

  it('does not publish a late settings response after disposal', async () => {
    const b = bench()
    let resolve!: (result: RemoteResult<ProjectRootSettings>) => void
    b.remote.settings.mockImplementation(() => new Promise((finish) => { resolve = finish }))
    const loading = b.controller.load()
    const state = b.controller.store.getSnapshot()
    b.controller.dispose()
    resolve({ ok: true, value: { source: 'desktop', rootPath: '/late' } })
    await loading
    expect(b.controller.store.getSnapshot()).toBe(state)
  })
})
