/** Isolated fixture revision store. Production adapters must supply the same explicit receipts. */
export const EDIT_FIELDS = ['prompt', 'negativePrompt'];
const copy = value => structuredClone(value);
const fail = code => { throw new Error(code); };
const equal = (a, b) => EDIT_FIELDS.every(key => a[key] === b[key]);
const values = row => Object.fromEntries(EDIT_FIELDS.map(key => [key, row[key]]));
const locate = (state, id) => state.rows.find(row => row.id === id) ?? fail('UNKNOWN_TARGET');

/** Validate imported fixture identity and links; no production response format is inferred. */
export function validateFixture(fixture) {
  if (fixture.schema !== 'workbench-fixture-v1' || fixture.fixture !== true) fail('FIXTURE_ONLY');
  const ids = new Set();
  for (const row of fixture.rows) {
    if (!row.id || ids.has(row.id)) fail('DUPLICATE_ID');
    ids.add(row.id);
    if (!['image', 'video'].includes(row.kind) || !EDIT_FIELDS.every(key => typeof row[key] === 'string')) fail('INVALID_ROW');
    if (!Number.isInteger(row.version) || row.version < 1) fail('INVALID_VERSION');
    if (row.media !== null && !fixture.mediaAllowlist.includes(row.media)) fail('MEDIA_NOT_ALLOWED');
    if (row.media && (!row.generation || row.generation.version > row.version)) fail('INVALID_GENERATION');
  }
  for (const row of fixture.rows) {
    if (row.kind === 'image' && !ids.has(row.baseAssetId)) fail('MISSING_BASE');
    for (const ref of row.references) if (!ids.has(ref.id)) fail('MISSING_REFERENCE');
    if (row.previousClipId) {
      const previous = fixture.rows.find(item => item.id === row.previousClipId);
      if (!previous || previous.kind !== 'video' || previous.episode !== row.episode || previous.scene !== row.scene || previous.order >= row.order) fail('CROSS_SCENE_TAIL');
    }
  }
  return fixture;
}

/** Create project state from an explicitly synthetic fixture. */
export function createState(fixture) {
  validateFixture(fixture);
  return { schema: 1, projectId: fixture.projectId, sessionId: 'fixture-main-session', project: copy(fixture.project), rows: copy(fixture.rows), drafts: {}, requests: [], history: [], panel: { hidden: false, userClosed: false }, ui: { tab: 'image', episode: '', scene: '', category: '', selected: [], detail: fixture.rows[0].id } };
}

/** Save text only. Source versions, templates and submitted generation records remain immutable. */
export function saveDraft(state, id, fields, expectedVersion, expectedDraftRevision = 0) {
  const row = locate(state, id);
  if (!EDIT_FIELDS.every(key => typeof fields[key] === 'string')) fail('INVALID_FIELDS');
  const existing = state.drafts[id];
  if ((existing?.revision ?? 0) !== expectedDraftRevision) {
    state.draftConflicts ??= {};
    state.draftConflicts[id] ??= [];
    state.draftConflicts[id].push({ ...copy(fields), baseVersion: expectedVersion });
    return { conflict: true };
  }
  state.drafts[id] = { ...copy(fields), baseVersion: existing?.baseVersion ?? expectedVersion, base: existing?.base ?? values(row), revision: (existing?.revision ?? 0) + 1 };
  return state.drafts[id];
}

/** Compute review scope without deleting media or scheduling regeneration. */
export function impactOf(state, id) {
  const affected = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of state.rows) {
      if (!affected.has(row.id) && (row.references.some(ref => affected.has(ref.id)) || (row.previousClipId && affected.has(row.previousClipId)))) {
        affected.add(row.id); changed = true;
      }
    }
  }
  return [...affected];
}

function revise(state, row, fields, reason) {
  const before = { version: row.version, ...values(row) };
  row.version += 1;
  Object.assign(row, fields);
  state.history.push({ id: row.id, before, after: { version: row.version, ...values(row) }, reason });
  for (const id of impactOf(state, row.id)) locate(state, id).needsReview = true;
}

/** Apply a manually saved draft with compare-and-swap; conflicts retain the draft. */
export function applyDraft(state, id) {
  const row = locate(state, id), draft = state.drafts[id];
  if (!draft) fail('NO_DRAFT');
  if (row.version !== draft.baseVersion || !equal(row, draft.base)) fail('VERSION_CONFLICT');
  if (!equal(row, draft)) revise(state, row, values(draft), 'manual');
  delete state.drafts[id];
}

