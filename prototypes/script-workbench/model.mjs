/** Isolated document state; storage and the existing conversation are injected. */
export async function version(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}

/** One workspace/session's drafts, requests and explicit panel preference. */
export class Workbench {
  constructor(storage, sessionId, send) {
    this.storage = storage;
    this.sessionId = sessionId;
    this.send = send;
    this.documents = new Map();
    this.requests = new Map();
    this.visible = true;
    this.dismissed = false;
  }
  /** Read once; switching episodes never destroys an existing draft. */
  async open(path) {
    if (!this.documents.has(path)) {
      const text = await this.storage.read(path);
      this.documents.set(path, { path, base: text, text, revision: 0, busy: false, history: [] });
    }
    return this.documents.get(path);
  }
  edit(path, text) {
    const doc = this.documents.get(path);
    if (doc.busy) throw new Error('文件正在写入，请稍后编辑');
    doc.text = text;
    doc.revision++;
  }
  /** All writes compare the exact baseline; only the storage adapter commits. */
  async save(path) {
    const doc = this.documents.get(path);
    if (doc.busy) throw new Error('文件正在写入');
    doc.busy = true;
    try {
      const previous = doc.base;
      const next = doc.text;
      await this.storage.write(path, previous, next);
      doc.history.push({ before: previous, after: next });
      doc.base = next;
      doc.revision++;
    } finally { doc.busy = false; }
  }
  async refresh(path) {
    const doc = this.documents.get(path);
    const disk = await this.storage.read(path);
    if (disk === doc.base) return 'unchanged';
    if (doc.text !== doc.base) throw new Error('文件已在外部修改；本地草稿已保留，请先导出草稿再重新读取');
    doc.history.push({ before: doc.base, after: disk });
    doc.base = doc.text = disk;
    doc.revision++;
    return 'changed';
  }
  /** Exact UTF-16 offsets plus full-file hash; no text search or relocation. */
  async request(path, start, end, instruction) {
    const doc = this.documents.get(path);
    if (doc.busy || doc.text !== doc.base) throw new Error('请先保存手动修改，再交给 Agent');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > doc.text.length || start >= end) throw new Error('请先选择需要改写的文字');
    if (!instruction.trim()) throw new Error('请填写改写要求');
    if ([...this.requests.values()].some(r => r.path === path && ['sending', 'queued', 'running', 'committing'].includes(r.status))) throw new Error('本集已有待处理请求，请先完成或取消');
    const revision = doc.revision;
    const base = doc.base;
    const disk = await this.storage.read(path);
    if (disk !== base || revision !== doc.revision) throw new Error('文件版本已变化，请重新读取并选择文字');
    const request = {
      id: crypto.randomUUID(), sessionId: this.sessionId, project: this.storage.project,
      episode: path, path, version: await version(base), start, end,
      selected: base.slice(start, end), before: base.slice(Math.max(0, start - 160), start),
      after: base.slice(end, end + 160), instruction, revision, base, status: 'sending',
    };
    if (revision !== doc.revision) throw new Error('草稿已变化，请重新选择文字');
    this.requests.set(request.id, request);
    try {
      await this.send(this.payload(request));
      request.status = 'queued';
    } catch (error) { request.status = 'failed'; throw error; }
    return request;
  }
  /** JSON is sent verbatim as an ordinary logged user message in production. */
  payload(r) {
    return JSON.stringify({ kind: 'script-selection-rewrite', requestId: r.id, sessionId: r.sessionId,
      project: r.project, episode: r.episode, file: r.path, version: r.version,
      offsetEncoding: 'UTF-16', start: r.start, end: r.end, selected: r.selected,
      before: r.before, after: r.after, instruction: r.instruction }, null, 2);
  }
  cancel(id) {
    const request = this.requests.get(id);
    if (!['queued', 'running'].includes(request.status)) throw new Error('该请求不能取消');
    request.status = 'cancelled';
  }
  /** Controlled adapter only: late results and concurrent drafts fail closed. */
  async execute(id, replacement) {
    const r = this.requests.get(id);
    if (r.status !== 'queued') throw new Error('请求未排队或已取消');
    const doc = this.documents.get(r.path);
    r.status = 'running';
    let ownsWrite = false;
    try {
      if (doc.busy || doc.revision !== r.revision || doc.text !== r.base) throw new Error('改稿冲突：你已继续手改，请保存后重新选择');
      const disk = await this.storage.read(r.path);
      if (r.status === 'cancelled') throw new Error('请求已取消');
      if (doc.revision !== r.revision || disk !== r.base || disk.slice(r.start, r.end) !== r.selected) throw new Error('改稿冲突：文件或草稿版本变化，未写入任何内容');
      doc.busy = true;
      ownsWrite = true;
      r.status = 'committing';
      const next = disk.slice(0, r.start) + replacement + disk.slice(r.end);
      await this.storage.write(r.path, disk, next);
      r.status = 'written';
      r.change = { before: r.selected, after: replacement };
      doc.history.push({ before: disk, after: next });
      doc.base = doc.text = next;
      doc.revision++;
      const readBack = await this.storage.read(r.path);
      if (readBack !== next) throw new Error('写入后文件又发生变化，请重新读取；保留当前草稿');
      r.status = 'completed';
    } catch (error) {
      if (r.status !== 'cancelled') r.status = r.status === 'written' ? 'readback-conflict' : 'failed';
      r.error = error.message;
      throw error;
    } finally { if (ownsWrite) doc.busy = false; }
  }
  /** Restore only if neither the local draft nor disk has diverged. */
  async undo(path) {
    const doc = this.documents.get(path);
    const change = doc.history.at(-1);
    if (!change || doc.busy || doc.text !== doc.base || doc.base !== change.after) throw new Error('无法恢复：存在未保存草稿或没有可恢复版本');
    doc.busy = true;
    try {
      await this.storage.write(path, change.after, change.before);
      doc.base = doc.text = change.before;
      doc.revision++;
      doc.history.pop();
    } finally { doc.busy = false; }
  }
  close() { this.visible = false; this.dismissed = true; }
  show(origin = 'user') {
    if (origin === 'agent' && this.dismissed) return false;
    this.visible = true;
    return true;
  }
}
