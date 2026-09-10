/** Desktop dsh child-process contract and shutdown lifecycle. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildDshArguments, extractReadyUrl, startDesktopService } from '../src/runtime.ts'

const fixture = fileURLToPath(new URL('./fixtures/runtime-child.mjs', import.meta.url))

describe('desktop runtime', () => {
  it('launches only the shipped loopback Mantur profile', () => {
    expect(buildDshArguments('/app/dsh/lib/bin.js')).toEqual([
      '--expose-internals',
      '/app/dsh/lib/bin.js',
      '--profile',
      'mantur',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ])
  })

  it('accepts only a tokenized loopback readiness URL', () => {
    expect(extractReadyUrl('dsh web: http://127.0.0.1:4312/?token=secret-value\n')).toBe(
      'http://127.0.0.1:4312/?token=secret-value',
    )
    expect(extractReadyUrl('dsh web: http://192.168.1.3:4312/?token=secret-value\n')).toBeUndefined()
    expect(extractReadyUrl('dsh web: http://127.0.0.1:4312/\n')).toBeUndefined()
  })

  it('persists output and closes the child before shutdown completes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mantur-desktop-runtime-'))
    const logPath = join(root, 'harness.log')
    const service = startDesktopService({
      electronExecutable: process.execPath,
      entry: fixture,
      logPath,
      timeoutMs: 2_000,
    })

    try {
      await expect(service.ready).resolves.toBe('http://127.0.0.1:4312/?token=desktop-test')
      const reply = once(service.child, 'message', { signal: AbortSignal.timeout(2_000) })
      service.child.send({ type: 'desktop-test/ping' })
      await expect(reply).resolves.toEqual([{ type: 'desktop-test/pong' }, undefined])
      service.stop()
      await service.closed
      if (process.platform === 'win32') expect(service.child.signalCode).toBe('SIGTERM')
      else expect(service.child.exitCode).toBe(0)
      await expect(readFile(logPath, 'utf8')).resolves.toContain('desktop runtime stderr')
    } finally {
      service.stop()
      await service.closed
      await rm(root, { recursive: true, force: true })
    }
  })

  it('closes the child before a readiness timeout rejects', async () => {
    const service = startDesktopService({
      electronExecutable: process.execPath,
      entry: fixture,
      environment: { ...process.env, DESKTOP_TEST_SKIP_READY: '1' },
      timeoutMs: 10,
    })
    let closed = false
    void service.closed.then(() => { closed = true })

    try {
      await expect(service.ready).rejects.toThrow('dsh did not become ready within 10ms')
      expect(closed).toBe(true)
    } finally {
      service.stop()
      await service.closed
    }
  })
})

it('waits for both the Web URL and update IPC readiness, then verifies actual exit and the final log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-update-exit-'))
  const logPath = join(root, 'harness.log')
  const service = startDesktopService({ electronExecutable: process.execPath, entry: fixture,
    environment: { ...process.env, DSH_MANTUR_UPDATE_IPC: '1' }, logPath, timeoutMs: 2_000 })
  let ready = false
  void service.ready.then(() => { ready = true })
  try {
    const pong = once(service.child, 'message', { signal: AbortSignal.timeout(2_000) })
    service.child.send({ type: 'desktop-test/ping' })
    await pong
    expect(ready).toBe(false)
    service.child.send({ type: 'desktop-test/update-ready' })
    await service.ready
    await service.stopAndVerifyExit()
    expect(service.child.exitCode).toBe(0)
    expect(await readFile(logPath, 'utf8')).toContain('desktop update final diagnostic')
  } finally { service.stop(); await service.closed; await rm(root, { recursive: true, force: true }) }
})

it.each(['abnormal', 'deadline', 'log'] as const)('refuses installation after %s exit verification fails', async (failure) => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-update-exit-failure-'))
  const service = startDesktopService({ electronExecutable: process.execPath, entry: fixture,
    environment: { ...process.env, DESKTOP_TEST_UPDATE_EXIT_CODE: failure === 'abnormal' ? '7' : '0',
      DESKTOP_TEST_IGNORE_UPDATE_EXIT: failure === 'deadline' ? '1' : '0' },
    ...(failure === 'log' ? { logPath: root } : {}), shutdownTimeoutMs: 50, timeoutMs: 2_000,
  })
  try {
    await service.ready
    await expect(service.stopAndVerifyExit()).rejects.toThrow(failure === 'abnormal' ? 'normally' : failure === 'deadline' ? 'deadline' : 'EISDIR')
    expect(service.child.exitCode !== null || service.child.signalCode !== null).toBe(true)
  } finally { service.stop(); await service.closed; await rm(root, { recursive: true, force: true }) }
})
