/** Profile metadata keeps optional plugin assets without changing official branding. */
import { rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async original => ({
  ...await original<typeof import('node:fs/promises')>(),
  rm: vi.fn(), writeFile: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
})

it.each(['official', 'mantur'])('keeps the optional mascot while applying %s document metadata', async (profile) => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', profile)
  vi.stubEnv('DSH_CLIENT_TITLE', profile === 'mantur' ? '漫途Agent' : 'DeepSeek Harness')
  const configPath = '../apps/web/vite.config.ts'
  const module = await import(configPath) as { default: { plugins: unknown[] } }
  const metadata = module.default.plugins.flat().find(plugin => typeof plugin === 'object'
    && plugin !== null && 'name' in plugin && plugin.name === 'dsh-client-document-metadata') as {
    transformIndexHtml: (html: string) => string
    closeBundle: () => Promise<void>
  }
  expect(metadata).toBeDefined()
  const html = metadata.transformIndexHtml('<title>DSH Local Build</title><link rel="icon" type="image/svg+xml" href="./favicon.svg" />')
  await metadata.closeBundle()
  expect(vi.mocked(rm).mock.calls.map(([path]) => basename(String(path)))).toEqual([
    profile === 'mantur' ? 'favicon.svg' : 'mantur-logo.png',
  ])
  expect(html).toContain(profile === 'mantur' ? '<title>漫途Agent</title>' : '<title>DeepSeek Harness</title>')
  expect(html).toContain(profile === 'mantur' ? './mantur-logo.png' : './favicon.svg')
  if (profile === 'official') {
    expect(writeFile).not.toHaveBeenCalled()
    expect(html).not.toContain('mantur')
  } else {
    const text = vi.mocked(writeFile).mock.calls[0]![1]
    if (typeof text !== 'string') throw new TypeError('metadata must write the manifest as text')
    const manifest = JSON.parse(text) as { icons: { src: string }[] }
    expect(manifest.icons.map(icon => icon.src)).toEqual(['./mantur-logo.png'])
  }
})
