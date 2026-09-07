/** Recorded-session round trip through the shipped Web profile and desktop update IPC. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { parseHeaderMeta } from '../../packages/session/session-persistence-jsonl/src/format.ts'
import { expect, it } from 'vitest'
import { requestUpdateSave } from '../../apps/desktop/src/update-save.ts'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'

it('saves the recorded session through dsh --profile web update IPC before normal exit', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-update-launch-'))
  const profile = join(home, 'profiles', 'web')
  const sessions = join(home, 'sessions')
  const sessionId = SessionId('update-launch')
  const fixtureText = await readFile(new URL('./update-save/session.jsonl', import.meta.url), 'utf8')
  const materialized = fixtureText.replaceAll('{{session:1}}', sessionId).replaceAll('{{message:1}}', 'update-message-1')
  const events = parseSessionLog(materialized)
  const header = parseHeaderMeta(materialized.split('\n')[0]!)
  if (!header) throw new Error('update snapshot requires a valid session header')
  const seed = new Context()
  await seed.plugin(Sessions)
  await seed.plugin(Persistence, { root: sessions, compression: 'none' })
  const writer = await seed.sessionPersistence.create(header)
  await writer.append(events)
  await writer.close()
  await seed.fiber.dispose()
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'startup' } } }))
  const modules = ['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent']
  const rows = modules.map(name => ({ id: `update-${name}`, name: `@deepseek-ai/dsh-${name}` }))
  const repository = fileURLToPath(new URL('../../', import.meta.url))
  const shipped = composeEntries(['base', 'web-app'].map(name => loadOverlayPatches('update snapshot', join(repository, 'packages/bundle', name, 'cordis.patch.yml'))))
  // This scenario selects only managed owners from the shipped Web profile.
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([...shipped.map(row => ({ id: row.id, disabled: true })), { insert: [
    ...rows,
    { id: 'update-sessions', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: sessions, compression: 'none' } },
    { id: 'update-loop', name: '@deepseek-ai/dsh-agent-loop', config: { agents: [{ id: 'proof', sessionId }] } },
  ] }]))
  const nodeArgs = process.env.DSH_EXAMPLE_MODE === 'lib'
    ? [fileURLToPath(new URL('../../apps/cli/lib/bin.js', import.meta.url))]
    : ['--expose-internals', '--import', import.meta.resolve('tsx/esm'), fileURLToPath(new URL('../../apps/cli/src/bin.ts', import.meta.url))]
  const child = spawn(process.execPath, [...nodeArgs, '--profile', 'web'], {
    cwd: home, env: { TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)), PATH: process.env.PATH, DSH_HOME: home, DSH_MANTUR_UPDATE_IPC: '1', DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let output = ''
  child.stdout!.on('data', (chunk: Buffer) => { output += String(chunk) })
  child.stderr!.on('data', (chunk: Buffer) => { output += String(chunk) })
  const closed = once(child, 'close')
  try {
    const ready: unknown = (await once(child, 'message', { signal: AbortSignal.timeout(10_000) }).catch((error: unknown) => { throw new Error(output || 'Host sent no startup output', { cause: error }) }))[0]
    expect(ready, output).toEqual({ type: 'mantur:update:ready' })
    const checkpoints = await requestUpdateSave({ child, timeoutMs: 10_000 })
    // An admitted restore can finish or roll back before publication; both must preserve this log.
    expect(checkpoints.every(checkpoint => checkpoint.sessionId === sessionId && checkpoint.nextSeq === events.length), output).toBe(true)
    expect(child.exitCode).toBeNull()
    const exited = once(child, 'close', { signal: AbortSignal.timeout(5_000) })
    child.send({ type: 'mantur:update:exit' })
    expect(await exited, output).toEqual([0, null])
    const verify = new Context()
    await verify.plugin(Persistence, { root: sessions, compression: 'none' })
    try {
      const stored = await verify.sessionPersistence.open(sessionId, 'read')
      try {
        const persisted = await stored.read()
        expect(persisted).toEqual(events)
        expect(stored.header).toEqual(header)
        for (const checkpoint of checkpoints) expect(checkpoint.nextSeq).toBe(persisted.length)
      } finally { await stored.close() }
      // The saved log remains writable after the owned Host exits.
      const reopened = await verify.sessionPersistence.open(sessionId, 'write')
      await reopened.close()
    } finally { await verify.fiber.dispose() }
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toContain('session-persistence-jsonl')
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await closed
    await rm(home, { recursive: true, force: true })
  }
}, 20_000)
