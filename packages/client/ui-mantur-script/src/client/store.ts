/** Session-indexed document drafts survive content switches and panel remounts. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { ScriptDocument } from '../types.ts'

/** Editable text and its last observed file generation. */
export interface Draft {
  readonly base: ScriptDocument
  readonly text: string
  readonly previous?: ScriptDocument
  readonly conflict?: ScriptDocument
}
/** Shared workbench viewing state; saved files remain owned by the Host. */
export interface WorkbenchState {
  views: Record<string, 'script' | 'editing'>
  paths: Record<string, string>
  drafts: Record<string, Record<string, Draft>>
}
const workbenchActions = {
  select: (d: WorkbenchState, session: string, view: 'script' | 'editing') => { d.views[session] = view },
  open: (d: WorkbenchState, session: string, document: ScriptDocument) => {
    d.paths[session] = document.path
    const drafts = d.drafts[session] ??= {}
    drafts[document.path] ??= { base: document, text: document.content }
  },
  edit: (d: WorkbenchState, session: string, path: string, text: string) => {
    const drafts = d.drafts[session]
    const entry = drafts?.[path]
    if (drafts !== undefined && entry !== undefined) drafts[path] = { ...entry, text }
  },
  observed: (d: WorkbenchState, session: string, document: ScriptDocument) => {
    const drafts = d.drafts[session]
    const entry = drafts?.[document.path]
    if (drafts === undefined || entry === undefined || document.version === entry.base.version) return
    drafts[document.path] = entry.text === entry.base.content
      ? { base: document, text: document.content, previous: entry.base }
      : { ...entry, conflict: document }
  },
  saved: (d: WorkbenchState, session: string, before: Draft, document: ScriptDocument) => {
    const drafts = d.drafts[session]
    const entry = drafts?.[document.path]
    if (drafts === undefined || entry === undefined) return
    drafts[document.path] = {
      base: document,
      text: entry.text === before.text ? document.content : entry.text,
      previous: before.base,
    }
  },
  useDisk: (d: WorkbenchState, session: string, path: string) => {
    const drafts = d.drafts[session]
    const entry = drafts?.[path]
    if (drafts !== undefined && entry?.conflict !== undefined) {
      drafts[path] = { base: entry.conflict, text: entry.conflict.content, previous: entry.base }
    }
  },
}

/**
 * Create independent draft state for one plugin registration.
 * @returns One handle shared by the workbench and edge control.
 */
export function createWorkbenchStore(): ReturnType<typeof defineStore<WorkbenchState, typeof workbenchActions>> {
  return defineStore({
    init: (): WorkbenchState => ({ views: {}, paths: {}, drafts: {} }),
    actions: workbenchActions,
  })
}