/** Rebase only after the user explicitly chooses to retain their draft over the latest source. */
export function rebaseDraft(state, id) {
  const row = locate(state, id), draft = state.drafts[id];
  if (!draft) fail('NO_DRAFT');
  draft.base = values(row); draft.baseVersion = row.version; draft.revision += 1;
}

/** Freeze exact target IDs, source versions, drafts and context for the main-session adapter. */
export function queueRequest(state, ids, requirement, requestId) {
  if (!ids.length || new Set(ids).size !== ids.length || !requirement.trim()) fail('EMPTY_REQUEST');
  if (state.requests.some(request => request.id === requestId)) fail('DUPLICATE_REQUEST');
  const targets = ids.map(id => {
    const row = locate(state, id), draft = state.drafts[id];
    if (draft && (draft.baseVersion !== row.version || !equal(row, draft.base))) fail('VERSION_CONFLICT');
    return { id, baseVersion: row.version, before: values(row), draft: values(draft ?? row), draftRevision: draft?.revision ?? 0, context: { kind: row.kind, references: copy(row.references), episode: row.episode, scene: row.scene, previousClipId: row.previousClipId, source: row.source }, status: 'queued', attempt: 1 };
  });
  const request = { id: requestId, projectId: state.projectId, sessionId: state.sessionId, mode: 'fixture-controlled-agent', requirement: requirement.trim(), fields: [...EDIT_FIELDS], context: copy(state.project), targets };
  state.requests.push(request);
  return copy(request);
}

/** A delivery acknowledgement is not an execution result. Duplicate/old receipts cannot regress state. */
export function acknowledge(state, requestId, attempt, ids) {
  const request = state.requests.find(item => item.id === requestId) ?? fail('UNKNOWN_REQUEST');
  for (const id of ids) {
    const target = request.targets.find(item => item.id === id) ?? fail('UNSELECTED_RECEIPT');
    if (target.attempt === attempt && target.status === 'queued') target.status = 'accepted';
  }
}

/** Accept only correlated, selected, allowlisted field proposals from the controlled Agent. */
export function receiveProposal(state, requestId, results) {
  const request = state.requests.find(item => item.id === requestId) ?? fail('UNKNOWN_REQUEST');
  const seen = new Set();
  for (const result of results) {
    const target = request.targets.find(item => item.id === result.id) ?? fail('UNSELECTED_RECEIPT');
    if (seen.has(result.id)) fail('DUPLICATE_RECEIPT');
    seen.add(result.id);
    if (result.attempt !== target.attempt || !['queued', 'accepted'].includes(target.status)) continue;
    if (result.error !== undefined) {
      if (result.error !== (request.mode === 'main-agent-proposal-v1' ? 'AGENT_EDIT_FAILED' : 'FIXTURE_AGENT_FAILURE')) fail('UNKNOWN_AGENT_ERROR');
    } else if (!result.fields || Object.keys(result.fields).length !== 2 || !EDIT_FIELDS.every(key => typeof result.fields[key] === 'string')) fail('INVALID_PATCH');
  }
  for (const result of results) {
    const target = request.targets.find(item => item.id === result.id);
    if (result.attempt !== target.attempt || !['queued', 'accepted'].includes(target.status)) continue;
    if (result.error) { target.status = 'failed'; target.error = result.error; }
    else { target.status = 'proposed'; target.proposal = copy(result.fields); }
  }
}

/** Apply proposals independently. Later source or local-draft edits become visible conflicts. */
export function applyProposals(state, requestId, targetIds) {
  const request = state.requests.find(item => item.id === requestId) ?? fail('UNKNOWN_REQUEST');
  for (const target of request.targets) {
    if (target.status !== 'proposed' || (targetIds && !targetIds.includes(target.id))) continue;
    const row = locate(state, target.id), draft = state.drafts[target.id];
    if (row.version !== target.baseVersion || !equal(row, target.before) || (draft?.revision ?? 0) !== target.draftRevision) {
      target.status = 'conflict';
      if (!draft) saveDraft(state, row.id, target.proposal, target.baseVersion);
      continue;
    }
    if (!equal(row, target.proposal)) revise(state, row, target.proposal, request.id);
    delete state.drafts[row.id]; target.status = 'applied'; target.appliedVersion = row.version;
  }
}

/** Retry failed items only; succeeded or conflicted records require no automatic resubmission. */
export function retryFailed(state, requestId) {
  const request = state.requests.find(item => item.id === requestId) ?? fail('UNKNOWN_REQUEST');
  const targets = request.targets.filter(target => target.status === 'failed');
  if (!targets.length) fail('NOTHING_TO_RETRY');
  for (const target of targets) { target.status = 'queued'; target.attempt += 1; delete target.error; }
  return { ...copy(request), targets: copy(targets) };
}

