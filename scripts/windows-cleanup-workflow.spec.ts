/** Keep the cleanup reproduction limited to the existing standalone Windows runtimes. */
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
      paths: ['.github/workflows/desktop-windows-cleanup-probe.yml', 'scripts/mantur-cut-windows-cleanup-probe.mjs'],
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

  it('runs the standalone probe and always retains only diagnostic evidence', () => {
    const probe = step('Diagnose only isolated runtime cleanup cases')
    expect(probe.run).toContain('node scripts/mantur-cut-windows-cleanup-probe.mjs --electron "$env:CLEANUP_PROBE_ELECTRON"')
    expect(probe.run).toContain('--output "$env:RUNNER_TEMP/windows-cleanup-evidence/probe"')
    expect(probe.run).toContain('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }')
    expect(probe['continue-on-error']).toBeUndefined()
    const upload = step('Retain the small diagnostic evidence')
    expect(upload.if).toBe('always()')
    expect(record(upload.with).path).toBe('${{ runner.temp }}/windows-cleanup-evidence/')
    expect(step('Describe diagnostic scope').run).toContain('not that every cleanup case passed')
  })
})
