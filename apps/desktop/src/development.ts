/** Incremental compiler, bundler, and Electron lifecycle for desktop development. */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const FORCE_STOP_DELAY_MS = 4_000

/** One executable stage in the desktop development restart cycle. */
export interface DesktopDevelopmentStage {
  /** Human-readable operation printed before the process starts. */
  label: string
  /** Executable started without an intermediate shell. */
  command: string
  /** Arguments passed to the executable. */
  args: string[]
}

/** Running process owned by one desktop development stage. */
export interface DesktopDevelopmentProcess {
  /** Exit status after normal process completion. */
  readonly exitCode: number | null
  /** Terminating signal after signal-driven process completion. */
  readonly signalCode: NodeJS.Signals | null
  /** Process completion including its final status. */
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  /** Send one termination signal to the process. */
  kill: (signal: NodeJS.Signals) => boolean
}

/** Start function injected by lifecycle tests. */
export type StartDesktopDevelopmentStage = (
  stage: DesktopDevelopmentStage,
  cwd: string,
) => DesktopDevelopmentProcess

function packageBin(packageName: string, binName: string): string {
  const manifestPath = require.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
  if (typeof manifest !== 'object' || manifest === null || !('bin' in manifest)) {
    throw new Error(`${packageName} does not declare an executable`)
  }
  const bin = manifest.bin
  const candidate = typeof bin === 'object' && bin !== null && binName in bin
    ? (bin as Record<string, unknown>)[binName]
    : undefined
  const relative = typeof bin === 'string' ? bin : typeof candidate === 'string' ? candidate : undefined
  if (relative === undefined) throw new Error(`${packageName} does not declare the ${binName} executable`)
  return resolve(dirname(manifestPath), relative)
}

function electronExecutable(): string {
  const executable = require('electron') as unknown
  if (typeof executable !== 'string') throw new Error('electron did not provide its executable path')
  return executable
}

/** Resolve the compile, bundle, and Electron stages used by each watched restart. */
export function desktopDevelopmentStages(): DesktopDevelopmentStage[] {
  return [
    {
      label: 'incremental TypeScript compile',
      command: process.execPath,
      args: [require.resolve('typescript/bin/tsc'), '-b', 'tsconfig.json'],
    },
    {
      label: 'desktop bundle',
      command: process.execPath,
      args: [packageBin('tsdown', 'tsdown')],
    },
    {
      label: 'embedded CLI',
      command: process.execPath,
      args: ['--import', 'tsx/esm', 'scripts/prepare-cli.ts'],
    },
    {
      label: 'Electron',
      command: electronExecutable(),
      args: ['.'],
    },
  ]
}

/** Own one compile, bundle, and Electron cycle and stop its current process on restart. */
export class DesktopDevelopmentRunner {
  private active: DesktopDevelopmentProcess | undefined
  private forceStopTimer: NodeJS.Timeout | undefined
  private stopping = false

  constructor(
    private readonly stages: DesktopDevelopmentStage[],
    private readonly start: StartDesktopDevelopmentStage,
    private readonly cwd: string,
  ) {}

  private isStopping(): boolean {
    return this.stopping
  }

  /** Run stages in order and return the first failing process status. */
  async run(): Promise<number> {
    for (const stage of this.stages) {
      if (this.isStopping()) return 0
      console.log(`[desktop:dev] ${stage.label}`)
      const child = this.start(stage, this.cwd)
      this.active = child
      const result = await child.closed.finally(() => {
        if (this.forceStopTimer !== undefined) clearTimeout(this.forceStopTimer)
        this.forceStopTimer = undefined
        if (this.active === child) this.active = undefined
      })
      if (this.isStopping()) return 0
      if (result.code !== 0) {
        console.error(`[desktop:dev] ${stage.label} failed (code ${String(result.code)}, signal ${String(result.signal)})`)
        return result.code ?? 1
      }
    }
    return 0
  }

  /** Stop the active stage and force it down if graceful termination stalls. */
  stop(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.stopping) return
    this.stopping = true
    const child = this.active
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
    child.kill(signal)
    this.forceStopTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, FORCE_STOP_DELAY_MS)
    this.forceStopTimer.unref()
  }
}
