/** The parent channel accepts only request-bound, well-formed saved-log receipts. */
import { expect, it } from 'vitest'
import { updateSaveReply, updateSaveRequest } from '../src/update-protocol.ts'

const id = 'f5691974-98bc-4d3c-bcf8-d5cf78efddbb'
it('parses the matching request and both reply variants', () => {
  const request = { type: 'mantur:update:prepare', id }
  expect(updateSaveRequest(request)).toEqual(request)
  const success = { type: 'mantur:update:prepared', id, ok: true, checkpoints: [{ sessionId: 'one', nextSeq: 3 }] }
  expect(updateSaveReply(success)).toEqual(success)
  const failure = { type: 'mantur:update:prepared', id, ok: false, error: 'flush failed' }
  expect(updateSaveReply(failure)).toEqual(failure)
})
it.each([null, false, [], {}, { type: 'account' }, { type: 'mantur:update:prepare', id: '-'.repeat(36) }])(
  'ignores unrelated or invalid request %j', (value) => { expect(updateSaveRequest(value)).toBeUndefined() },
)
it.each([null, false, [], {}, { type: 'account' }, { type: 'mantur:update:prepared', id: '-'.repeat(36) }])(
  'ignores unrelated or invalid reply %j', (value) => { expect(updateSaveReply(value)).toBeUndefined() },
)
it.each([undefined, false, [null], [{}], [{ sessionId: '', nextSeq: 0 }], [{ sessionId: 'one', nextSeq: -1 }],
  [{ sessionId: 'one', nextSeq: 0.5 }], [{ sessionId: 'one', nextSeq: '3' }],
  [{ sessionId: 'one', nextSeq: 1 }, { sessionId: 'one', nextSeq: 1 }],
].map(checkpoints => ({ checkpoints })))('rejects invalid checkpoint fields %j', ({ checkpoints }) => {
  expect(updateSaveReply({ type: 'mantur:update:prepared', id, ok: true, checkpoints })).toBeUndefined()
})
