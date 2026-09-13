/** Test-only mounting of the production bundled-instruction hook in the shipped headless profile. */
import { join } from 'node:path'
import { registerBundledInvocations } from '../../../packages/skill/manturhub-marketplace/src/bundled-invocation.ts'

/** Scenario plugin identifier. */
export const name = 'bundled-skill-fixture'

/** Install the production hook against immutable scenario-local resources. */
export function apply(ctx) {
  registerBundledInvocations(ctx, join(process.cwd(), 'bundled'), {
    maxMetadataBytes: 65536, maxFiles: 10, maxUnpackedBytes: 65536,
  })
}
