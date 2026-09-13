/** Production integration candidate; the caller pins an existing session scope. */
export function existingConversationSender(sessionId, scope) {
  if (!sessionId || typeof scope?.conversation?.send !== 'function') throw new Error('Existing scoped conversation is required');
  return async payload => {
    const request = JSON.parse(payload);
    if (request.sessionId !== sessionId) throw new Error('Rewrite request belongs to another session');
    await scope.conversation.send(payload);
    // Admission only. File completion must come from guarded writes and readback.
  };
}
