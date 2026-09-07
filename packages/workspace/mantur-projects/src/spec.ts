/** Durable root selection and partial-creation records. */
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ProjectCreationId } from './types.ts'

const absolutePath = z.string().refine(path => isAbsolute(path) && !path.includes('\0'), 'project paths must be absolute')
const projectRecord = z.object({ path: absolutePath, title: z.string().trim().min(1), directoryCreated: z.boolean() })

/** Directory ownership is recorded before a Workspace is attached. */
export type ProjectRecord = z.infer<typeof projectRecord>

/** Root changes affect only creation identities that have not yet been reserved. */
export const projectDomainSpec = defineDomain({
  name: 'mantur_projects',
  version: 1,
  global: { schema: z.object({ rootPath: absolutePath.nullable() }), initial: { rootPath: null } },
  tables: { creations: domainTable<ProjectCreationId, ProjectRecord>(projectRecord) },
})
