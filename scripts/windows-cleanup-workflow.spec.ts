/** Keep the browser cleanup reproduction limited to the existing Windows runtime pins. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected workflow mapping')
  return value as Record<string, unknown>
}

const text = readFileSync(fileURLToPath(new URL('../.github/workflows/desktop-windows-cleanup-probe.yml', import.meta.url)), 'utf8')
const workflow = record(load(text))
const job = record(record(workflow.jobs).probe)
const steps = (job.steps as unknown[]).map(record)
function step(name: string): Record<string, unknown> {
  const value = steps.find(item => item.name === name)
  if (!value) throw new Error(`Missing workflow step: ${name}`)
  return value
}

describe('Windows cleanup diagnostic workflow', () => {
  it('runs only on the dedicated branch with its two exact trigger paths and read permission', () => {
    expect(record(record(workflow.on).push)).toEqual({
      branches: ['feat/desktop-windows-release-1-0-0-harness'],
      paths: ['.github/workflows/desktop-windows-cleanup-probe.yml', 'scripts/mantur-cut-windows-browser-cleanup-probe.mjs'],
    })
    expect(job.if).toBe("github.ref == 'refs/heads/feat/desktop-windows-release-1-0-0-harness'")
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(job['runs-on']).toBe('windows-2025')
    expect(record(job.defaults).run).toEqual({ shell: 'pwsh' })
    expect(job.environment).toBeUndefined()
    expect(text).not.toMatch(
      /secrets\.|contents: write|actions: write|pnpm install|npm install|desktop:dist|build:mantur|desktop-publish-tos/,
    )
  })

  it('fixes Node and Electron to the existing pins and verifies the exact runtime archive', () => {
    expect(record(steps.find(item => item.uses === 'actions/setup-node@v6')?.with)['node-version']).toBe('24.18.1')
    expect(record(job.env)).toEqual({
      ELECTRON_VERSION: '43.4.0',
      ELECTRON_ARCHIVE_SHA256: 'ef0709cfa719739acce73de6f9b684304baf38c6454376638a70d34a7cecffe0',
      ELECTRON_ARCHIVE_BYTES: '144408141',
      CHROME_VERSION: '149.0.7790.0',
      CHROME_ARCHIVE_SHA256: '8a112c0e768907ff382ff994dcde35cdbd0e1f5a3a475da93d3a83e3260e78c2',
      CHROME_ARCHIVE_BYTES: '118785025',
    })
    expect(step('Require the existing runtime pins').run).toContain("$repository.packageManager -ne 'pnpm@11.7.0'")
    expect(step('Require the existing runtime pins').run).toContain('$desktop.devDependencies.electron -ne $env:ELECTRON_VERSION')
    const prepare = String(step('Verify and prepare the exact Electron runtime').run)
    expect(prepare).toContain('https://github.com/electron/electron/releases/download/v43.4.0')
    expect(prepare).toContain('$entries.Count -ne 1')
    expect(prepare).toContain('$file.Length -ne [long]$env:ELECTRON_ARCHIVE_BYTES -or $sha256 -ne $env:ELECTRON_ARCHIVE_SHA256')
    expect(prepare).toContain('Get-FileHash -LiteralPath $archive -Algorithm SHA256')
    expect(steps.indexOf(step('Require the existing runtime pins'))).toBeLessThan(
      steps.indexOf(step('Verify and prepare the exact Electron runtime')),
    )
  })

  it('binds the Chrome ZIP to the Windows source pin before recording the extracted executable identity', () => {
    const pins = String(step('Require the existing runtime pins').run)
    expect(pins).toContain("$browser = $source.targets.'win32-x64'")
    expect(pins).toContain("$browser.chromeVersion -ne $env:CHROME_VERSION -or $browser.chromePlatform -ne 'win64'")
    expect(pins).toContain('$browser.chromeSha256 -ne $env:CHROME_ARCHIVE_SHA256')
    const prepare = String(step('Verify and prepare the exact Chrome runtime').run)
    expect(prepare).toContain(
      'https://storage.googleapis.com/chrome-for-testing-public/149.0.7790.0/win64/chrome-headless-shell-win64.zip',
    )
    const verify = '$file.Length -ne [long]$env:CHROME_ARCHIVE_BYTES -or $sha256 -ne $env:CHROME_ARCHIVE_SHA256'
    expect(prepare).toContain(verify)
    expect(prepare.indexOf(verify)).toBeLessThan(prepare.indexOf('Expand-Archive'))
    expect(prepare).toContain('Get-FileHash -LiteralPath $chrome.FullName -Algorithm SHA256')
    expect(prepare).toContain('bytes = $chrome.Length; fileVersion = $chrome.VersionInfo.FileVersion')
    expect(prepare).toContain('windows-cleanup-evidence/CHROME-INPUT.json')
  })

  it('runs only the new browser probe and always uploads an explicit small evidence allowlist', () => {
    const probe = step('Diagnose only real browser profile cleanup cases')
    expect(probe.run).toContain('node scripts/mantur-cut-windows-browser-cleanup-probe.mjs --electron "$env:CLEANUP_PROBE_ELECTRON"')
    expect(probe.run).toContain('--chrome "$env:CLEANUP_PROBE_CHROME"')
    expect(probe.run).toContain('--cases a1,b1')
    expect(probe.run).toContain('--output "$env:RUNNER_TEMP/windows-cleanup-evidence/browser-probe"')
    expect(text).not.toContain('node scripts/mantur-cut-windows-cleanup-probe.mjs')
    expect(probe.run).toContain('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }')
    expect(probe['continue-on-error']).toBeUndefined()
    const upload = step('Retain the small diagnostic evidence')
    expect(upload.if).toBe('always()')
    const evidence = '${{ runner.temp }}/windows-cleanup-evidence'
    expect(String(record(upload.with).path).trim().split('\n')).toEqual([
      `${evidence}/SHASUMS256.txt`,
      `${evidence}/RUNTIME-INPUT.json`,
      `${evidence}/CHROME-INPUT.json`,
      `${evidence}/browser-probe/RESULT.json`,
      `${evidence}/browser-probe/logs/*.ndjson`,
      `${evidence}/browser-probe/logs/*.stdout.txt`,
      `${evidence}/browser-probe/logs/*.stderr.txt`,
      `${evidence}/browser-probe/metadata/*.json`,
    ])
    expect(step('Describe diagnostic scope').run).toContain('not that every cleanup case passed')
  })
})
