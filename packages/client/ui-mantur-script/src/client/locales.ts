/** English workbench labels, including shared Markdown controls. */
export const en = {
  title: 'Script workbench', script: 'Script', editing: 'Editing', expand: 'Expand workbench', collapse: 'Collapse workbench',
  editingUnavailable: 'The editing plugin is unavailable. Select Script to continue writing.',
  selectSession: 'Select a project conversation to edit its scripts.', folder: 'Project folder', browse: 'Open folder', root: 'Project root',
  files: 'Episodes and files', empty: 'No script files in this folder.', reading: 'Read', source: 'Edit source',
  save: 'Save', saved: 'Saved', dirty: 'Unsaved changes', refresh: 'Check file', loading: 'Loading…',
  selectFile: 'Open an episode from the file list.', sourceHelp: 'Switch to Edit source to select the exact passage to rewrite.',
  instruction: 'How should this passage change?', send: 'Send selection', queued: 'Sent to this conversation. Check the Agent result, then check the file.',
  saveFirst: 'Save this draft before sending a selection.', selection: 'Selected passage',
  conflict: 'The file changed. Your draft is preserved. Compare the disk version before continuing.',
  useDisk: 'Discard draft and use disk version', disk: 'Current disk version', draft: 'Your draft',
  undo: 'Restore previous version', diff: 'Previous and current text', previous: 'Previous', current: 'Current',
  copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes', failed: 'Operation failed',
}
/** Dictionary keys shared by both languages. */
export type ScriptKey = keyof typeof en
/** Simplified Chinese workbench labels. */
export const zh: Record<ScriptKey, string> = {
  title: '剧本工作台', script: '剧本', editing: '剪辑', expand: '展开工作台', collapse: '收起工作台',
  editingUnavailable: '剪辑插件当前不可用，可选择“剧本”继续写作。',
  selectSession: '请先选择项目对话，再编辑项目剧本。', folder: '项目内文件夹', browse: '打开文件夹', root: '项目根目录',
  files: '分集与文件', empty: '此文件夹内没有剧本文件。', reading: '阅读', source: '编辑源码',
  save: '保存', saved: '已保存', dirty: '有未保存修改', refresh: '检查文件更新', loading: '正在读取…',
  selectFile: '从左侧打开一集剧本。', sourceHelp: '切到“编辑源码”后选中文字，即可要求改写准确选段。',
  instruction: '这段要怎么改？', send: '发送选段', queued: '已发送到当前对话。查看 Agent 结果后，检查文件更新。',
  saveFirst: '请先保存当前草稿，再发送选段。', selection: '已选文字',
  conflict: '文件已变化。你的草稿已保留，请先对比磁盘版本再继续。',
  useDisk: '放弃草稿并使用磁盘版本', disk: '磁盘当前版本', draft: '你的草稿',
  undo: '恢复上一版', diff: '查看修改前后', previous: '修改前', current: '修改后',
  copy: '复制', copied: '已复制', footnotes: '脚注', failed: '操作失败',
}
