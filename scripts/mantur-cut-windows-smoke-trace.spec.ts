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
    await writeFile(join(root, 'fixture.mjs'), `
import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = dirname(fileURLToPath(import.meta.url));
const absent = join(directory, 'missing-native-input');
assert.throws(() => process.dlopen({ exports: {} }, absent), { code: 'ERR_DLOPEN_FAILED' });
const profile = join(directory, 'puppeteer_dev_chrome_profile-中文');
fs.mkdirSync(profile);
fs.writeFileSync(join(profile, 'file'), 'owned');
assert.throws(() => fs.rmSync(profile), { code: 'ERR_FS_EISDIR' });
assert.strictEqual(fs.rmSync(profile, { recursive: true }), undefined);
assert.equal(fs.existsSync(profile), false);
const listener = () => {};
process.on('SIGTERM', listener);
assert.strictEqual(process.off('SIGTERM', listener), process);
assert.equal(process.listeners('SIGTERM').includes(listener), false);
const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
assert(child instanceof ChildProcess);
child.once('error', error => { throw error });
child.once('exit', code => {
  assert.equal(code, 0);
  const missing = spawn(join(directory, 'cmd.exe'), ['/d', '/s', '/c', 'taskkill /pid 123 /T /F'], { stdio: 'ignore' });
  let receivedError = false;
  missing.once('error', error => { assert.equal(error.code, 'ENOENT'); receivedError = true; });
  missing.once('close', () => {
    assert(receivedError);
    const unrelated = spawn(join(directory, 'cmd.exe'), ['/d', '/s', '/c', 'taskkill /pid 123 /T /F & echo must-not-appear-in-diagnostics'], { stdio: 'ignore' });
    unrelated.once('error', error => assert.equal(error.code, 'ENOENT'));
    unrelated.once('close', () => process.report.writeReport());
  });
});
`)
    const result = spawnSync(process.execPath, ['--require', fileURLToPath(new URL('./mantur-cut-windows-smoke-trace.cjs', import.meta.url)), join(root, 'fixture.mjs')], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        MANTUR_CUT_SMOKE_TRACE_DIRECTORY: evidence,
        MANTUR_TRACE_SECRET_PROBE: 'must-not-appear-in-diagnostics' },
      encoding: 'utf8', timeout: 15_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const lines = (await readFile(join(evidence, 'editor-events.ndjson'), 'utf8')).trim().split('\n')
    const records = lines.map(line => JSON.parse(line) as {
      event: string
      childPid?: number
      code?: number
      taskkillTargetPid?: number
      caller?: string
    })
    expect(records.map(record => record.event)).toEqual([
      'start', 'dlopen-call', 'dlopen-throw', 'browser-profile-rm-call', 'browser-profile-rm-throw',
      'browser-profile-rm-call', 'browser-profile-rm-return', 'process-listener-remove-call', 'process-listener-remove-return',
      'spawn-call', 'spawn-return', 'child-exit', 'spawn-call', 'shell-call', 'spawn-return', 'child-error',
      'spawn-call', 'spawn-return', 'child-error', 'exit',
    ])
    expect(records.find(record => record.event === 'spawn-return')?.childPid).toBeGreaterThan(0)
    expect(records.find(record => record.event === 'child-exit')?.code).toBe(0)
    expect(records.find(record => record.event === 'shell-call')?.taskkillTargetPid).toBe(123)
    expect(records.find(record => record.event === 'shell-call')?.caller).toContain('fixture.mjs')
    const report = await readFile(join(evidence, 'editor-fatal.json'), 'utf8')
    expect(report).not.toContain('environmentVariables')
    expect(report).not.toContain('must-not-appear-in-diagnostics')
    expect(lines.join('\n')).not.toContain('must-not-appear-in-diagnostics')
  } finally { await rm(root, { recursive: true, force: true }) }
})
