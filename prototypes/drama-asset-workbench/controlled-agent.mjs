/** Deterministic test double. It never calls a model or media provider. */
export function rewriteFixture(request) {
  if (request.mode !== 'fixture-controlled-agent') throw new Error('FIXTURE_ONLY');
  return request.targets.map(target => {
    if (target.id === 'PROP-001-V01' && target.attempt === 1) return { id: target.id, attempt: target.attempt, error: 'FIXTURE_AGENT_FAILURE' };
    const suffix = target.context.kind === 'video' ? '不要背景音乐，不要字幕。' : '';
    const prompt = target.draft.prompt.replace(/不要背景音乐，不要字幕。$/, '');
    return { id: target.id, attempt: target.attempt, fields: { prompt: `${prompt}\n调整要求：${request.requirement}\n${suffix}`.trim(), negativePrompt: target.draft.negativePrompt } };
  });
}
