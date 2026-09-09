import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from './model.mjs';
import { prepareHandoff, receiveHandoff, confirmHandoff } from './handoff.mjs';
import { sendHandoffToSession } from './session-sender.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url)));
const character = 'CHAR-001-V01', clip = 'CLIP-EP01-001';
function setup(ids = [clip]) {
  const state = model.createState(fixture), sources = {};
  for (const row of state.rows) {
    const documentId = row.kind === 'image' ? 'asset-report' : 'clip-report';
    const revision = (row.kind === 'image' ? 'a' : 'b').repeat(64);
    row.source = { documentId, table: row.kind === 'image' ? 'images' : 'clips', revision };
    sources[documentId] = revision;
  }
  const packet = prepareHandoff(state, { requestId: 'edit-1', sessionId: 'main-session-test', ids, requirement: '保持身份，调整光线' }, sources);
  const messages = [], bindings = [];
  let selected = packet.sessionId;
  const conversation = { async send(text) { messages.push(text); } };
  const sessions = {
    list: { getSnapshot: () => ({ current: selected }) },
    binding: id => { bindings.push(id); return { ctx: { get: key => key === 'conversation' ? conversation : undefined } }; },
  };
  return { state, sources, packet, messages, bindings, conversation, sessions, select: id => { selected = id; } };
}

test('single action sends the full pinned envelope to the existing conversation and records admission only', async () => {
  const context = setup(), before = structuredClone(context.state.rows);
  const events = await sendHandoffToSession(context.sessions, context.packet);
  assert.deepEqual(context.bindings, ['main-session-test']);
  assert.equal(context.messages.length, 1);
  assert.deepEqual(JSON.parse(context.messages[0]), JSON.parse(readFileSync(new URL('./tests/expected/expected-handoff.json', import.meta.url))));
  events.forEach(event => receiveHandoff(context.state, event));
  assert.equal(context.state.requests[0].targets[0].status, 'accepted');
  assert.deepEqual(context.state.rows, before);
  assert.equal(context.state.history.length, 0);
});

test('batch action sends one message containing exactly the selected assets', async () => {
  const context = setup([character, clip]);
  const events = await sendHandoffToSession(context.sessions, context.packet);
  assert.equal(context.messages.length, 1);
  assert.deepEqual(JSON.parse(context.messages[0]).targets.map(target => target.id), [character, clip]);
  events.forEach(event => receiveHandoff(context.state, event));
  assert.deepEqual(context.state.requests[0].targets.map(target => target.status), ['accepted', 'accepted']);
});

test('changed selection or missing binding rejects without sending to another conversation', async () => {
  const changed = setup(); changed.select('another-session');
  await assert.rejects(sendHandoffToSession(changed.sessions, changed.packet), /SESSION_CHANGED/);
  assert.equal(changed.bindings.length, 0);
  assert.equal(changed.messages.length, 0);
  const unavailable = setup(); unavailable.sessions.binding = () => undefined;
  await assert.rejects(sendHandoffToSession(unavailable.sessions, unavailable.packet), /SESSION_UNAVAILABLE/);
  assert.equal(unavailable.messages.length, 0);
});

test('queue rejection propagates; no admission, proposal or automatic retry is manufactured', async () => {
  const context = setup();
  let calls = 0;
  context.conversation.send = async () => { calls++; throw new Error('transport unavailable'); };
  await assert.rejects(sendHandoffToSession(context.sessions, context.packet), /transport unavailable/);
  assert.equal(calls, 1);
  assert.equal(context.state.requests[0].targets[0].status, 'queued');
  assert.equal(context.state.history.length, 0);
});

test('pending delivery retains its original Session, project and target attempts after selection changes', async () => {
  const context = setup();
  const barrier = Promise.withResolvers();
  context.conversation.send = async text => { context.messages.push(text); await barrier.promise; };
  const delivery = sendHandoffToSession(context.sessions, context.packet);
  assert.equal(context.messages.length, 1);
  context.select('another-session');
  context.packet.sessionId = 'another-session';
  context.packet.targets[0].attempt = 9;
  context.packet.targets[0].id = character;
  barrier.resolve();
  const events = await delivery;
  assert.deepEqual(events, [{ type: 'admitted', projectId: fixture.projectId, sessionId: 'main-session-test', requestId: 'edit-1', attempt: 1, ids: [clip] }]);
  const other = setup().state;
  other.requests[0].sessionId = 'another-session';
  assert.throws(() => receiveHandoff(other, events[0]), /UNRELATED_RECEIPT/);
  events.forEach(event => receiveHandoff(context.state, event));
  assert.equal(context.state.requests[0].targets[0].status, 'accepted');
});

test('a draft edited during admission remains protected when a later proposal is confirmed', async () => {
  const context = setup();
  const barrier = Promise.withResolvers();
  context.conversation.send = async () => { await barrier.promise; };
  const delivery = sendHandoffToSession(context.sessions, context.packet);
  model.saveDraft(context.state, clip, { prompt: 'user draft while queued', negativePrompt: '' }, 1);
  barrier.resolve();
  (await delivery).forEach(event => receiveHandoff(context.state, event));
  receiveHandoff(context.state, { ...context.packet, type: 'proposals', results: [{ id: clip, attempt: 1, fields: { prompt: 'later proposal', negativePrompt: '' } }] });
  confirmHandoff(context.state, { ...context.packet, ids: [clip] }, context.sources);
  assert.equal(context.state.requests[0].targets[0].status, 'conflict');
  assert.equal(context.state.drafts[clip].prompt, 'user draft while queued');
});

test('controlled-worker messages cannot use the existing-session transport', async () => {
  const context = setup();
  const controlled = model.queueRequest(context.state, [clip], 'controlled rewrite', 'fixture-request');
  await assert.rejects(sendHandoffToSession(context.sessions, controlled), /INVALID_HANDOFF/);
  assert.equal(context.messages.length, 0);
});
