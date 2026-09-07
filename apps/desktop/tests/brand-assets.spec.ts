import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../..', import.meta.url))

describe('Mantur desktop brand assets', () => {
  it('uses the rounded application icon for both native package targets', async () => {
    const manifest = JSON.parse(await readFile(`${root}/apps/desktop/package.json`, 'utf8')) as {
      scripts: { 'dist:mac:arm64': string; 'dist:mac:x64': string }
      build: {
        mac: { artifactName: string; icon: string; identity?: unknown; notarize: boolean }
        win: { artifactName: string; icon: string }
      }
    }
    expect(manifest.build.mac.icon).toBe('resources/mantur-app-icon.png')
    expect(manifest.build.win.icon).toBe('resources/mantur-app-icon.png')
    expect(manifest.build.mac.identity).toBeUndefined()
    expect(manifest.build.mac.notarize).toBe(true)
    expect(manifest.build.mac.artifactName).toBe('Mantur-Agent-macOS-${arch}.${ext}')
    expect(manifest.build.win.artifactName).toBe('Mantur-Agent-Windows-${arch}.${ext}')
    for (const script of [manifest.scripts['dist:mac:arm64'], manifest.scripts['dist:mac:x64']]) {
      expect(script).toContain('electron-builder --mac zip')
      expect(script).toContain('tsx ../../scripts/create-macos-dmg.ts --arch')
      expect(script).not.toContain('electron-builder --mac dmg')
    }

    const [desktopIcon, webLogo] = await Promise.all([
      readFile(`${root}/apps/desktop/resources/mantur-app-icon.png`),
      readFile(`${root}/apps/web/public/mantur-logo.png`),
    ])
    expect(desktopIcon).not.toEqual(webLogo)
    expect(desktopIcon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(desktopIcon.readUInt32BE(16)).toBe(1024)
    expect(desktopIcon.readUInt32BE(20)).toBe(1024)
    expect(desktopIcon[25]).toBe(6)
    expect(webLogo[25]).toBe(6)
  })
})