/** Restore historical text as a new revision; generation records are not rolled back. */
export function restoreHistory(state, index, expectedVersion) {
  const entry = state.history[index] ?? fail('UNKNOWN_HISTORY'), row = locate(state, entry.id);
  if (row.version !== expectedVersion) fail('VERSION_CONFLICT');
  revise(state, row, values(entry.before), 'restore');
}

/** Controlled fixture-only concurrent writer used to exercise human/Agent conflicts. */
export function simulateExternalEdit(state, id) {
  const row = locate(state, id);
  revise(state, row, { prompt: `${row.prompt} [外部修订演示]`, negativePrompt: row.negativePrompt }, 'fixture-external-agent');
}

/** User closure persists; ordinary Agent opens do not steal focus. */
export function setPanel(state, action) {
  if (action === 'user-close') state.panel = { hidden: true, userClosed: true };
  else if (action === 'user-open') state.panel = { hidden: false, userClosed: false };
  else if (action === 'agent-open' && !state.panel.userClosed) state.panel.hidden = false;
}

/** Filter scope changes drop selection so hidden items cannot be modified accidentally. */
export function changeFilter(state, key, value) {
  if (!['tab', 'episode', 'scene', 'category'].includes(key)) fail('INVALID_FILTER');
  state.ui[key] = value; state.ui.selected = [];
  if (key === 'episode') state.ui.scene = '';
  if (key === 'tab') state.ui.category = '';
  const visible = visibleRows(state);
  if (!visible.some(row => row.id === state.ui.detail)) state.ui.detail = visible[0]?.id;
}

/** Select projection rows without relying on source table order. */
export function visibleRows(state) {
  return state.rows.filter(row => row.kind === state.ui.tab && (!state.ui.episode || row.scopes.some(scope => String(scope.episode) === state.ui.episode)) && (!state.ui.scene || row.scopes.some(scope => `${scope.episode}/${scope.scene}` === state.ui.scene)) && (!state.ui.category || row.category === state.ui.category));
}

/** Reject only an explicitly selected proposal; no text or draft is removed. */
export function rejectProposal(state, requestId, id) {
  const request = state.requests.find(item => item.id === requestId) ?? fail('UNKNOWN_REQUEST');
  const target = request.targets.find(item => item.id === id) ?? fail('UNSELECTED_RECEIPT');
  if (target.status !== 'proposed') fail('NOT_PROPOSED');
  target.status = 'rejected';
}

/** Resolve a competing draft only after comparing it with the current saved draft. */
export function acceptCompetingDraft(state, id, index, expectedRevision) {
  const alternative = state.draftConflicts?.[id]?.[index] ?? fail('UNKNOWN_DRAFT_CONFLICT');
  if ((state.drafts[id]?.revision ?? 0) !== expectedRevision) fail('DRAFT_CONFLICT');
  const old = state.drafts[id];
  saveDraft(state, id, values(alternative), alternative.baseVersion, expectedRevision);
  state.draftConflicts[id].splice(index, 1);
  if (old) state.draftConflicts[id].push({ ...values(old), baseVersion: old.baseVersion });
}

/** A page-owned controlled Worker cannot survive reload. This is not a production task failure. */
export function interruptFixtureTransport(state, ownerId) {
  for (const request of state.requests) {
    if (request.transportOwner !== ownerId) continue;
    for (const target of request.targets) if (['queued', 'accepted'].includes(target.status)) target.status = 'interrupted';
  }
}

/** Resume only explicitly interrupted fixture targets, retaining request identity and successful items. */
export function resumeInterrupted(state, requestId) {
  const request = state.requests.find(item => item.id === requestId) ?? fail('UNKNOWN_REQUEST');
  const targets = request.targets.filter(target => target.status === 'interrupted');
  if (!targets.length) fail('NOTHING_TO_RESUME');
  for (const target of targets) { target.attempt += 1; target.status = 'queued'; }
  return { ...copy(request), targets: copy(targets) };
}

/** Queue editor saves using acknowledged revisions; once stale, every queued input stays a conflict. */
export function queueDraftWrite(writer, write) {
  const result = writer.chain.then(async () => {
    const result = await write(writer.blocked ? -1 : writer.revision);
    if (result.conflict) writer.blocked = true;
    else writer.revision = result.revision;
    return result;
  });
  writer.chain = result;
  return result;
}
