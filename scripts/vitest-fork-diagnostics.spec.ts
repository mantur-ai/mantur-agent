import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each([0, 7])('records Vitest fork exit %i without copying environment or unrelated forks', (exitCode) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fork-diagnostics-'))
  try {
    const directory = join(root, 'vitest', 'dist', 'workers')
    mkdirSync(directory, { recursive: true })
    const worker = join(directory, 'forks.js')
    writeFileSync(worker, `process.exit(${exitCode})\n`)
    const unrelated = join(root, 'other.js')
    writeFileSync(unrelated, 'process.exit(9)\n')
    const output = join(root, 'forks.jsonl')
    const preload = fileURLToPath(new URL('./vitest-fork-diagnostics.cjs', import.meta.url))
    const parent = spawnSync(process.execPath, [
      '--require', preload, '--input-type=module', '-e',
      'import { fork } from "node:child_process"; fork(process.argv[1], ["private-argument"], { execArgv: [] }); fork(process.argv[2], [], { execArgv: [] })',
      worker, unrelated,
    ], {
      env: { ...process.env, DSH_VITEST_FORK_DIAGNOSTICS: output, PRIVATE_CANARY: 'private-environment' },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(parent.error).toBeUndefined()
    expect(parent.signal).toBeNull()
    expect(parent.status, parent.stderr).toBe(0)
    const raw = readFileSync(output, 'utf8')
    const records: unknown[] = raw.trim().split('\n').map(line => JSON.parse(line) as unknown)
    const identity = {
      parentPid: expect.any(Number) as unknown,
      pid: expect.any(Number) as unknown,
      node: process.version,
      platform: process.platform,
    }
    expect(records).toEqual([
      { ...identity, event: 'start' },
      { ...identity, event: 'exit', code: exitCode, signal: null },
    ])
    expect(raw).not.toContain('private-')
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

it('rejects an explicitly empty diagnostic destination', () => {
  const preload = fileURLToPath(new URL('./vitest-fork-diagnostics.cjs', import.meta.url))
  const child = spawnSync(process.execPath, ['--require', preload, '-e', ''], {
    env: { ...process.env, DSH_VITEST_FORK_DIAGNOSTICS: '' },
    encoding: 'utf8',
    timeout: 10_000,
  })
  expect(child.error).toBeUndefined()
  expect(child.signal).toBeNull()
  expect(child.status).toBe(1)
  expect(child.stderr).toContain('DSH_VITEST_FORK_DIAGNOSTICS must name the diagnostic output file')
})
