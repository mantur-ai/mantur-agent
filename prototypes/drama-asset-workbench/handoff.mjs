/** Isolated main-session adapter protocol. No transport, source-file writes or media calls. */
import { queueRequest, acknowledge, receiveProposal, applyProposals, retryFailed } from './model.mjs';

const fail = code => { throw new Error(code); };
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function pinsFor(state, ids, currentSources) {
  const pins = {};
  const visit = id => {
    const row = state.rows.find(row => row.id === id) ?? fail('UNKNOWN_TARGET');
    if (pins[id]) return;
    const source = row.source;
    if (!source.documentId || !source.table || !fingerprint(source.revision)) fail('UNBOUND_SOURCE');
    if (currentSources[source.documentId] !== source.revision) fail('SOURCE_CHANGED');
    pins[id] = { documentId: source.documentId, table: source.table, rowId: row.id, sha256: source.revision, version: row.version };
    if (row.kind === 'image' && row.baseAssetId !== row.id) visit(row.baseAssetId);
    for (const reference of row.references) visit(reference.id);
    if (row.previousClipId) visit(row.previousClipId);
  };
  ids.forEach(visit);
  return pins;
}

function requestFor(state, event) {
  const request = state.requests.find(request => request.id === event.requestId) ?? fail('UNKNOWN_REQUEST');
  if (request.mode !== 'main-agent-proposal-v1' || event.projectId !== request.projectId || event.sessionId !== request.sessionId) fail('UNRELATED_RECEIPT');
  return request;
}

function pinsMatch(state, pins, currentSources) {
  return Object.values(pins).every(pin => {
    const row = state.rows.find(row => row.id === pin.rowId);
    return row && row.version === pin.version && row.source.documentId === pin.documentId && row.source.table === pin.table && row.source.revision === pin.sha256 && currentSources[pin.documentId] === pin.sha256;
  });
}

function envelopeFor(request) {
  return {
    schema: 'drama-prompt-edit-v1', intent: 'propose-text-only', requestId: request.id,
    projectId: request.projectId, sessionId: request.sessionId, requirement: request.requirement, context: request.context,
    allowedFields: request.fields, targets: request.targets.map(target => ({
      id: target.id, attempt: target.attempt, locator: request.sourcePins[target.id][target.id],
      before: target.before, draft: target.draft, draftRevision: target.draftRevision,
      context: target.context, sourcePins: request.sourcePins[target.id],
    })),
  };
}

/**
 * Freeze one or several selected targets and their referenced source fingerprints.
 * @param state Isolated workbench state, mutated only after every selected source validates.
 * @param input Explicit main-session address, request identity, target IDs and edit requirement.
 * @param currentSources Host-read document fingerprints; never guessed from target data.
 * @returns A proposal-only envelope; queued means prepared, not admitted or completed.
 */
export function prepareHandoff(state, input, currentSources) {
  if (!input.sessionId?.trim() || !input.requestId?.trim()) fail('MISSING_ADDRESS');
  const sourcePins = Object.fromEntries(input.ids.map(id => [id, pinsFor(state, [id], currentSources)]));
  const request = queueRequest(state, input.ids, input.requirement, input.requestId);
  Object.assign(request, { sessionId: input.sessionId, mode: 'main-agent-proposal-v1', sourcePins });
  state.requests[state.requests.length - 1] = structuredClone(request);
  return envelopeFor(request);
}

/**
 * Prepare another attempt only for failed items whose pinned sources remain current.
 * @param state Isolated request store.
 * @param address Original project/session/request identity.
 * @param currentSources Fresh host-read fingerprints; stale sources require a new reviewed request.
 * @returns An envelope with the original request ID and only failed targets, without sending it.
 */
export function retryHandoff(state, address, currentSources) {
  const request = requestFor(state, address);
  if (request.targets.some(target => target.status === 'failed' && !pinsMatch(state, request.sourcePins[target.id], currentSources))) fail('SOURCE_CHANGED');
  return envelopeFor(retryFailed(state, request.id));
}

/**
 * Record correlated admission or per-item proposals; admission never applies edits.
 * @param state Isolated request store.
 * @param event Receipt with exact project/session/request identity and explicit item attempts.
 * @returns Nothing; malformed or unrelated receipts throw before any mutation.
 */
export function receiveHandoff(state, event) {
  const request = requestFor(state, event);
  if (event.type === 'admitted') {
    if (!Number.isInteger(event.attempt) || !Array.isArray(event.ids) || !event.ids.length || new Set(event.ids).size !== event.ids.length || event.ids.some(id => !request.targets.some(target => target.id === id))) fail('INVALID_ADMISSION');
    acknowledge(state, request.id, event.attempt, event.ids);
  } else if (event.type === 'proposals') {
    if (!Array.isArray(event.results) || !event.results.length) fail('INVALID_PROPOSALS');
    for (const result of event.results) {
      if (!Number.isInteger(result.attempt) || result.attempt < 1 || (result.error !== undefined && result.error !== 'AGENT_EDIT_FAILED')) fail('INVALID_PROPOSALS');
    }
    receiveProposal(state, request.id, event.results);
  } else fail('UNKNOWN_RECEIPT_TYPE');
}

/**
 * Confirm selected proposals against fresh source, dependency and local draft revisions.
 * @param state Isolated store; no source files or media records are written.
 * @param address Project/session/request identity plus explicitly approved target IDs.
 * @param currentSources Fingerprints freshly read by the host before its local transaction.
 * @returns Nothing; source conflicts preserve proposals and drafts for comparison.
 */
export function confirmHandoff(state, address, currentSources) {
  const request = requestFor(state, address);
  if (!Array.isArray(address.ids) || !address.ids.length || new Set(address.ids).size !== address.ids.length || address.ids.some(id => !request.targets.some(target => target.id === id))) fail('INVALID_CONFIRMATION');
  // Evaluate every selected target before applying any sibling revision.
  const stale = address.ids.filter(id => !pinsMatch(state, request.sourcePins[id], currentSources));
  for (const target of request.targets) if (stale.includes(target.id) && target.status === 'proposed') target.status = 'conflict';
  applyProposals(state, request.id, address.ids.filter(id => !stale.includes(id)));
}
