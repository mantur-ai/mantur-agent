/** Browser-only validation UI. No model endpoint, account, token or session creation. */
import { renderMarkdown } from "./markdown.mjs";
import { Workbench } from './model.mjs';
const $ = id => document.getElementById(id);
let bench, path, selection, reading = true, navigation = 0;
const instructions = new Map();
const statusNames = { sending: '投递中', queued: '已投递，等待受控执行', running: '执行中', committing: '正在写入，不能取消', completed: '文件已修改并读回', cancelled: '已取消', failed: '失败，查看提示', written: '已写入，正在读回', 'readback-conflict': '已写入，但读回冲突' };
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
async function run(action) {
  try { const pending = action(); render(); await pending; render(); }
  catch (error) { status(error.message, true); render(); }
}
async function api(route, body) {
  const response = await fetch(route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function render() {
  if (!bench) return;
  $('panel').hidden = !bench.visible;
  document.querySelector('main').classList.toggle('closed', !bench.visible);
  $('toggle').textContent = bench.visible ? '收起工作台' : '打开工作台';
  $('requests').replaceChildren(...[...bench.requests.values()].map(r => {
    const li = document.createElement('li');
    const title = document.createElement('strong'); title.textContent = `${r.path} · ${statusNames[r.status]}`;
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '查看实际投递内容';
    const pre = document.createElement('pre'); pre.textContent = bench.payload(r);
    details.append(summary, pre); li.append(title, details);
    if (r.error) { const p = document.createElement('p'); p.textContent = r.error; li.append(p); }
    return li;
  }));
  const doc = bench.documents.get(path);
  if (!doc) return;
  $('editor').disabled = doc.busy;
  $('dirty').textContent = doc.busy ? '正在保存' : doc.text === doc.base ? '已保存' : '有未保存修改';
  for (const id of ['save', 'send', 'refresh', 'undo']) $(id).disabled = doc.busy;
  if (/\.md$/i.test(path)) $('preview').innerHTML = renderMarkdown(doc.text);
  else $('preview').textContent = doc.text;
  $('preview').classList.toggle('plain-text', !/\.md$/i.test(path));
  $('editor').hidden = reading;
  $('preview').hidden = !reading;
  $('mode').textContent = reading ? '编辑正文' : '阅读预览';
  $('selection-hint').textContent = reading ? '阅读预览 · 要修改选段，请先切换「编辑正文」' : '选中一段文字，即可填写改写要求';
  $('document').classList.toggle('has-selection', selection?.path === path && selection?.revision === doc.revision);
  const change = doc.history.at(-1);
  $('change').hidden = !change;
  $('before').textContent = change?.before ?? '';
  $('after').textContent = change?.after ?? '';
}
async function choose(next) {
  const ticket = ++navigation;
  const owner = bench;
  $('editor').disabled = true;
  const doc = await owner.open(next);
  if (ticket !== navigation || owner !== bench) return;
  path = next; selection = undefined;
  $('filename').textContent = next;
  $('editor').value = doc.text;
  $('instruction').value = instructions.get(next) ?? '';
  $('selection').textContent = '先在正文中选中文字';
  $('change').open = false;
  $('document').hidden = false; $('empty').hidden = true;
  for (const b of $('episodes').children) b.setAttribute('aria-current', String(b.dataset.path === next));
  render();
}
async function load(storage, files) {
  if (bench && ([...bench.documents.values()].some(d => d.text !== d.base) || [...bench.requests.values()].some(r => ['queued', 'running', 'sending', 'committing'].includes(r.status)))) throw new Error('当前项目有未保存草稿或待处理请求，请先保存并处理请求');
  bench = new Workbench(storage, 'isolated-controlled-session', async () => {});
  path = undefined; navigation++; instructions.clear();
  $('project').textContent = storage.project;
  $('episodes').replaceChildren(...files.map(file => { const button = document.createElement('button'); button.textContent = file.replace(/\.(md|txt|fountain)$/i, '').replace(/^(\d+)-/, '第 $1 集 · '); button.dataset.path = file; button.onclick = () => run(() => choose(file)); return button; }));
  $('document').hidden = true; $('empty').hidden = files.length > 0;
  if (files.length) await choose(files[0]);
  status('项目已打开。验收页仅使用受控适配器，不发送真实 Agent 消息。');
  render();
}
$('fixture').onclick = () => run(async () => {
  const project = await api('/api/project');
  await load({ project: `合成验收项目 · ${project.project}`, read: async file => (await api(`/api/file/${encodeURIComponent(file)}`)).text,
    write: async (file, expected, text) => { await api('/api/save', { path: file, expected, text }); } }, project.files);
});
$('pick').onclick = () => run(async () => {
  if (!window.showDirectoryPicker) throw new Error('此浏览器不支持目录读写，请在 Chrome / Edge 中打开本地预览');
  const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
  const handles = new Map();
  async function walk(dir, prefix = '') {
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const file = prefix + name;
      if (handle.kind === 'directory') await walk(handle, file + '/');
      else if (/\.(md|txt|fountain)$/i.test(name)) handles.set(file, handle);
    }
  }
  await walk(directory);
  await load({ project: directory.name, read: async file => (await handles.get(file).getFile()).text(),
    write: async (file, expected, text) => {
      const handle = handles.get(file);
      if (await (await handle.getFile()).text() !== expected) throw new Error('本地文件版本冲突，未写入');
      const writer = await handle.createWritable({ mode: 'exclusive' });
      try {
        if (await (await handle.getFile()).text() !== expected) throw new Error('本地文件版本冲突，未写入');
        await writer.write(text); await writer.close();
      } catch (error) { await writer.abort(); throw error; }
    } }, [...handles.keys()].sort((a, b) => a.localeCompare(b, 'zh', { numeric: true })));
});
$('editor').oninput = () => { bench.edit(path, $('editor').value); selection = undefined; $('selection').textContent = '正文已编辑，请保存后重新选择'; render(); };
$('editor').onselect = () => {
  const { selectionStart: start, selectionEnd: end } = $('editor');
  if (start === end) return;
  selection = { path, start, end, revision: bench.documents.get(path).revision };
  $('selection').textContent = $('editor').value.slice(start, end);
  render();
};
$('instruction').oninput = () => instructions.set(path, $('instruction').value);
$('mode').onclick = () => { reading = !reading; $('editor').hidden = reading; $('preview').hidden = !reading; $('mode').textContent = reading ? '编辑正文' : '阅读预览'; render(); };
$('save').onclick = () => run(async () => { await bench.save(path); selection = undefined; $('selection').textContent = '保存成功，请重新选择文字'; status('本集已保存到同一份本地文件'); });
$('refresh').onclick = () => run(async () => { const result = await bench.refresh(path); $('editor').value = bench.documents.get(path).text; status(result === 'changed' ? '文件变化已读回' : '文件没有变化'); });
$('undo').onclick = () => run(async () => { await bench.undo(path); $('editor').value = bench.documents.get(path).text; status('上次版本已恢复到本地文件'); });
$('send').onclick = () => run(async () => {
  if (!selection || selection.path !== path || selection.revision !== bench.documents.get(path).revision) throw new Error('选区已失效，请在正文重新选择');
  await bench.request(path, selection.start, selection.end, $('instruction').value);
  status('已投递到受控队列；尚未执行，也尚未修改文件');
});
function latest() { const r = [...bench.requests.values()].at(-1); if (!r) throw new Error('请先选择一段文字并发送改写要求'); return r; }
$('execute').onclick = () => run(async () => {
  const r = latest();
  if (!r.instruction.startsWith('改为：')) { r.status = 'failed'; throw new Error('受控适配器只支持「改为：新文字」，未调用模型，未修改文件'); }
  await bench.execute(r.id, r.instruction.slice(3));
  if (path === r.path) $('editor').value = bench.documents.get(path).text;
  selection = undefined; $('change').open = false;
  status('受控改稿已写入原文件并读回；可查看差异或恢复上次版本');
});
$('cancel').onclick = () => run(() => { bench.cancel(latest().id); status('受控请求已取消，文件未因取消而变化'); });
$('toggle').onclick = () => { if (!bench) return status('请先选择项目'); bench.visible ? bench.close() : bench.show(); render(); };
$('agent-open').onclick = () => { if (!bench) return status('请先选择项目'); const opened = bench.show('agent'); render(); status(opened ? '面板已打开；没有生成或发送任务' : '尊重本会话的主动收起，未重新打开面板'); };
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([bench.documents.get(path).text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = path.split('/').at(-1); link.click(); URL.revokeObjectURL(url);
};
window.addEventListener('beforeunload', event => {
  if (bench && [...bench.documents.values()].some(d => d.text !== d.base || d.busy)) { event.preventDefault(); event.returnValue = ''; }
});
