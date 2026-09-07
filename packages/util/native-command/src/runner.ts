/**
 * Shared no-shell `execFile` runner for host-native OS integrations.
 * @module @deepseek-ai/dsh-native-command/runner
 */

import { execFile } from 'node:child_process'

/** A native child could not be terminated; callers must not treat the failed request as proof of cleanup. */
export class NativeCommandCleanupError extends Error {
  override readonly name = 'NativeCommandCleanupError'
}

/** Testable command boundary; native implementations never invoke a shell. */
export type NativeCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>

/**
 * Run a host command with utf8 stdio, abort propagation, and Windows hide.
 * @param command - executable path or PATH name.
 * @param args - argv (never a shell string).
 * @param signal - caller/connection lifetime; abort requests child termination without proving exit.
 * @returns captured stdout/stderr on exit 0, after the child and its stdio close; failures also wait for close.
 */
export const runNativeCommand: NativeCommandRunner = (command, args, signal) =>
  new Promise((resolve, reject) => {
    let settle!: () => void
    const child = execFile(
      command,
      [...args],
      { encoding: 'utf8', signal, windowsHide: true },
      (error, stdout, stderr) => {
        settle = () => {
          if (error !== null) {
            const failure = Object.assign(new Error(error.message, { cause: error }), {
              code: error.code,
              stdout,
              stderr,
            })
            reject(failure)
            return
          }
          resolve({ stdout, stderr })
        }
      },
    )
    // execFile registers its close listener before returning the child; its callback supplies the outcome first.
    child.once('close', () => { settle() })
  })
