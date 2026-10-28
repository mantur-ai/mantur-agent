/** Verify that media-smoke diagnostics preserve the observed calls and exclude environment values. */
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('records real child and native-load failures without intercepting error delivery or including environment values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-smoke-trace-'))
  try {
    const evidence = join(root, 'evidence')
    await mkdir(evidence)
    await writeFile(join(root, 'fixture.cjs'), `
const assert = require('node:assert/strict');
const { ChildProcess, spawn } = require('node:child_process');
const { join } = require('node:path');
const absent = join(__dirname, 'missing-native-input');
assert.throws(() => process.dlopen({ exports: {} }, absent), { code: 'ERR_DLOPEN_FAILED' });
const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
assert(child instanceof ChildProcess);
child.once('error', error => { throw error });
child.once('exit', code => {
  assert.equal(code, 0);
  const missing = spawn(absent, [], { stdio: 'ignore' });
  let receivedError = false;
  missing.once('error', error => { assert.equal(error.code, 'ENOENT'); receivedError = true; });
  missing.once('close', () => { assert(receivedError); process.report.writeReport(); });
});
`)
    const result = spawnSync(process.execPath, ['--require', fileURLToPath(new URL('./mantur-cut-windows-smoke-trace.cjs', import.meta.url)), join(root, 'fixture.cjs')], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        MANTUR_CUT_SMOKE_TRACE_DIRECTORY: evidence,
        MANTUR_TRACE_SECRET_PROBE: 'must-not-appear-in-diagnostics' },
      encoding: 'utf8', timeout: 15_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const lines = (await readFile(join(evidence, 'editor-events.ndjson'), 'utf8')).trim().split('\n')
    const records = lines.map(line => JSON.parse(line) as { event: string; childPid?: number; code?: number })
    expect(records.map(record => record.event)).toEqual([
      'start', 'dlopen-call', 'dlopen-throw', 'spawn-call', 'spawn-return', 'child-exit',
      'spawn-call', 'spawn-return', 'child-error', 'exit',
    ])
    expect(records.find(record => record.event === 'spawn-return')?.childPid).toBeGreaterThan(0)
    expect(records.find(record => record.event === 'child-exit')?.code).toBe(0)
    const report = await readFile(join(evidence, 'editor-fatal.json'), 'utf8')
    expect(report).not.toContain('environmentVariables')
    expect(report).not.toContain('must-not-appear-in-diagnostics')
    expect(lines.join('\n')).not.toContain('must-not-appear-in-diagnostics')
  } finally { await rm(root, { recursive: true, force: true }) }
})
