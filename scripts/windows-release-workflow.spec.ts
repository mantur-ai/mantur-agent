/** Keep the Windows media candidate lane isolated from desktop publication. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected workflow mapping')
  return value as Record<string, unknown>
}

describe('Windows media candidate publication isolation', () => {
  const text = readFileSync(fileURLToPath(new URL('../.github/workflows/desktop-windows-media.yml', import.meta.url)), 'utf8')
  const workflow = record(load(text))
  const jobs = record(workflow.jobs)
  const media = record(jobs.media)
  const steps = (media.steps as unknown[]).map(record)

  it('uses native Windows jobs without release permissions or credentials', () => {
    expect(Object.keys(jobs).sort()).toEqual(['baseline', 'media'])
    for (const job of Object.values(jobs).map(record)) {
      expect(job['runs-on']).toBe('windows-2025')
      expect(job.environment).toBeUndefined()
    }
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(record(jobs.baseline).if).toBe('inputs.inspect_baseline == true')
    expect(text).not.toMatch(/secrets\.|contents: write|gh release|desktop-publish-tos|macos-/)
    expect(record(media.defaults).run).toEqual({ shell: 'pwsh' })
  })

  it('builds source inputs in UCRT64 and retains evidence even on failure', () => {
    const build = steps.find(step => step.name === 'Build and verify Windows media candidate')
    expect(build?.shell).toBe('msys2 {0}')
    expect(build?.run).toContain('set -euo pipefail')
    expect(build?.run).toContain('/usr/bin/python3 scripts/mantur-media-build-windows.py')
    const evidence = steps.find(step => step.name === 'Retain native build and probe evidence')
    expect(evidence?.if).toBe('always()')
    expect(record(evidence?.with)['if-no-files-found']).toBe('error')
    const artifacts = record(steps.find(step => step.name === 'Retain unsigned media inputs and corresponding sources')?.with)
    expect(artifacts.path).toContain('Mantur-Media-Windows-x64.tar.gz')
    expect(artifacts.path).toContain('Mantur-Media-Windows-corresponding-source.tar.gz')
  })
})
