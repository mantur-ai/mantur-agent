import { expect, it } from 'vitest'
import { parsePromptEdits } from '../src/prompt-edits.ts'

const edit = { key: 'characters:1', fingerprint: 'observed', prompt: '保留人物特征', negative: '模糊' }

it('retains exact selected identities and prompt text', () => {
  expect(parsePromptEdits(JSON.stringify([edit]))).toEqual([edit])
})

it.each(['{', 'null', '{}', '[null]', JSON.stringify([{ ...edit, prompt: 1 }]),
  JSON.stringify([{ ...edit, negative: null }]), JSON.stringify([{ ...edit, media: 'unrequested.png' }])])(
  'rejects malformed or unrequested edit fields: %s', (text) => {
    expect(() => parsePromptEdits(text)).toThrow()
  },
)
