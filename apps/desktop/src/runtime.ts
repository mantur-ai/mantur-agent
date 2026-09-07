/** Start and supervise the shipped Mantur Web profile inside the Electron runtime. */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const READY_PATTERN = /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/mu
const OUTPUT_LIMIT = 64 * 1_024

/** A running dsh process and its authenticated startup URL. */
export interface DesktopService {
  /** Child process running the shipped dsh CLI through Electron's Node mode, with parent IPC. */
  child: ChildProcessByStdio<null, Readable, Readable>
  /** Resolves after dsh exits and its persistent log finishes closing. */
  closed: Promise<void>
  /** Resolves after Web readiness; rejects only after the failed child and log close. */
  ready: Promise<string>
  /** Request termination, escalating if dsh does not exit within the shutdown deadline. */
  stop: () => void
}

/** Options for starting the desktop-owned dsh process. */
export interface StartDesktopServiceOptions {
  /** Electron executable reused as the Node runtime. */
  electronExecutable: string
  /** Built dsh CLI entry; defaults to the installed workspace dependency. */
  entry?: string
  /** Process environment inherited by dsh before desktop-owned values replace it. */
  environment?: NodeJS.ProcessEnv
  /** Neutral application-owned working directory for the child process. */
  cwd?: string
  /** Persistent combined stdout/stderr diagnostic log. */
  logPath?: string
  /** Also copy dsh stdout and stderr to their parent terminal streams. */
  mirrorOutput?: boolean
  /** Maximum wait for the Web readiness line. */
  timeoutMs?: number
  /** Maximum wait between normal termination and forced termination. */
  shutdownTimeoutMs?: number
}

/** Resolve the built CLI entry from the desktop application's dependency closure. */
export function resolveDshEntry(): string {
  return fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/lib/bin.js'))
}

/** Extract an authenticated loopback URL from accumulated dsh output. */
export function extractReadyUrl(output: string): string | undefined {
  return READY_PATTERN.exec(output)?.[1]
}

/** Build the only supported application launch: the shipped Mantur profile. */
export function buildDshArguments(entry: string): string[] {
  return [
    '--expose-internals',
    entry,
    '--profile',
    'mantur',
    '--host',
    '127.0.0.1',
    '--port',
    '0',
    '--no-open',
  ]
}

/**
 * Start the Mantur profile and wait for its tokenized local URL.
 * @param options - Electron runtime, optional CLI entry, environment, and deadline.
 * @returns supervised child process and readiness promise.
 */
export function startDesktopService(options: StartDesktopServiceOptions): DesktopService {
  const entry = options.entry ?? resolveDshEntry()
  const timeoutMs = options.timeoutMs ?? 60_000
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 2_000
  // Node's IPC overload loses the first three explicit stdio stream types.
  const child = spawn(options.electronExecutable, buildDshArguments(entry), {
    cwd: options.cwd,
    env: {
      ...options.environment,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }) as ChildProcessByStdio<null, Readable, Readable>

  let output = ''
  let settled = false
  let timeout: NodeJS.Timeout | undefined
  let shutdownTimer: NodeJS.Timeout | undefined
  const log = options.logPath === undefined
    ? undefined
    : (() => {
      mkdirSync(dirname(options.logPath), { recursive: true })
      return createWriteStream(options.logPath, { flags: 'a' })
    })()
  log?.on('error', (error) => { console.error(error) })
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => {
      if (shutdownTimer !== undefined) clearTimeout(shutdownTimer)
      if (log === undefined) resolve()
      else log.end(resolve)
    })
  })
  const stop = (): void => {
    if (child.exitCode !== null || child.signalCode !== null || shutdownTimer !== undefined) return
    child.kill('SIGTERM')
    shutdownTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, shutdownTimeoutMs)
    shutdownTimer.unref()
  }
  const ready = new Promise<string>((resolve, reject) => {
    const finish = (): boolean => {
      if (settled) return false
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      return true
    }
    const inspect = (chunk: Buffer | string, destination: NodeJS.WriteStream): void => {
      log?.write(chunk)
      if (options.mirrorOutput === true) destination.write(chunk)
      if (settled) return
      output = `${output}${String(chunk)}`.slice(-OUTPUT_LIMIT)
      const url = extractReadyUrl(output)
      if (url !== undefined && finish()) resolve(url)
    }

    child.stdout.on('data', (chunk: Buffer) => { inspect(chunk, process.stdout) })
    child.stderr.on('data', (chunk: Buffer) => { inspect(chunk, process.stderr) })
    const rejectAfterClose = (error: Error): void => {
      if (!finish()) return
      void closed.then(() => { reject(error) })
    }

    child.once('error', (error) => {
      rejectAfterClose(error)
    })
    child.once('exit', (code, signal) => {
      rejectAfterClose(new Error(
        `dsh stopped before desktop readiness (code ${String(code)}, signal ${String(signal)}).\n${output}`,
      ))
    })
    timeout = setTimeout(() => {
      if (!finish()) return
      stop()
      const error = new Error(`dsh did not become ready within ${String(timeoutMs)}ms.\n${output}`)
      void closed.then(() => { reject(error) })
    }, timeoutMs)
  })

  return {
    child,
    closed,
    ready,
    stop,
  }
}
