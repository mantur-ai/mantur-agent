/** Real Vitest subprocesses verify synchronous diagnostic records survive an abruptly exiting test worker. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// The child owns a 30-second deadline, including Vitest's cleanup after worker death.
it.each([false, true])('persists selected case phases when abrupt exit is %s', { timeout: 40_000 }, (abrupt) => {
  const repository = fileURLToPath(new URL('../', import.meta.url))
  const artifacts = join(repository, '.artifacts')
  mkdirSync(artifacts, { recursive: true })
  const root = mkdtempSync(join(artifacts, 'workflow-reporter-'))
  try {
    const directory = join(root, 'packages/workflow/workflow-worker-thread/tests')
    mkdirSync(directory, { recursive: true })
    const target = join(directory, 'workflow-worker-thread.spec.ts')
    writeFileSync(target, `import { it, expect } from 'vitest';\nit('diagnostic case', () => { ${abrupt ? "process.kill(process.pid, 'SIGKILL')" : 'expect(1).toBe(1)'} });\n`)
    const unrelated = join(root, 'unrelated.spec.ts')
    writeFileSync(unrelated, "import { it } from 'vitest'; it('private-unrelated-title', () => {});\n")
    const configuration = join(root, 'vitest.config.mjs')
    writeFileSync(configuration, `export default ${JSON.stringify({ test: { include: [target, unrelated].map(path => path.replaceAll('\\', '/')), setupFiles: [join(repository, 'scripts/workflow-case-setup.ts')], pool: 'forks', maxWorkers: 1, fileParallelism: false } })}\n`)
    const output = join(root, 'cases.jsonl')
    const result = spawnSync(process.execPath, ['--require', join(repository, 'scripts/vitest-fork-diagnostics.cjs'), join(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', configuration,
      '--reporter=default', `--reporter=${join(repository, 'scripts/workflow-case-reporter.ts')}`], {
      cwd: repository, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, DSH_WORKFLOW_CASE_DIAGNOSTICS: output, DSH_VITEST_FORK_DIAGNOSTICS: output + '.forks.jsonl', PRIVATE_CANARY: 'private-environment' },
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stdout + result.stderr).toBe(abrupt ? 1 : 0)
    const raw = readFileSync(output, 'utf8')
    const records = raw.trim().split('\n').map(line => JSON.parse(line) as { event: string; name?: string; parentPid: number })
    expect(records.some(record => record.event === 'module-collected')).toBe(true)
    if (!abrupt) expect(records.some(record => record.event === 'case-ready' && record.name === 'diagnostic case')).toBe(true)
    const workerRaw = readFileSync(output + '.worker.jsonl', 'utf8')
    const phases = workerRaw.trim().split('\n').map(line => JSON.parse(line) as { event: string; name: string; pid: number })
    expect(phases.some(record => record.event === 'before-each' && record.name === 'diagnostic case')).toBe(true)
    expect(phases.some(record => record.event === 'after-each')).toBe(!abrupt)
    expect(workerRaw).not.toContain('private-')
    const exits = readFileSync(output + '.forks.jsonl', 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as { event: string; pid: number; code: number | null; signal: string | null })
      .filter(record => record.event === 'exit' && record.pid === phases[0]?.pid)
    expect(exits).toHaveLength(1)
    if (abrupt) expect(exits[0]?.code !== 0 || exits[0]?.signal !== null).toBe(true)
    expect(records.some(record => record.event === 'case-result')).toBe(!abrupt)
    expect(new Set(records.map(record => record.parentPid)).size).toBe(1)
    expect(raw).not.toContain('private-')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
