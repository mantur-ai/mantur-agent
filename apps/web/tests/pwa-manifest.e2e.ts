import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const buildRecord = JSON.parse(
  await readFile(join(REPO_ROOT, '.dsh-build/client-build-environment.json'), 'utf8'),
) as unknown
if (typeof buildRecord !== 'object' || buildRecord === null || !('environment' in buildRecord)
  || typeof buildRecord.environment !== 'object' || buildRecord.environment === null) {
  throw new TypeError('client build record must contain an environment object')
}
const PROFILE = 'DSH_CLIENT_BUILD_PROFILE' in buildRecord.environment
  ? buildRecord.environment.DSH_CLIENT_BUILD_PROFILE
  : undefined
if (PROFILE !== undefined && typeof PROFILE !== 'string') {
  throw new TypeError('client build profile must be a string')
}

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual(PROFILE === 'mantur'
    ? {
      id: '/',
      name: '漫途Agent',
      short_name: '漫途Agent',
      start_url: '/',
      scope: '/',
      display: 'fullscreen',
      icons: [{
        src: './mantur-logo.png',
        sizes: '1024x1024',
        type: 'image/png',
        purpose: 'any',
      }],
    }
    : {
      id: '/',
      name: 'DeepSeek Harness',
      short_name: 'DSH',
      start_url: '/',
      scope: '/',
      display: 'fullscreen',
      icons: [{
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      }],
    })
  expect(index).toContain(PROFILE === 'mantur'
    ? '<link rel="icon" type="image/png" href="./mantur-logo.png" />'
    : '<link rel="icon" type="image/svg+xml" href="./favicon.svg" />')
})

it('ships the profile-owned favicon', async () => {
  if (PROFILE === 'mantur') {
    expect(existsSync(join(DIST_ROOT, 'favicon.svg'))).toBe(false)
    const logo = await readFile(join(DIST_ROOT, 'mantur-logo.png'))
    expect(logo.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    return
  }
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The light fill must live inside the dark-scheme media query, so the icon
  // stays black in light mode and only turns white under a dark scheme.
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*path\s*{[^}]*fill:\s*#fff/i)
  expect(favicon).toContain('fill="#000"')
})

it.each(['script', 'production', 'editing', 'assets', 'welcome'])('ships the transparent %s artwork in every Web profile', async (mode) => {
  for (const scale of [2, 3]) {
    const name = mode === 'welcome' ? 'mantoo-welcome' : `mantoo-${mode}-peek`
    const png = await readFile(join(DIST_ROOT, `${name}@${scale}x.png`))
    expect(png.readUInt32BE(16)).toBe((mode === 'welcome' ? 96 : 184) * scale)
    expect(png.readUInt32BE(20)).toBe((mode === 'welcome' ? 96 : 120) * scale)
    expect(png[25]).toBe(6)
  }
})
