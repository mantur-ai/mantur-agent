import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workbench, version } from '../model.mjs';
import { existingConversationSender } from '../dsh-bridge.mjs';
const episode = '01-雨夜来客.md';
async function setup(t) {
  const project = await mkdtemp(join(tmpdir(), 'script-test-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  for (const file of [episode, '02-倒走的钟.md']) await copyFile(new URL(`../fixtures/${file}`, import.meta.url), join(project, file));
  const messages = [];
  const storage = { project, read: path => readFile(join(project, path), 'utf8'),
    async write(path, expected, text) { assert.equal(await this.read(path), expected, 'disk version conflict'); await writeFile(join(project, path), text); } };
  const send = existingConversationSender('main-session', { conversation: { async send(text) { messages.push(text); } } });
  const bench = new Workbench(storage, 'main-session', send);
  const doc = await bench.open(episode);
  return { bench, doc, storage, messages, project };
}
async function select(bench, doc, occurrence = 'first') {
  const text = '林夏：你终于来了。';
  const start = occurrence === 'last' ? doc.text.lastIndexOf(text) : doc.text.indexOf(text);
  return bench.request(episode, start, start + text.length, '改为：林夏：你不该回来的。');
}
test('real two-episode files preserve drafts across navigation and panel collapse', async t => {
  const { bench, doc } = await setup(t);
  bench.edit(episode, doc.text + '\n草稿');
  await bench.open('02-倒走的钟.md'); bench.close();
  assert.equal(bench.show('agent'), false); bench.show();
  assert.match((await bench.open(episode)).text, /草稿$/);
});
test('save changes original file and undo restores it', async t => {
  const { bench, doc, storage } = await setup(t); const before = doc.text;
  bench.edit(episode, before + '\n手动编辑'); await bench.save(episode);
  assert.equal(await storage.read(episode), doc.text);
  await bench.undo(episode); assert.equal(await storage.read(episode), before);
});
test('explicit delivery logs project, exact selection, version and existing session; admission does not complete', async t => {
  const { bench, doc, messages } = await setup(t);
  assert.equal(messages.length, 0);
  const r = await select(bench, doc);
  const payload = JSON.parse(messages[0]);
  assert.equal(payload.version, await version(doc.text));
  assert.equal(payload.sessionId, 'main-session'); assert.equal(payload.file, episode);
  assert.equal(payload.selected, '林夏：你终于来了。'); assert.equal(r.status, 'queued');
});
test('controlled rewrite targets second identical occurrence, reads file back and restores version', async t => {
  const { bench, doc, storage } = await setup(t); const before = doc.text;
  const r = await select(bench, doc, 'last'); await bench.execute(r.id, '林夏：你不该回来的。');
  assert.equal(await storage.read(episode), before.slice(0, r.start) + '林夏：你不该回来的。' + before.slice(r.end));
  assert.equal(r.status, 'completed'); assert.equal(doc.text.indexOf(r.selected), before.indexOf(r.selected));
  await bench.undo(episode); assert.equal(await storage.read(episode), before);
});
test('continued manual edit invalidates queued result without losing draft or changing disk', async t => {
  const { bench, doc, storage } = await setup(t); const before = doc.text;
  const r = await select(bench, doc); bench.edit(episode, before + '\n继续手改');
  await assert.rejects(bench.execute(r.id, '旧结果'), /冲突/);
  assert.equal(await storage.read(episode), before); assert.match(doc.text, /继续手改$/);
});
test('external write rejects old Agent result and unsafe undo', async t => {
  const { bench, doc, storage, project } = await setup(t); const r = await select(bench, doc);
  await writeFile(join(project, episode), doc.text + '\n外部改动');
  await assert.rejects(bench.execute(r.id, '旧结果'), /冲突/);
  assert.match(await storage.read(episode), /外部改动$/);
  await bench.refresh(episode); await writeFile(join(project, episode), '另一次外部编辑');
  await assert.rejects(bench.undo(episode), /version conflict/);
});
test('unsaved drafts cannot be sent or overwritten by refresh', async t => {
  const { bench, doc, project } = await setup(t); bench.edit(episode, doc.text + '草稿');
  await assert.rejects(select(bench, doc), /先保存/);
  await writeFile(join(project, episode), '外部版本');
  await assert.rejects(bench.refresh(episode), /草稿已保留/); assert.match(doc.text, /草稿$/);
});
test('cancelled request refuses late execution; failed delivery stays failed', async t => {
  const { bench, doc, storage } = await setup(t); const before = doc.text;
  const r = await select(bench, doc); bench.cancel(r.id);
  await assert.rejects(bench.execute(r.id, '迟到结果'), /取消/); assert.equal(await storage.read(episode), before);
  bench.send = async () => { throw new Error('发送失败'); };
  await assert.rejects(select(bench, doc), /发送失败/);
  assert.equal([...bench.requests.values()].at(-1).status, 'failed');
});
test('readback detects a subsequent external change and does not claim completion', async t => {
  const { bench, doc, storage } = await setup(t); const r = await select(bench, doc);
  const write = storage.write.bind(storage);
  storage.write = async (...args) => { await write(...args); storage.read = async () => '外部后续版本'; };
  await assert.rejects(bench.execute(r.id, '新段落'), /写入后/);
  assert.equal(r.status, 'readback-conflict');
});
test('bridge refuses wrong session instead of opening another conversation', async () => {
  let calls = 0;
  const send = existingConversationSender('main', { conversation: { send: async () => { calls++; } } });
  await assert.rejects(send('{"sessionId":"other"}'), /another session/); assert.equal(calls, 0);
});
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
test('a rejected Agent result cannot unlock an in-flight manual save', async t => {
  const { bench, doc, storage } = await setup(t); const r = await select(bench, doc);
  const entered = deferred(), release = deferred(); const write = storage.write.bind(storage);
  storage.write = async (...args) => { entered.resolve(); await release.promise; await write(...args); };
  const saving = bench.save(episode); await entered.promise;
  await assert.rejects(bench.execute(r.id, '旧结果'), /冲突/);
  assert.equal(doc.busy, true); assert.throws(() => bench.edit(episode, '新草稿'), /正在写入/);
  release.resolve(); await saving; assert.equal(doc.busy, false);
  assert.equal(doc.base, await storage.read(episode));
});
test('commit phase refuses cancellation instead of promising an impossible abort', async t => {
  const { bench, doc, storage } = await setup(t); const r = await select(bench, doc);
  const entered = deferred(), release = deferred(); const write = storage.write.bind(storage);
  storage.write = async (...args) => { entered.resolve(); await release.promise; await write(...args); };
  const execution = bench.execute(r.id, '新的对白'); await entered.promise;
  assert.equal(r.status, 'committing'); assert.throws(() => bench.cancel(r.id), /不能取消/);
  release.resolve(); await execution; assert.equal(r.status, 'completed');
});
test('cancellation during pre-write read prevents any write', async t => {
  const { bench, doc, storage } = await setup(t); const r = await select(bench, doc);
  const entered = deferred(), release = deferred(); const read = storage.read.bind(storage);
  let writes = 0; storage.write = async () => { writes++; };
  storage.read = async file => { entered.resolve(); await release.promise; return read(file); };
  const execution = bench.execute(r.id, '旧结果'); await entered.promise;
  bench.cancel(r.id); release.resolve(); await assert.rejects(execution, /取消/);
  assert.equal(writes, 0); assert.equal(r.status, 'cancelled');
});
