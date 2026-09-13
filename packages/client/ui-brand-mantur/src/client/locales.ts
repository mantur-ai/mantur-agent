/** Copy owned by the Mantur brand occupants. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  name: 'ManTur Agent',
  headline: '故事起于一念，余下交给漫途',
} satisfies Record<string, string>

/** Mantur brand dictionary key union. */
export type ManturBrandKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  name: 'ManTur Agent',
  headline: 'Every story starts with an idea. Mantur handles the rest.',
} satisfies Record<ManturBrandKey, string>
