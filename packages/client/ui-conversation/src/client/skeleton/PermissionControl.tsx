/** Accessory-slot adapter for the resident composer's permission control. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerControlInjected } from '../contract/slots.ts'
import { composerAvailability } from './composer-availability.ts'
import { PermissionSelect } from './PermissionSelect.tsx'

/**
 * Render the existing permission projection and command face above the editor.
 * @param props - Framework-bound Session/input sources and the composer's display lock.
 * @returns The permission selector when the Session exposes its command face.
 */
export function PermissionControl({ sessionId, useSession, useProjection, useComposerInput,
  inputActions, unassignedActions, keyboard, command, disabled, t,
}: PropsRuntime<'conversation.composer.bar.accessory.permissions'> & InjectFace<ComposerControlInjected> & PropsLocale<'conversation'>) {
  const input = useComposerInput(state => state)
  const removed = useSession(state => state.removed) ?? false
  const subagent = useSession(state => state.subagent) ?? null
  const permissions = useProjection('permissions')
  const { locked } = composerAvailability({ input, keyboard,
    actions: sessionId === undefined ? unassignedActions : inputActions, subagent, removed, disabled })
  return command === undefined ? null
    : <PermissionSelect key={sessionId} value={permissions} locked={locked} command={command} t={t} />
}
