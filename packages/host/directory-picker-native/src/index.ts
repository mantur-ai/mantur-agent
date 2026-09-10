/**
 * Native backend of the directory-picker seam: registers `ctx.directoryPicker`
 * with the `native` capability, opening one native OS chooser on the host
 * display per pick (macOS `osascript`, Linux Zenity with a KDialog fallback;
 * Windows opens the modern `IFileOpenDialog` in a spawned child process — a
 * koffi-driven COM conversation on the child's main thread). Only viable when
 * the operator sits at the host's screen; remote deployments compose the
 * browse backend instead.
 * @module @deepseek-ai/dsh-host-directory-picker-native
 */

import { Context } from '@deepseek-ai/cordis'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import { NativeCommandCleanupError } from '@deepseek-ai/dsh-native-command'
import { pickNativeDirectory } from './native-picker.ts'

export type { DirectoryPickerInternals, DirectoryPickerRunner } from './native-picker.ts'
export { pickNativeDirectory } from './native-picker.ts'

/** The `ctx.directoryPicker` native implementation (stable capability object per service life). */
export default class NativeDirectoryPicker extends DirectoryPicker {
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<string | null>>()
  private readonly cleanupFailures: unknown[] = []
  private shutdown: Promise<void> | undefined
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    pick: signal => this.pick(signal),
    stopForShutdown: () => this.stopForShutdown(),
  }

  /** @param ctx - Host context owning this chooser service and its active requests. */
  constructor(ctx: Context) {
    super(ctx)
    ctx.effect(() => () => this.stopForShutdown(), 'directoryPicker.native')
  }

  private pick(signal: AbortSignal): Promise<string | null> {
    if (this.lifetime.signal.aborted) return Promise.reject(new Error('native directory picker is stopping'))
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the caller's arbitrary cancellation reason.
    if (signal.aborted) return Promise.reject(signal.reason)
    const operation = pickNativeDirectory(AbortSignal.any([signal, this.lifetime.signal]))
      .catch((error: unknown) => {
        if (error instanceof NativeCommandCleanupError) this.cleanupFailures.push(error)
        throw error
      })
      .finally(() => { this.pending.delete(operation) })
    this.pending.add(operation)
    return operation
  }

  private stopForShutdown(): Promise<void> {
    this.shutdown ??= (async () => {
      this.lifetime.abort()
      await Promise.allSettled([...this.pending])
      if (this.cleanupFailures.length > 0) {
        throw new AggregateError(this.cleanupFailures, 'native directory picker cleanup failed')
      }
    })()
    return this.shutdown
  }

  /**
   * The native interaction capability.
   * @returns the stable `native` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}
