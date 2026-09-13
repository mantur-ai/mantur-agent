/** Asset envelopes use the existing conversation queue; this module owns no workbench slot. */

/**
 * Deliver an immutable envelope through its captured, still-selected Session binding.
 * @param sessions Existing client session registry; no session is created or selected here.
 * @param envelope Prepared drama-prompt-edit-v1 request with exact target attempts.
 * @returns Correlated admission receipts only; send errors propagate without a simulated result.
 */
export async function sendHandoffToSession(sessions, envelope) {
  if (envelope.schema !== 'drama-prompt-edit-v1' || envelope.intent !== 'propose-text-only') throw new Error('INVALID_HANDOFF');
  const request = structuredClone(envelope);
  if (!request.sessionId || sessions.list.getSnapshot().current !== request.sessionId) throw new Error('SESSION_CHANGED');
  const conversation = sessions.binding(request.sessionId)?.ctx.get('conversation');
  if (conversation === undefined) throw new Error('SESSION_UNAVAILABLE');
  await conversation.send(JSON.stringify(request));
  return request.targets.map(target => ({
    type: 'admitted', projectId: request.projectId, sessionId: request.sessionId,
    requestId: request.requestId, attempt: target.attempt, ids: [target.id],
  }));
}
