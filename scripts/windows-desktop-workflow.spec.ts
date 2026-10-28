/** Check the Windows candidate's release isolation and execute its media-run gate. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected workflow mapping')
  return value as Record<string, unknown>
}

const text = readFileSync(fileURLToPath(new URL('../.github/workflows/desktop-windows-release.yml', import.meta.url)), 'utf8')
const workflow = record(load(text))
const jobs = record(workflow.jobs)
const windows = record(jobs.windows)
const steps = (windows.steps as unknown[]).map(record)
function step(name: string): Record<string, unknown> {
  const value = steps.find(item => item.name === name)
  if (!value) throw new Error(`Missing workflow step: ${name}`)
  return value
}
const validation = String(record(step('Validate approved media run and committed source pins').with).script)

function validationFixture() {
  const pins = { formatVersion: 1, runId: '123456', runAttempt: '2', headSha: 'a'.repeat(40) }
  const working = new Map<string, Buffer>([
    ['apps/desktop/package.json', Buffer.from(JSON.stringify({ version: '1.0.0' }))],
    ['apps/desktop/mantur-cut/source.win32-x64.json', Buffer.from(JSON.stringify({ formatVersion: 3, nativeMedia: { target: 'win32-x64' } }))],
    ['apps/desktop/mantur-cut/windows-media-ci.json', Buffer.from(JSON.stringify(pins))],
  ])
  const committed = new Map(working)
  const run = {
    id: 123456, run_attempt: 2, status: 'completed', conclusion: 'success', head_sha: pins.headSha,
    repository: { full_name: 'mantur-ai/mantur-agent' }, head_repository: { full_name: 'mantur-ai/mantur-agent' },
    path: '.github/workflows/desktop-windows-media.yml',
  }
  const artifact = { id: 456, name: 'windows-media-candidate-123456-2', expired: false,
    workflow_run: { head_sha: pins.headSha }, digest: 'sha256:' + 'b'.repeat(64) }
  const env = { PUBLISH: 'false', MEDIA_RUN_ID: pins.runId, MEDIA_RUN_ATTEMPT: pins.runAttempt,
    MEDIA_SHA: pins.headSha, MAC_BASELINE: 'c'.repeat(40), WINDOWS_RELEASE_EVIDENCE: '/fixture/evidence' }
  const outputs = new Map<string, string>()
  const writes = new Map<string, string>()
  const requests: unknown[] = []
  const state = { pins, working, committed, run, artifacts: [artifact], env, outputs, writes, requests,
    eventName: 'workflow_dispatch', rejectAncestor: false }
  const requireFixture = (name: string): unknown => {
    if (name === 'node:path') return { join }
    if (name === 'node:fs') return {
      readFileSync: (path: string) => { const bytes = working.get(path); if (!bytes) throw new Error('Missing fixture file'); return bytes },
      mkdirSync: () => {}, writeFileSync: (path: string, value: string) => { writes.set(path, value) },
    }
    if (name === 'node:child_process') return { execFileSync: (_binary: string, args: string[]) => {
      if (args[0] === 'show') return committed.get(args[1]!.slice('HEAD:'.length))
      if (args[0] !== 'merge-base' || state.rejectAncestor) throw new Error('Not an ancestor')
      return Buffer.from('')
    } }
    throw new Error(`Unexpected fixture module: ${name}`)
  }
  return { ...state, execute: async () => {
    // The workflow script receives only fixture I/O and API objects; no process or network handles escape.
    await runInNewContext(`(async () => {${validation}\n})()`, {
      require: requireFixture, process: { env },
      context: { repo: { owner: 'mantur-ai', repo: 'mantur-agent' }, get eventName() { return state.eventName } },
      core: { setOutput: (name: string, value: string) => { outputs.set(name, value) } },
      github: {
        request: async (route: string, args: unknown) => { requests.push({ route, args }); return { data: run } },
        paginate: async () => state.artifacts,
      },
    }, { timeout: 1000 })
  }, state }
}

describe('Windows unsigned desktop candidate', () => {
  it('is native Windows, read-only and cannot publish or touch Mac jobs', () => {
    expect(Object.keys(jobs)).toEqual(['windows'])
    expect(windows['runs-on']).toBe('windows-2025')
    expect(record(windows.defaults).run).toEqual({ shell: 'pwsh' })
    expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' })
    expect(windows.environment).toBeUndefined()
    expect(record(windows.env).CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
    expect(text).not.toMatch(
      /secrets\.|contents: write|actions: write|gh release|desktop-publish-tos|CSC_LINK|CSC_KEY_PASSWORD|runs-on: macos/,
    )
    const triggers = record(workflow.on)
    expect(record(triggers.push)).toEqual({
      branches: ['feat/desktop-windows-release-1-0-0-harness'],
      paths: [
        'apps/desktop/mantur-cut/source.win32-x64.json',
        '.github/workflows/desktop-windows-release.yml',
        'scripts/mantur-cut-windows-smoke.mjs',
        'apps/desktop/scripts/smoke-installed-windows.ps1',
      ],
    })
    expect(record(record(record(triggers.workflow_dispatch).inputs).publish).default).toBe(false)
  })

  it('resolves runner paths in a step after job dispatch', () => {
    for (const value of Object.values(record(windows.env))) {
      expect(String(value)).not.toMatch(/\$\{\{\s*(?:runner|env|steps|job)\b/)
    }
    const initialize = step('Initialize Windows candidate paths')
    expect(initialize.run).toContain('"MANTUR_MEDIA_INPUT_DIR=$(Join-Path $env:RUNNER_TEMP \'windows-media-inputs\')" >> $env:GITHUB_ENV')
    expect(initialize.run).toContain('"WINDOWS_RELEASE_EVIDENCE=$(Join-Path $env:RUNNER_TEMP \'windows-release-evidence\')" >> $env:GITHUB_ENV')
    expect(steps.indexOf(initialize)).toBeLessThan(steps.indexOf(step('Validate approved media run and committed source pins')))
  })

  it('uses full Git history, exact artifact identity and pinned native input paths', () => {
    expect(record(steps.find(item => item.uses === 'actions/checkout@v6')?.with)).toMatchObject({ 'fetch-depth': 0, 'persist-credentials': false })
    expect(record(step('Download the exact approved media artifact').with)).toMatchObject({
      'artifact-ids': '${{ steps.media.outputs.artifact_id }}', 'run-id': '${{ steps.media.outputs.run_id }}', 'digest-mismatch': 'error',
    })
    expect(step('Verify local media bytes and recipe commit before building').run).toContain("verified['recipeCommit'] != os.environ['APPROVED_MEDIA_SHA']")
    expect(step('Verify local media bytes and recipe commit before building').run).toContain('sources.media_inputs.verify_archive_file(inputs / name, record)')
    expect(record(step('Install Windows PE inspection tool').with).install).toBe('mingw-w64-ucrt-x86_64-binutils')
    expect(step('Bind the native objdump executable').run).toContain("'ucrt64/bin/objdump.exe'")
  })

  it('gates candidate upload on native media, installed-main and unsigned evidence', () => {
    const probe = step('Probe startup log sampling with native PowerShell')
    expect(probe.run).toContain("$node.Name -eq 'Get-InstalledReadyUrl'")
    expect(probe.run).toContain('$probe.cases.empty = $null -eq (Get-InstalledReadyUrl $path)')
    expect(probe.run).toContain('$probe.cases.ready = $null -ne $ready -and $ready.AbsoluteUri -eq $expected')
    expect(steps.indexOf(probe)).toBeLessThan(steps.indexOf(step('Validate approved media run and committed source pins')))
    expect(step('Install immutable dependencies').run).toBe('pnpm install --frozen-lockfile')
    expect(step('Build unsigned Windows NSIS installer').run).toContain('pnpm run desktop:dist:win:x64')
    expect(step('Verify exact unsigned Authenticode identities').run).toContain("$signature.Status -ne 'NotSigned'")
    expect(step('Smoke actual Windows media export').run).toContain('scripts/mantur-cut-windows-smoke.mjs')
    expect(step('Smoke installed unsigned desktop startup and normal exit').run).toContain('smoke-installed-windows.ps1')
    const assemble = String(step('Assemble Windows candidate and corresponding sources').run)
    expect(assemble).toContain('--smoke-report "$env:WINDOWS_RELEASE_EVIDENCE/installed/RESULT.json"')
    expect(assemble).toContain('SHA256SUMS-Windows.txt')
    expect(assemble).toContain("'installed/RESULT.json', 'media/RESULT.json'")
    expect(assemble).toContain('Mantur-Media-Windows-x64.tar.gz')
    const upload = step('Retain exact candidate for independent promotion')
    expect(upload.if).toBeUndefined()
    expect(record(upload.with).path).toBe('${{ runner.temp }}/windows-candidate/')
    for (const name of ['Retain exact desktop debugging symbols', 'Retain candidate evidence']) {
      expect(step(name).if).toBe('always()')
      expect(record(step(name).with)['if-no-files-found']).toBe('error')
    }
    expect(steps.indexOf(upload)).toBeGreaterThan(steps.indexOf(step('Assemble Windows candidate and corresponding sources')))
  })

  it('accepts only the committed successful media attempt and emits its exact artifact ID', async () => {
    const fixture = validationFixture()
    await fixture.execute()
    expect(fixture.outputs.get('artifact_id')).toBe('456')
    expect(fixture.outputs.get('media_sha')).toBe(fixture.pins.headSha)
    expect(fixture.requests).toEqual([{ route: 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}',
      args: { owner: 'mantur-ai', repo: 'mantur-agent', run_id: 123456, attempt_number: 2 } }])
    expect(JSON.parse(fixture.writes.get(join('/fixture/evidence', 'MEDIA-RUN.json'))!).artifact.id).toBe(456)
    fixture.state.eventName = 'push'
    fixture.env.MEDIA_RUN_ID = ''
    fixture.env.MEDIA_RUN_ATTEMPT = ''
    fixture.env.MEDIA_SHA = ''
    await fixture.execute()
    expect(fixture.outputs.get('run_id')).toBe('123456')
  })

  it('rejects publication, run substitutions, failed media and mismatched artifacts before output', async () => {
    const mutations: Array<[string, (fixture: ReturnType<typeof validationFixture>) => void]> = [
      ['publish', (fixture) => { fixture.env.PUBLISH = 'true' }],
      ['dispatch run', (fixture) => { fixture.env.MEDIA_RUN_ID = '654321' }],
      ['dispatch attempt', (fixture) => { fixture.env.MEDIA_RUN_ATTEMPT = '1' }],
      ['dispatch commit', (fixture) => { fixture.env.MEDIA_SHA = 'f'.repeat(40) }],
      ['ancestor', (fixture) => { fixture.state.rejectAncestor = true }],
      ['running', (fixture) => { fixture.run.status = 'in_progress' }],
      ['failed', (fixture) => { fixture.run.conclusion = 'failure' }],
      ['run commit', (fixture) => { fixture.run.head_sha = 'f'.repeat(40) }],
      ['run attempt', (fixture) => { fixture.run.run_attempt = 3 }],
      ['fork', (fixture) => { fixture.run.head_repository.full_name = 'other/fork' }],
      ['workflow', (fixture) => { fixture.run.path = '.github/workflows/desktop-release.yml' }],
      ['expired', (fixture) => { fixture.artifacts[0]!.expired = true }],
      ['artifact commit', (fixture) => { fixture.artifacts[0]!.workflow_run.head_sha = 'f'.repeat(40) }],
      ['artifact digest', (fixture) => { fixture.artifacts[0]!.digest = '' }],
      ['duplicate artifact', (fixture) => { fixture.artifacts.push({ ...fixture.artifacts[0]! }) }],
      ['missing artifact', (fixture) => { fixture.artifacts.splice(0) }],
      ['working copy changed', (fixture) => { fixture.working.set('apps/desktop/package.json', Buffer.from('{"version":"0.1.20"}')) }],
    ]
    for (const [name, mutate] of mutations) {
      const fixture = validationFixture()
      mutate(fixture)
      await expect(fixture.execute(), name).rejects.toThrow()
      expect(fixture.outputs.size, name).toBe(0)
      expect(fixture.writes.size, name).toBe(0)
    }
  })
})
