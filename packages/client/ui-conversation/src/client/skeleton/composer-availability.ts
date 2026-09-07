/** Shared interaction locks for inline and layout-owned composer controls. */

import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ComposerKeyboard, InputActions, InputState } from '../contract/input.ts'

/**
 * Read composer availability without owning input or permission state.
 * @param inputs - Current input faces, Session state, and the owner's display lock.
 * @returns Whether input is live and whether message controls are locked.
 */
export function composerAvailability(inputs: {
  input: InputState | undefined
  keyboard: ComposerKeyboard | undefined
  actions: InputActions | undefined
  subagent: SessionSnapshot['subagent']
  removed: boolean
  disabled: boolean
}): { live: boolean; locked: boolean; parentOffline: boolean } {
  const live = inputs.input !== undefined && inputs.keyboard !== undefined && inputs.actions !== undefined
  const parentOffline = inputs.subagent?.address.mode === 'continuable' && inputs.subagent.parentAvailable !== true
  return { live, parentOffline, locked: inputs.removed || inputs.disabled || !live || parentOffline }
}
