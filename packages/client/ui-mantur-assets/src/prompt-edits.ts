/** Validation for the model's JSON-encoded prompt edits. */
import { z } from 'zod'
import type { AssetKey, PromptEdit } from './types.ts'

const edits = z.array(z.object({
  key: z.string().transform(key => key as AssetKey),
  fingerprint: z.string(),
  prompt: z.string(),
  negative: z.string(),
}).strict())

/**
 * Decode the model's prompt edits before proposal ownership and fingerprint checks.
 * @param text - JSON supplied to the proposal tool.
 * @returns Validated editable fields; malformed or extra fields throw.
 */
export function parsePromptEdits(text: string): PromptEdit[] {
  return edits.parse(JSON.parse(text) as unknown)
}
