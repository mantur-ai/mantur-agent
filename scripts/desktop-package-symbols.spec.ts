import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('backs up desktop compiler symbols before release filtering and rejects incomplete backups', () => {
  const suite = fileURLToPath(new URL('../apps/desktop/scripts/package-symbols.test.mjs', import.meta.url))
  const result = spawnSync(process.execPath, ['--test', suite], { encoding: 'utf8' })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
})

it('retains symbols separately from artifacts downloaded for public release assembly', async () => {
  const { readFile } = await import('node:fs/promises')
  const { load } = await import('js-yaml')
  type Step = { uses?: string; with?: { name?: string; path?: string; 'retention-days'?: number } }
  for (const file of ['desktop-package.yml', 'desktop-release.yml']) {
    const workflow = load(await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8')) as { jobs: Record<string, { steps: Step[] }> }
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps)
    const symbols = steps.filter(step => step.uses?.startsWith('actions/upload-artifact') && step.with?.path === 'apps/desktop/dist/symbols/')
    expect(symbols).toHaveLength(file === 'desktop-package.yml' ? 1 : 2)
    for (const step of symbols) {
      expect(step.with?.name).toMatch(/^desktop-symbols-/)
      expect(step.with?.['retention-days']).toBe(90)
    }
    const downloads = steps.filter(step => step.uses?.startsWith('actions/download-artifact'))
    for (const step of downloads) {
      expect(step.with?.name).toBeTruthy()
      expect(step.with?.name).not.toContain('symbols')
    }
  }
})
