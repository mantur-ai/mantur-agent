import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from './model.mjs';
import { rewriteFixture } from './controlled-agent.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));
const fresh = () => m.createState(fixture);
const id = 'CHAR-001-V01', prop = 'PROP-001-V01', clip = 'CLIP-EP01-001';
const fields = prompt => ({ prompt, negativePrompt: '负面测试' });
const deliver = (state, ids, key = 'request-1') => {
  const request = m.queueRequest(state, ids, '保持身份，调整光线', key);
  m.acknowledge(state, key, 1, ids);
  m.receiveProposal(state, key, rewriteFixture(request));
  return request;
};
test('fixture validates stable identities, variants and media provenance', () => {
  assert.equal(m.validateFixture(fixture).rows.length, 10);
  for (const change of [f => f.rows.push(f.rows[0]), f => f.rows[0].media = 'https://unapproved.example/a.png', f => f.rows[1].baseAssetId = 'unknown', f => f.rows[0].generation = null]) {
    const f = structuredClone(fixture); change(f); assert.throws(() => m.validateFixture(f));
  }
});
test('cross-scene and out-of-order tails reject instead of guessing', () => {
  const f = structuredClone(fixture);
  f.rows.find(row => row.id === 'CLIP-EP02-002').previousClipId = clip;
  assert.throws(() => m.validateFixture(f), /CROSS_SCENE_TAIL/);
});
test('draft save preserves source, compilation template and actual request', () => {
  const state = fresh(), before = structuredClone(state.rows);
  m.saveDraft(state, clip, fields('下一版'), 1);
  assert.deepEqual(state.rows, before);
  m.applyDraft(state, clip);
  const row = state.rows.find(row => row.id === clip);
  assert.equal(row.version, 2); assert.equal(row.prompt, '下一版');
  assert.deepEqual(row.generation, before.find(row => row.id === clip).generation);
  assert.deepEqual(row.template, before.find(row => row.id === clip).template);
  assert.deepEqual(row.actualRequest, before.find(row => row.id === clip).actualRequest);
});
test('acceptance alone never applies text or reports completion', () => {
  const state = fresh(), before = structuredClone(state.rows);
  m.queueRequest(state, [id], '要求', 'req'); m.acknowledge(state, 'req', 1, [id]);
  assert.equal(state.requests[0].targets[0].status, 'accepted');
  m.applyProposals(state, 'req'); assert.deepEqual(state.rows, before);
});
test('single selected target changes only after explicit proposal approval', () => {
  const state = fresh(), old = structuredClone(state.rows);
  deliver(state, [id]); assert.deepEqual(state.rows, old);
  m.applyProposals(state, 'request-1');
  assert.equal(state.rows[0].version, 2);
  for (let i = 1; i < old.length; i++) assert.equal(state.rows[i].prompt, old[i].prompt);
  assert.equal(state.requests[0].targets[0].status, 'applied');
});
test('failed-item retry excludes successful items and cannot double-apply', () => {
  const state = fresh(); deliver(state, [id, prop]); m.applyProposals(state, 'request-1');
  assert.equal(state.requests[0].targets[1].status, 'failed');
  const retry = m.retryFailed(state, 'request-1'); assert.deepEqual(retry.targets.map(t => t.id), [prop]);
  m.receiveProposal(state, 'request-1', rewriteFixture(retry)); m.applyProposals(state, 'request-1'); m.applyProposals(state, 'request-1');
  assert.equal(state.rows[0].version, 2); assert.equal(state.rows.find(row => row.id === prop).version, 2);
  assert.equal(state.history.length, 2);
});
test('concurrent source revision retains draft and exposes per-item conflict', () => {
  const state = fresh(); m.saveDraft(state, id, fields('用户草稿'), 1); deliver(state, [id, 'SCENE-001-V01']);
  m.simulateExternalEdit(state, id); m.applyProposals(state, 'request-1');
  assert.equal(state.requests[0].targets[0].status, 'conflict');
  assert.equal(state.requests[0].targets[1].status, 'applied');
  assert.equal(state.drafts[id].prompt, '用户草稿'); assert.throws(() => m.applyDraft(state, id), /VERSION_CONFLICT/);
  m.rebaseDraft(state, id); m.applyDraft(state, id); assert.equal(state.rows[0].prompt, '用户草稿');
});
test('local edit after Agent dispatch is not overwritten even with unchanged source version', () => {
  const state = fresh(); deliver(state, [id]); m.saveDraft(state, id, fields('更晚的手动输入'), 1); m.applyProposals(state, 'request-1');
  assert.equal(state.requests[0].targets[0].status, 'conflict'); assert.equal(state.drafts[id].prompt, '更晚的手动输入');
});
test('receipt cannot alter unselected IDs or non-text fields', () => {
  const state = fresh(); m.queueRequest(state, [id], '要求', 'req');
  assert.throws(() => m.receiveProposal(state, 'req', [{ id: prop, attempt: 1, fields: fields('恶意范围') }]), /UNSELECTED_RECEIPT/);
  assert.throws(() => m.receiveProposal(state, 'req', [{ id, attempt: 1, fields: { ...fields('改变历史'), actualRequest: {} } }]), /INVALID_PATCH/);
  assert.equal(state.requests[0].targets[0].status, 'queued');
});
test('duplicate/old acceptance and execution receipts cannot regress applied records', () => {
  const state = fresh(), request = deliver(state, [id]); m.applyProposals(state, 'request-1');
  m.acknowledge(state, 'request-1', 1, [id]); m.receiveProposal(state, 'request-1', rewriteFixture(request));
  assert.equal(state.requests[0].targets[0].status, 'applied'); assert.equal(state.history.length, 1);
});
test('history restores as a new revision without changing submitted task identity', () => {
  const state = fresh(), generation = structuredClone(state.rows[0].generation);
  deliver(state, [id]); m.applyProposals(state, 'request-1'); m.restoreHistory(state, 0, 2);
  assert.equal(state.rows[0].version, 3); assert.equal(state.rows[0].prompt, fixture.rows[0].prompt);
  assert.deepEqual(state.rows[0].generation, generation);
  assert.throws(() => m.restoreHistory(state, 0, 2), /VERSION_CONFLICT/);
});
test('impact follows asset variants and same-scene chain; does not join unrelated scenes', () => {
  const state = fresh(); const impacted = m.impactOf(state, clip);
  assert.deepEqual(impacted, [clip, 'CLIP-EP01-002']);
  assert.ok(m.impactOf(state, id).includes('CHAR-001-V02'));
  assert.equal(state.rows.find(row => row.id === clip).generation.lastFrame, null);
});
test('filter changes clear hidden selection and preserve drafts', () => {
  const state = fresh(); state.ui.selected = [id]; m.saveDraft(state, id, fields('保留'), 1);
  m.changeFilter(state, 'tab', 'video'); m.changeFilter(state, 'episode', '2');
  assert.deepEqual(state.ui.selected, []); assert.equal(m.visibleRows(state).length, 2); assert.equal(state.drafts[id].prompt, '保留');
});
test('close and persistence roundtrip retain request, draft and user suppression', () => {
  let state = fresh(); m.saveDraft(state, id, fields('关闭保留'), 1); m.queueRequest(state, [id], '请求', 'req'); m.setPanel(state, 'user-close');
  state = JSON.parse(JSON.stringify(state)); m.setPanel(state, 'agent-open');
  assert.equal(state.panel.hidden, true); assert.equal(state.drafts[id].prompt, '关闭保留'); assert.equal(state.requests.length, 1);
  m.setPanel(state, 'user-open'); assert.equal(state.panel.hidden, false);
});
test('detail cannot continue editing an item hidden by episode filter', () => {
  const state = fresh(); m.changeFilter(state, 'tab', 'video'); m.changeFilter(state, 'episode', '2');
  assert.equal(state.ui.detail, 'CLIP-EP02-001');
});
test('stale concurrent editor retains both drafts instead of overwriting', () => {
  const state = fresh(); m.saveDraft(state, id, fields('页签 A'), 1, 0);
  const result = m.saveDraft(state, id, fields('页签 B'), 1, 0);
  assert.equal(result.conflict, true); assert.equal(state.drafts[id].prompt, '页签 A');
  assert.equal(state.draftConflicts[id][0].prompt, '页签 B');
  m.acceptCompetingDraft(state, id, 0, 1);
  assert.equal(state.drafts[id].prompt, '页签 B'); assert.equal(state.draftConflicts[id][0].prompt, '页签 A');
});
test('a batch proposal can be accepted and rejected item by item', () => {
  const state = fresh(); deliver(state, [id, 'SCENE-001-V01']);
  m.applyProposals(state, 'request-1', [id]);
  assert.equal(state.requests[0].targets[1].status, 'proposed');
  m.rejectProposal(state, 'request-1', 'SCENE-001-V01'); m.applyProposals(state, 'request-1');
  assert.equal(state.requests[0].targets[1].status, 'rejected');
  assert.equal(state.rows.find(row => row.id === 'SCENE-001-V01').version, 1);
});
test('reload interruption is explicit and resumes only pending controlled work', () => {
  let state = fresh(); deliver(state, [id, 'SCENE-001-V01']); m.applyProposals(state, 'request-1', [id]);
  state.requests[0].transportOwner = 'page'; state.requests[0].targets[1].status = 'accepted';
  state = JSON.parse(JSON.stringify(state)); m.interruptFixtureTransport(state, 'another-page');
  assert.equal(state.requests[0].targets[1].status, 'accepted');
  m.interruptFixtureTransport(state, 'page'); assert.equal(state.requests[0].targets[1].status, 'interrupted');
  const resumed = m.resumeInterrupted(state, 'request-1');
  assert.deepEqual(resumed.targets.map(target => target.id), ['SCENE-001-V01']);
  m.receiveProposal(state, 'request-1', rewriteFixture(resumed)); m.applyProposals(state, 'request-1');
  assert.equal(state.rows[0].version, 2); assert.equal(state.history.length, 2);
});
test('keyless controlled workflow matches its owner-local receipt snapshot', () => {
  let state = fresh(); const stages = [];
  const capture = name => stages.push({ name, statuses: state.requests[0].targets.map(target => target.status), versions: [id, prop].map(id => state.rows.find(row => row.id === id).version) });
  const request = m.queueRequest(state, [id, prop], '快照改写要求', 'snapshot-request');
  m.acknowledge(state, request.id, 1, [id, prop]); capture('accepted');
  m.receiveProposal(state, request.id, rewriteFixture(request)); capture('executed');
  m.applyProposals(state, request.id); capture('confirmed');
  const retry = m.retryFailed(state, request.id); m.receiveProposal(state, request.id, rewriteFixture(retry)); m.applyProposals(state, request.id); capture('retry-confirmed');
  m.setPanel(state, 'user-close'); state = JSON.parse(JSON.stringify(state)); m.setPanel(state, 'agent-open');
  const result = { mode: request.mode, stages, submittedTask: state.rows[0].generation.taskId, submittedVersion: state.rows[0].generation.version, historyCount: state.history.length, userClosedAfterRestore: state.panel.userClosed };
  assert.deepEqual(result, JSON.parse(readFileSync(new URL('./tests/expected/expected-workflow.json', import.meta.url), 'utf8')));
});
test('queued keystrokes cannot advance a stale editor into another editors revision', async () => {
  const state = fresh(); m.saveDraft(state, id, fields('A must survive'), 1, 0);
  const writer = { revision: 0, blocked: false, chain: Promise.resolve() };
  await Promise.all(['B', 'BB', 'BBB'].map(text => m.queueDraftWrite(writer, async revision => m.saveDraft(state, id, fields(text), 1, revision))));
  assert.equal(state.drafts[id].prompt, 'A must survive');
  assert.deepEqual(state.draftConflicts[id].map(item => item.prompt), ['B', 'BB', 'BBB']);
});
test('queued keystrokes from the same editor advance only after acknowledged writes', async () => {
  const state = fresh(); const writer = { revision: 0, blocked: false, chain: Promise.resolve() };
  await Promise.all(['A', 'AB', 'ABC'].map(text => m.queueDraftWrite(writer, async revision => m.saveDraft(state, id, fields(text), 1, revision))));
  assert.equal(state.drafts[id].prompt, 'ABC'); assert.equal(state.drafts[id].revision, 3);
  assert.equal(state.draftConflicts, undefined);
});
