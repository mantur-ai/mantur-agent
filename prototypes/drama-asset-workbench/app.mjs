/** Browser-only fixture application. No login, provider credentials or production project access. */
import * as model from './model.mjs';
import { zh as t } from './locales.mjs';
const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const KEY = 'drama-workbench:fixture-main-session:fixture-drama-lantern:v1';
const fixtureResponse = await fetch('./fixture.json');
if (!fixtureResponse.ok) throw new Error('FIXTURE_LOAD_FAILED');
const fixture = model.validateFixture(await fixtureResponse.json());
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const read = () => {
  const text = localStorage.getItem(KEY);
  const value = text === null ? model.createState(fixture) : JSON.parse(text);
  if (value.schema !== 1 || value.projectId !== fixture.projectId) throw new Error('STORAGE_VERSION_INVALID');
  return value;
};
const ownerId = sessionStorage.getItem(`${KEY}:owner`) ?? crypto.randomUUID();
sessionStorage.setItem(`${KEY}:owner`, ownerId);
let state = read();
let draftWriter;
const worker = new Worker('./agent-worker.mjs', { type: 'module' });
const inform = message => { notice.textContent = message; };
const error = problem => inform(`${t.failure}：${t.errors[problem.message] ?? problem.message}`);

/** Serialize per-origin fixture writes across tabs; read latest state inside the lock. */
async function transact(action, repaint = true) {
  if (!navigator.locks) throw new Error('STORAGE_UNAVAILABLE');
  return navigator.locks.request(KEY, () => {
    const next = read();
    const result = action(next);
    localStorage.setItem(KEY, JSON.stringify(next));
    state = next;
    if (repaint) render();
    return result;
  });
}
const button = (action, text, options = '') => `<button data-action="${action}" ${options}>${esc(text)}</button>`;
const badge = (text, warn = false) => `<span class="badge${warn ? ' warn' : ''}">${esc(text)}</span>`;
const statuses = { ...t, applied: t.appliedStatus, failed: t.agentFailed };
const option = (value, text, selected) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(text)}</option>`;
function media(row, detail = false) {
  if (!row.media) return `<div class="placeholder"><strong>${esc(t[row.status] ?? t.noMedia)}</strong><small>${esc(t.noMedia)}</small></div>`;
  if (!fixture.mediaAllowlist.includes(row.media)) throw new Error('MEDIA_NOT_ALLOWED');
  if (row.kind === 'image') return `<img class="${detail ? 'preview' : 'thumb'}" src="${esc(row.media)}" alt="${esc(row.name)} · ${esc(t.synthetic)}">`;
  return `<video class="${detail ? 'preview' : 'thumb'}" src="${esc(row.media)}" ${detail ? 'controls' : ''} preload="metadata" muted playsinline aria-label="${esc(row.name)} · ${esc(t.synthetic)}"></video>`;
}
function detailMarkup(row) {
  if (!row) return `<p>${esc(t.empty)}</p>`;
  const draft = state.drafts[row.id];
  const edit = draft ?? row;
  const conflict = draft && draft.baseVersion !== row.version;
  const next = state.rows.filter(item => item.previousClipId === row.id);
  return `<h2>${esc(row.name)}</h2>${media(row, true)}<small>${esc(t.synthetic)}</small>
    <dl><dt>ID</dt><dd>${esc(row.id)}</dd><dt>${t.version}</dt><dd>v${row.version}</dd>
    <dt>${t.source}</dt><dd>${esc(row.source.revision)} · ${esc(row.source.evidence)}</dd>
    ${row.kind === 'image' ? `<dt>${t.base}</dt><dd>${esc(row.baseAssetId)} / ${esc(row.variant)}</dd>` : ''}
    <dt>${t.scopes}</dt><dd>${row.scopes.map(scope => `EP${scope.episode} / ${esc(scope.scene)}`).join('，')}</dd>
    <dt>${t.task}</dt><dd>${esc(row.generation?.taskId ?? t.noGeneration)}</dd></dl>
    ${row.generation && row.version !== row.generation.version ? `<p class="warning">${t.stale} v${row.generation.version}</p>` : ''}
    <h3>${t.references}</h3><p class="id">${row.references.map(ref => `${esc(ref.id)} @v${ref.version} · ${esc(ref.roles.join('/'))}`).join('<br>') || t.noReferences}</p>
    ${row.kind === 'video' ? `<h3>${t.dependency}</h3><p>${esc(row.previousClipId ?? t.firstClip)}</p>${row.previousClipId ? `<p class="warning">${t.tailMissing}</p>` : ''}<small>${t.next}：${next.map(item => esc(item.id)).join('，') || '—'}</small>` : ''}
    <label>${t.prompt}<textarea id="prompt" data-id="${esc(row.id)}" data-version="${row.version}" data-draft-revision="${draft?.revision ?? 0}">${esc(edit.prompt)}</textarea></label>
    <label>${t.negative}<textarea id="negativePrompt" data-id="${esc(row.id)}" data-version="${row.version}" data-draft-revision="${draft?.revision ?? 0}">${esc(edit.negativePrompt)}</textarea></label>
    <small>${t.draftHint}</small>
    ${(state.draftConflicts?.[row.id] ?? []).map((alternative, index) => `<section class="warning"><strong>${t.competing}</strong><pre>${esc(alternative.prompt)}\n${esc(alternative.negativePrompt)}</pre>${button('accept-competing', t.useCompeting, `data-index="${index}" data-revision="${draft?.revision ?? 0}"`)}</section>`).join('')}
    ${conflict ? `<p class="warning">${t.sourceChanged}</p><pre>${esc(row.prompt)}</pre>${button('rebase', t.rebase)}` : ''}
    <div class="actions">${button('save', t.save)}${button('apply-draft', t.applyDraft, draft && !conflict ? '' : 'disabled')}</div>
    <h3>${t.impact}</h3><p class="id">${model.impactOf(state, row.id).map(esc).join(' · ')}</p><small>${t.noAuto}</small>
    <label>${t.requirement}<textarea id="single-requirement" placeholder="${esc(t.requirementPlaceholder)}">${esc(state.ui.singleRequirement ?? '')}</textarea></label>
    <div class="actions">${button('send-single', t.sendSingle, 'class="primary"')}</div>
    <details><summary>${t.historical}</summary><pre>${esc(row.generation ? row.generation.prompt : t.noGeneration)}</pre></details>
    ${row.template ? `<details><summary>${t.template}</summary><pre>${esc(JSON.stringify(row.template, null, 2))}</pre></details>` : ''}
    <details><summary>${t.actual}</summary><pre>${esc(row.generation ? JSON.stringify(row.generation.actualRequest, null, 2) : t.noGeneration)}</pre></details>`;
}
function requestMarkup(request) {
  return `<section class="request"><strong>${esc(request.requirement)}</strong><p class="id">${esc(request.id)} · ${esc(request.sessionId)} · ${request.targets.length} ${t.items}</p>
    ${request.targets.map(target => `<div><h3>${esc(target.id)} ${badge(statuses[target.status], ['conflict', 'failed'].includes(target.status))}</h3>
    ${target.status === 'proposed' ? `<div class="actions">${button('apply-one', t.applyOne, `data-request="${esc(request.id)}" data-target="${esc(target.id)}"`)}${button('reject-one', t.rejectOne, `data-request="${esc(request.id)}" data-target="${esc(target.id)}"`)}</div>` : ''}
    ${target.proposal ? `<div class="diff"><div><small>${t.before} · v${target.baseVersion}</small><pre>${esc(target.before.prompt)}\n${esc(target.before.negativePrompt)}</pre></div><div><small>${t.after}</small><pre class="after">${esc(target.proposal.prompt)}\n${esc(target.proposal.negativePrompt)}</pre></div></div>` : ''}</div>`).join('')}
    <div class="actions">${button('confirm', t.confirm, `data-request="${esc(request.id)}" ${request.targets.some(target => target.status === 'proposed') ? 'class="primary"' : 'disabled'}`)}${button('retry', t.retry, `data-request="${esc(request.id)}" ${request.targets.some(target => target.status === 'failed') ? '' : 'disabled'}`)}${button('resume', t.resume, `data-request="${esc(request.id)}" ${request.targets.some(target => target.status === 'interrupted') ? '' : 'disabled'}`)}</div></section>`;
}
function render() {
  const focused = document.activeElement;
  const focusInfo = focused?.tagName === 'TEXTAREA' ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd } : null;
  if (state.panel.hidden) {
    app.innerHTML = `<main class="collapsed"><h1>${t.title}</h1><p>${t.collapsed}</p><div class="actions">${button('open', t.reopen, 'class="primary"')}${button('agent-open', t.agentOpen)}</div><small>${t.fixture}</small></main>`;
    return;
  }
  const visible = model.visibleRows(state);
  const row = state.rows.find(item => item.id === state.ui.detail);
  draftWriter = row ? { id: row.id, revision: state.drafts[row.id]?.revision ?? 0, blocked: false, chain: Promise.resolve() } : undefined;
  const scenes = [...new Set(state.rows.flatMap(item => item.scopes).filter(scope => !state.ui.episode || String(scope.episode) === state.ui.episode).map(scope => `${scope.episode}/${scope.scene}`))];
  app.innerHTML = `<header><div><span class="fixture">${t.fixture}</span><h1>${t.title}</h1><p class="muted">${esc(state.project.name)} · ${t.subtitle}</p></div>${button('close', t.close)}</header>
    <nav class="toolbar" aria-label="素材筛选"><div class="tabs" role="tablist">${button('tab-image', t.images, `role="tab" aria-selected="${state.ui.tab === 'image'}"`)}${button('tab-video', t.videos, `role="tab" aria-selected="${state.ui.tab === 'video'}"`)}</div>
    <label>${t.episode}<select id="episode">${option('', t.allEpisodes, state.ui.episode)}${[1, 2].map(ep => option(String(ep), `EP${ep}`, state.ui.episode)).join('')}</select></label>
    <label>${t.scene}<select id="scene">${option('', t.allScenes, state.ui.scene)}${scenes.map(sc => option(sc, `EP${sc}`, state.ui.scene)).join('')}</select></label>
    ${state.ui.tab === 'image' ? `<label>${t.category}<select id="category">${option('', t.allCategories, state.ui.category)}${[['character', t.character], ['scene', t.sceneCategory], ['prop', t.prop]].map(([id, text]) => option(id, text, state.ui.category)).join('')}</select></label>` : ''}</nav>
    <main class="workspace"><section class="library"><div class="selectionbar"><strong>${t.selection} ${state.ui.selected.length} ${t.items} / ${visible.length}</strong>${button('select-all', t.selectAll)}${button('clear', t.clear)}</div>
    <div class="grid">${visible.map(item => `<article class="asset" data-current="${row?.id === item.id}"><label class="pick"><input type="checkbox" data-select="${esc(item.id)}" ${state.ui.selected.includes(item.id) ? 'checked' : ''} aria-label="${t.select} ${esc(item.id)}"></label><button class="mediaButton" data-detail="${esc(item.id)}" aria-label="${t.preview} ${esc(item.name)}">${media(item)}</button><div class="assetText"><button data-detail="${esc(item.id)}">${esc(item.name)}</button><p class="id">${esc(item.id)} · v${item.version}</p>${badge(t[item.status])}${item.needsReview ? badge(t.review, true) : ''}${state.drafts[item.id] ? badge(t.draftBadge, true) : ''}</div></article>`).join('') || `<p>${t.empty}</p>`}</div>
    <section class="batch"><h2>${t.sendBatch}</h2><small>${t.scopeHint}</small><ul class="scope">${state.ui.selected.map(id => `<li>${esc(id)}</li>`).join('')}</ul><label>${t.requirement}<textarea id="batch-requirement" placeholder="${esc(t.requirementPlaceholder)}">${esc(state.ui.batchRequirement ?? '')}</textarea></label><div class="actions">${button('send-batch', t.sendBatch, `class="primary" ${state.ui.selected.length ? '' : 'disabled'}`)}</div></section></section>
    <aside class="detail" aria-label="${t.detail}">${detailMarkup(row)}</aside></main>
    <section class="requestlog"><h2>${t.requests}</h2><p class="muted">${t.transportHint}</p>${state.requests.slice().reverse().map(requestMarkup).join('') || `<p>${t.noRequests}</p>`}
    <details><summary>${t.history} (${state.history.length})</summary>${state.history.map((entry, index) => `<p>${esc(entry.id)} · v${entry.before.version} → v${entry.after.version} · ${esc(entry.reason)}</p><pre>${esc(entry.before.prompt)}</pre>${button('restore', t.restore, `data-index="${index}" data-version="${state.rows.find(item => item.id === entry.id).version}"`)}`).join('') || t.noHistory}</details></section>
    <details class="verify"><summary>${t.verify}</summary><div class="actions">${button('external', t.simulate)}${button('agent-open', t.agentOpen)}${button('refresh', t.latest)}</div></details>`;
  app.querySelectorAll('img,video').forEach(element => element.addEventListener('error', () => {
    const text = document.createElement('p'); text.className = 'warning'; text.textContent = t.mediaError; element.replaceWith(text);
  }, { once: true }));
  if (focusInfo) { const input = document.getElementById(focusInfo.id); input?.focus(); input?.setSelectionRange(focusInfo.start, focusInfo.end); }
}
function currentFields() { return { prompt: document.querySelector('#prompt').value, negativePrompt: document.querySelector('#negativePrompt').value }; }
async function send(ids, requirement) {
  const request = await transact(next => {
    const request = model.queueRequest(next, ids, requirement, crypto.randomUUID());
    next.requests.find(item => item.id === request.id).transportOwner = ownerId;
    request.transportOwner = ownerId;
    return request;
  });
  worker.postMessage(request); inform(t.queuedMessage);
}
app.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'prompt' || input.id === 'negativePrompt') {
    const fields = currentFields(), id = input.dataset.id, version = Number(input.dataset.version);
    const writer = draftWriter;
    model.queueDraftWrite(writer, revision => transact(next => model.saveDraft(next, id, fields, version, revision), false)).then(result => {
      if (result.conflict) { render(); inform(t.competing); }
      else if (writer === draftWriter) for (const element of app.querySelectorAll('#prompt, #negativePrompt')) element.dataset.draftRevision = String(result.revision);
    }).catch(error);
  } else if (input.id.endsWith('-requirement')) {
    const key = input.id === 'single-requirement' ? 'singleRequirement' : 'batchRequirement';
    const value = input.value;
    transact(next => { next.ui[key] = value; }, false).catch(error);
  }
});
app.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset.select) transact(next => {
    const id = target.dataset.select;
    next.ui.selected = target.checked ? [...new Set([...next.ui.selected, id])] : next.ui.selected.filter(value => value !== id);
  }).catch(error);
  else if (['episode', 'scene', 'category'].includes(target.id)) transact(next => model.changeFilter(next, target.id, target.value)).catch(error);
});
app.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  try {
    if (target.dataset.detail) { await transact(next => { next.ui.detail = target.dataset.detail; }); return; }
    const id = state.ui.detail;
    switch (target.dataset.action) {
      case 'close': await transact(next => model.setPanel(next, 'user-close')); break;
      case 'open': await transact(next => model.setPanel(next, 'user-open')); break;
      case 'agent-open': await transact(next => model.setPanel(next, 'agent-open')); break;
      case 'tab-image': case 'tab-video': await transact(next => { model.changeFilter(next, 'tab', target.dataset.action.slice(4)); next.ui.detail = model.visibleRows(next)[0]?.id; }); break;
      case 'select-all': await transact(next => { next.ui.selected = model.visibleRows(next).map(row => row.id); }); break;
      case 'clear': await transact(next => { next.ui.selected = []; }); break;
      case 'save': { await draftWriter?.chain; const fields = currentFields(); const version = Number(document.querySelector('#prompt').dataset.version); const revision = Number(document.querySelector('#prompt').dataset.draftRevision); const result = await transact(next => model.saveDraft(next, id, fields, version, revision)); inform(result.conflict ? t.competing : t.draftSaved); break; }
      case 'apply-draft': await transact(next => model.applyDraft(next, id)); inform(t.applied); break;
      case 'accept-competing': await transact(next => model.acceptCompetingDraft(next, id, Number(target.dataset.index), Number(target.dataset.revision))); break;
      case 'apply-one': await transact(next => model.applyProposals(next, target.dataset.request, [target.dataset.target])); break;
      case 'reject-one': await transact(next => model.rejectProposal(next, target.dataset.request, target.dataset.target)); break;
      case 'resume': { const request = await transact(next => { const request = model.resumeInterrupted(next, target.dataset.request); next.requests.find(item => item.id === request.id).transportOwner = ownerId; request.transportOwner = ownerId; return request; }); worker.postMessage(request); break; }
      case 'rebase': await transact(next => model.rebaseDraft(next, id)); break;
      case 'send-single': await send([id], document.querySelector('#single-requirement').value); break;
      case 'send-batch': await send(state.ui.selected, document.querySelector('#batch-requirement').value); break;
      case 'confirm': {
        await transact(next => model.applyProposals(next, target.dataset.request));
        const targets = state.requests.find(request => request.id === target.dataset.request).targets;
        inform(`${t.appliedStatus} ${targets.filter(item => item.status === 'applied').length} · ${t.conflict} ${targets.filter(item => item.status === 'conflict').length} · ${t.agentFailed} ${targets.filter(item => item.status === 'failed').length}`);
        break;
      }
      case 'retry': { const request = await transact(next => { const request = model.retryFailed(next, target.dataset.request); next.requests.find(item => item.id === request.id).transportOwner = ownerId; request.transportOwner = ownerId; return request; }); worker.postMessage(request); break; }
      case 'restore': await transact(next => model.restoreHistory(next, Number(target.dataset.index), Number(target.dataset.version))); break;
      case 'external': await transact(next => model.simulateExternalEdit(next, id)); break;
      case 'refresh': state = read(); render(); break;
    }
  } catch (problem) { error(problem); }
});
worker.addEventListener('message', ({ data }) => {
  transact(next => {
    if (data.type === 'accepted') for (const target of data.targets) model.acknowledge(next, data.requestId, target.attempt, [target.id]);
    else if (data.type === 'proposal') model.receiveProposal(next, data.requestId, data.results);
    else throw new Error('UNKNOWN_RECEIPT');
  }).catch(error);
});
worker.addEventListener('error', () => { transact(next => model.interruptFixtureTransport(next, ownerId)).catch(error); inform(t.interrupted); });
window.addEventListener('storage', event => { if (event.key === KEY) { try { state = read(); render(); } catch (problem) { error(problem); } } });
await transact(next => model.interruptFixtureTransport(next, ownerId));
