/** English workbench labels, including shared Markdown controls. */
export const en = {
  webClose: 'Close page',
  webLoadFailed: 'The page could not load. Check the address and local service, then try again.',
  web: 'Web', webAddress: 'Local workbench URL', webOpen: 'Open', webUnsupported: 'The embedded browser requires the Mantur desktop app.', webInvalid: 'Enter an HTTP URL on 127.0.0.1 with an explicit port.', webEmpty: 'Open the local workbench URL returned by the skill.',
  title: 'Script workbench', script: 'Script', editing: 'Editing', expand: 'Expand workbench', collapse: 'Collapse workbench',
  editingUnavailable: 'The editing runtime is not enabled. Configure the matching Mantur Cut resources and restart the app. Script and Web remain available.',
  assetsUnavailable: 'The asset plugin is unavailable.',
  selectSession: 'Select a project conversation to edit its scripts.', folder: 'Project folder', browse: 'Open folder', root: 'Project root',
  files: 'Scripts', empty: 'No script files in this folder.', reading: 'Read', source: 'Edit',
  save: 'Save', saved: 'Saved', dirty: 'Unsaved changes', refresh: 'Check file', loading: 'Loading…',
  selectFile: 'Open an episode from the file list.', sourceHelp: 'Switch to Edit to select the exact passage to rewrite.',
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
  webClose: '关闭网页',
  webLoadFailed: '网页未能加载，请检查地址和本地服务后重试。',
  web: '网页', webAddress: '本地工作台网址', webOpen: '打开', webUnsupported: '当前环境不支持内置网页，请使用漫途桌面应用。', webInvalid: '请输入带明确端口的 http://127.0.0.1 本地网址。', webEmpty: '打开技能返回的本地工作台网址。',
  title: '剧本工作台', script: '剧本', editing: '剪辑', expand: '展开工作台', collapse: '收起工作台',
  editingUnavailable: '剪辑运行环境未启用。请配置与当前版本匹配的 Mantur Cut 资源并重启应用；剧本和网页仍可使用。',
  assetsUnavailable: '资产插件当前不可用。',
  selectSession: '请先选择项目对话，再编辑项目剧本。', folder: '项目内文件夹', browse: '打开文件夹', root: '项目根目录',
  files: '剧本列表', empty: '项目中暂无剧本。', reading: '阅读', source: '编辑',
  save: '保存', saved: '已保存', dirty: '有未保存修改', refresh: '检查文件更新', loading: '正在读取…',
  selectFile: '选择剧本开始阅读，或在对话中创建剧本。', sourceHelp: '切到“编辑”后选中文字，即可要求改写准确选段。',
  instruction: '这段要怎么改？', send: '发送选段', queued: '已发送到当前对话。查看 Agent 结果后，检查文件更新。',
  saveFirst: '请先保存当前草稿，再发送选段。', selection: '已选文字',
  conflict: '文件已变化。你的草稿已保留，请先对比磁盘版本再继续。',
  useDisk: '放弃草稿并使用磁盘版本', disk: '磁盘当前版本', draft: '你的草稿',
  undo: '恢复上一版', diff: '查看修改前后', previous: '修改前', current: '修改后',
  copy: '复制', copied: '已复制', footnotes: '脚注', failed: '操作失败',
}
