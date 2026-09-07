/** Narrow native updater messages; absent capability means the browser has no installer controls. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Native update status, mirroring the desktop controller's serialized state. */
export type NativeUpdateState =
  | { kind: 'idle' | 'checking' }
  | { kind: 'available'; version: string; prompting: boolean }
  | { kind: 'downloading'; version: string; percent: number | null; transferred: number; total: number | null }
  | { kind: 'ready'; version: string; prompting: boolean; error?: string }
  | { kind: 'up-to-date'; requestedByUser: boolean }
  | { kind: 'error'; detail: string; requestedByUser: boolean }

/** Monotonic main-process snapshot, including whether this build supports update actions. */
export interface NativeUpdateSnapshot {
  revision: number
  state: NativeUpdateState
  enabled: boolean
  currentVersion: string
}

/** Fixed actions exposed by the sandboxed preload; installation always prompts in main. */
export interface NativeUpdateBridge {
  getSnapshot(): Promise<NativeUpdateSnapshot>
  subscribe(listener: (snapshot: NativeUpdateSnapshot) => void): () => void
  check(this: void): Promise<void>
  download(this: void): Promise<void>
  install(this: void): Promise<void>
}

declare global {
  interface Window { manturUpdates?: NativeUpdateBridge }
}

/** UI status derived from the latest native snapshot and any failed IPC action. */
export interface NativeUpdateView {
  snapshot?: NativeUpdateSnapshot
  failure?: string
}

/** Own one native subscription outside React; late snapshots never replace newer events. */
export class NativeUpdates {
  /** Latest native snapshot and an observable action failure. */
  readonly store = createSnapshotStore<NativeUpdateView>({})
  private readonly unsubscribe: () => void
  private disposed = false

  /** @param bridge - The actual desktop preload capability. */
  constructor(private readonly bridge: NativeUpdateBridge) {
    this.unsubscribe = bridge.subscribe((snapshot) => { this.accept(snapshot) })
    void bridge.getSnapshot().then((snapshot) => { this.accept(snapshot) }).catch((error: unknown) => { this.fail(error) })
  }

  private accept(snapshot: NativeUpdateSnapshot): void {
    if (this.disposed) return
    const previous = this.store.getSnapshot().snapshot
    if (previous !== undefined && snapshot.revision <= previous.revision) return
    this.store.set({ snapshot })
  }

  private fail(error: unknown): void {
    if (!this.disposed) this.store.set({ ...this.store.getSnapshot(), failure: error instanceof Error ? error.message : String(error) })
  }

  /**
   * Request an explicit native action; the main controller owns duplicate and confirmation guards.
   * @param action - Named updater action.
   */
  run(action: 'check' | 'download' | 'install'): void {
    if (this.disposed) return
    void this.bridge[action]().catch((error: unknown) => { this.fail(error) })
  }

  /** Detach native events and ignore completions after plugin unload. */
  dispose(): void { this.disposed = true; this.unsubscribe() }
}
