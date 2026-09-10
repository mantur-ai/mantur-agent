import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from './model.mjs';
import { prepareHandoff, receiveHandoff, confirmHandoff, retryHandoff } from './handoff.mjs';
import { rewriteFixture } from './controlled-agent.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url)));
const character = 'CHAR-001-V01', clip = 'CLIP-EP01-001', prop = 'PROP-001-V01';
const address = { requestId: 'edit-1', projectId: fixture.projectId, sessionId: 'main-session-test' };
const fields = prompt => ({ prompt, negativePrompt: '' });
function fresh() {
  const state = model.createState(fixture);
  const sources = {};
  for (const row of state.rows) {
    const documentId = row.kind === 'image' ? 'asset-report' : 'clip-report';
    const revision = (row.kind === 'image' ? 'a' : 'b').repeat(64);
    row.source = { documentId, table: row.kind === 'image' ? 'images' : 'clips', revision };
    sources[documentId] = revision;
  }
  return { state, sources };
}
function prepare(state, sources, ids = [character]) {
  return prepareHandoff(state, { ...address, ids, requirement: '保持身份，调整光线' }, sources);
}
const proposals = results => ({ ...address, type: 'proposals', results });

test('stable locator and dependency pins survive row reordering; preparation is not admission', () => {
  const { state, sources } = fresh();
  state.rows.reverse();
  const before = structuredClone(state.rows);
  const envelope = prepare(state, sources, [clip]);
  assert.deepEqual(envelope.targets[0].locator, { documentId: 'clip-report', table: 'clips', rowId: clip, sha256: 'b'.repeat(64), version: 1 });
  assert.ok(envelope.targets[0].sourcePins[character]);
  assert.equal(state.requests[0].targets[0].status, 'queued');
  assert.deepEqual(state.rows, before);
  assert.throws(() => rewriteFixture(state.requests[0]), /FIXTURE_ONLY/);
  assert.deepEqual(envelope, JSON.parse(readFileSync(new URL('./tests/expected/expected-handoff.json', import.meta.url))));
});

test('unbound files and stale or absent host fingerprints fail before any request is recorded', () => {
  for (const mutate of [
    ({ state }) => { delete state.rows.find(row => row.id === character).source.table; },
    ({ sources }) => { sources['asset-report'] = 'c'.repeat(64); },
    ({ sources }) => { delete sources['asset-report']; },
  ]) {
    const context = fresh(); mutate(context);
    assert.throws(() => prepare(context.state, context.sources, [character, prop]), /UNBOUND_SOURCE|SOURCE_CHANGED/);
    assert.equal(context.state.requests.length, 0);
  }
});

test('admission is atomic and rejects a wrong session, unknown item and duplicate item', () => {
  const { state, sources } = fresh(); prepare(state, sources);
  for (const event of [
    { ...address, sessionId: 'other', ids: [character] },
    { ...address, ids: [character, 'unknown'] },
    { ...address, ids: [character, character] },
  ]) {
    assert.throws(() => receiveHandoff(state, { type: 'admitted', attempt: 1, ...event }));
    assert.equal(state.requests[0].targets[0].status, 'queued');
  }
  receiveHandoff(state, { ...address, type: 'admitted', attempt: 1, ids: [character] });
  assert.equal(state.requests[0].targets[0].status, 'accepted');
  assert.equal(state.rows.find(row => row.id === character).version, 1);
});

test('unselected and non-text proposal mutations reject the entire receipt', () => {
  const { state, sources } = fresh(); prepare(state, sources);
  for (const results of [
    [{ id: character, attempt: 1, fields: fields('proposal') }, { id: prop, attempt: 1, fields: fields('unselected') }],
    [{ id: character, attempt: 1, fields: { ...fields('proposal'), media: 'other.png' } }],
    [{ id: character, attempt: 1, error: 'FIXTURE_AGENT_FAILURE' }],
  ]) {
    assert.throws(() => receiveHandoff(state, proposals(results)));
    assert.equal(state.requests[0].targets[0].status, 'queued');
  }
});

test('fresh source read and a changed dependency reject approval without destroying the draft', () => {
  for (const change of ['source', 'dependency', 'draft']) {
    const { state, sources } = fresh(); prepare(state, sources, [clip]);
    receiveHandoff(state, proposals([{ id: clip, attempt: 1, fields: fields('new clip') }]));
    const media = structuredClone(state.rows.find(row => row.id === clip).generation);
    if (change === 'source') sources['clip-report'] = 'c'.repeat(64);
    if (change === 'dependency') model.simulateExternalEdit(state, character);
    if (change === 'draft') model.saveDraft(state, clip, fields('human draft'), 1);
    confirmHandoff(state, { ...address, ids: [clip] }, sources);
    assert.equal(state.requests[0].targets[0].status, 'conflict');
    assert.equal(state.rows.find(row => row.id === clip).version, 1);
    assert.deepEqual(state.rows.find(row => row.id === clip).generation, media);
    if (change === 'draft') assert.equal(state.drafts[clip].prompt, 'human draft');
  }
});

test('batch failure retries only failed items and late receipts cannot overwrite approved text', () => {
  const { state, sources } = fresh(); prepare(state, sources, [character, prop]);
  receiveHandoff(state, proposals([{ id: character, attempt: 1, fields: fields('character proposal') }, { id: prop, attempt: 1, error: 'AGENT_EDIT_FAILED' }]));
  const media = structuredClone(state.rows.map(row => row.generation));
  confirmHandoff(state, { ...address, ids: [character] }, sources);
  assert.throws(() => retryHandoff(state, address, { ...sources, 'asset-report': 'c'.repeat(64) }), /SOURCE_CHANGED/);
  assert.equal(state.requests[0].targets[1].attempt, 1);
  const retry = retryHandoff(state, address, sources);
  assert.deepEqual(retry.targets.map(target => [target.id, target.attempt]), [[prop, 2]]);
  assert.equal(retry.schema, 'drama-prompt-edit-v1');
  assert.equal(retry.requestId, address.requestId);
  receiveHandoff(state, proposals([{ id: prop, attempt: 1, fields: fields('late') }]));
  assert.equal(state.requests[0].targets[1].status, 'queued');
  receiveHandoff(state, proposals([{ id: prop, attempt: 2, fields: fields('retry') }]));
  confirmHandoff(state, { ...address, ids: [prop] }, sources);
  receiveHandoff(state, proposals([{ id: character, attempt: 1, fields: fields('late character') }]));
  assert.equal(state.rows.find(row => row.id === character).prompt, 'character proposal');
  assert.equal(state.rows.find(row => row.id === prop).prompt, 'retry');
  assert.deepEqual(state.rows.map(row => row.generation), media);
});
