/** Real filesystem publication and cleanup; Windows runs the current-user DACL verifier on its native runner. */
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { NativeBrokerDescriptor } from '../src/auth/broker.ts'
import { withNativeBrokerDescriptor } from '../src/auth/descriptor.ts'

const descriptor: NativeBrokerDescriptor = { version: 2, proxy_origin: 'http://127.0.0.1:40001',
  public_base_url: 'https://auth.example', bridge_secret: `mbp_v2_${'A'.repeat(43)}`, environment: 'test',
  environment_label: 'Isolated descriptor test', expires_at: '2099-01-01T00:00:00Z' }

async function rootDirectory() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-descriptor-test-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

describe('native broker descriptor publication', () => {
  it('publishes only a private path and removes it after the command owner finishes', async () => {
    const root = await rootDirectory()
    let path: string | undefined
    await withNativeBrokerDescriptor(root, descriptor, new AbortController().signal, async (env) => {
      path = env.MANTURHUB_AGENT_AUTH
      if (path === undefined) throw new Error('Expected descriptor path')
      expect(Object.keys(env).sort()).toEqual(['MANTURHUB_AGENT_AUTH', 'MANTURHUB_IDENTITY_MODE'])
      expect(JSON.stringify(env)).not.toContain(descriptor.bridge_secret)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(descriptor)
      const record = await stat(path)
      expect(record.isFile()).toBe(true)
      expect(record.nlink).toBe(1)
      if (process.platform !== 'win32') {
        expect(record.mode & 0o077).toBe(0)
        expect((await stat(dirname(path))).mode & 0o077).toBe(0)
        expect(record.uid).toBe(process.getuid?.())
      }
    })
    expect(await readdir(root)).toEqual([])
  })

  it('retains the descriptor across cancellation until the command cleanup barrier settles', async () => {
    const root = await rootDirectory()
    const cancellation = new AbortController()
    const entered = Promise.withResolvers<string>()
    const release = Promise.withResolvers<undefined>()
    const running = withNativeBrokerDescriptor(root, descriptor, cancellation.signal, async (env) => {
      const path = env.MANTURHUB_AGENT_AUTH
      if (path === undefined) throw new Error('Expected descriptor path')
      entered.resolve(path)
      await release.promise
    })
    const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' })
    try {
      const path = await entered.promise
      cancellation.abort()
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(descriptor)
    } finally { release.resolve(undefined); await rejected }
    expect(await readdir(root)).toEqual([])
  })

  it('removes its own descriptor after a failed command without deleting other profile files', async () => {
    const root = await rootDirectory()
    await writeFile(join(root, 'profile-data.txt'), 'keep this profile data')
    await expect(withNativeBrokerDescriptor(root, descriptor, new AbortController().signal,
      async () => { throw new Error('Command owner failed') })).rejects.toThrow('Command owner failed')
    expect(await readdir(root)).toEqual(['profile-data.txt'])
    expect(await readFile(join(root, 'profile-data.txt'), 'utf8')).toBe('keep this profile data')
  })

  it('refuses pre-cancelled publication without executing the command', async () => {
    const root = await rootDirectory()
    const controller = new AbortController()
    controller.abort()
    const execute = vi.fn(async () => {})
    await expect(withNativeBrokerDescriptor(root, descriptor, controller.signal, execute)).rejects.toMatchObject({ name: 'AbortError' })
    expect(execute).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('rejects a relative root and an oversized descriptor before command execution', async () => {
    const root = await rootDirectory()
    const execute = vi.fn(async () => {})
    await expect(withNativeBrokerDescriptor('relative', descriptor, new AbortController().signal, execute)).rejects.toThrow('absolute')
    await expect(withNativeBrokerDescriptor(root, { ...descriptor, environment_label: 'x'.repeat(16_384) },
      new AbortController().signal, execute)).rejects.toThrow('limit')
    expect(execute).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('rejects a symlink or junction root without publishing into its target', async () => {
    const root = await rootDirectory()
    const other = await rootDirectory()
    const link = join(root, 'link')
    await symlink(other, link, process.platform === 'win32' ? 'junction' : 'dir')
    const execute = vi.fn(async () => {})
    await expect(withNativeBrokerDescriptor(link, descriptor, new AbortController().signal, execute)).rejects.toThrow('owned directory')
    expect(execute).not.toHaveBeenCalled()
    expect(await readdir(other)).toEqual([])
  })
})
