/**
 * Client-safe Cordis event declarations emitted by the skill registry.
 *
 * @module @deepseek-ai/dsh-skill/types
 */

export type {}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A skill provider, runtime contribution, or provider-backed catalog may
     * have changed. This is an unfiltered invalidation notification; consumers
     * refetch the catalog for their own lookup options. Listener failures are
     * contained and cannot veto the registry mutation.
     * @mode emit
     */
    'skills/change'(): void
    /**
     * Restrict subsequent catalog advertisement and body loading by skill name.
     * Listeners delegate before combining their decision; false denies access.
     * @mode waterfall
     * @param name - Validated skill identifier.
     * @param next - Remaining policy listeners, permitting access when none remain.
     */
    'skills/enabled'(name: string, next: () => Promise<boolean>): Promise<boolean>
  }
}
