/** Versioned script files exchanged with the current Session's workspace. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque provider generation projected into the script Remote protocol. */
export type ScriptVersion = Branded<'ScriptVersion'>

/** A UTF-8 document normalized to LF for browser selection offsets. */
export interface ScriptDocument {
  readonly path: string
  readonly version: ScriptVersion
  readonly content: string
}

/** Direct children of a selected project folder; directories are navigable. */
export interface ScriptEntry {
  readonly path: string
  readonly name: string
  readonly directory: boolean
}

/** Exact UTF-16 selection in one observed file generation. */
export interface ScriptSelection {
  readonly path: string
  readonly version: ScriptVersion
  readonly start: number
  readonly end: number
  readonly selected: string
}

/** A full draft carrying the file generation it may replace. */
export interface ScriptWrite {
  readonly path: string
  readonly version: ScriptVersion
  readonly content: string
}
