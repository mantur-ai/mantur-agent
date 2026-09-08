/** Workbench copy owned by the Mantur editing plugin. */
export const en = {
  expand: 'Expand editing workbench', collapse: 'Collapse editing workbench',
  title: 'Editing workbench', reload: 'Refresh',
  invalidAddress: 'The local editor address is invalid.',
  loading: 'Starting this session’s editor…', unavailable: 'Editor settings are unavailable.',
  failed: 'Could not open editing', selectSession: 'Select a project and conversation to open editing.',
  help: 'Use the timeline here and continue editing with Mantur on the left. Review edit proposals and confirm exports inside the editor.',
}
/** English dictionary keys shared by both locales. */
export type EditingKey = keyof typeof en
/** Simplified Chinese workbench copy. */
export const zh: Record<EditingKey, string> = {
  expand: '展开剪辑工作台', collapse: '收起剪辑工作台',
  title: '剪辑工作台', reload: '刷新',
  invalidAddress: '本地编辑器地址无效。',
  loading: '正在启动当前会话的剪辑工作台…', unavailable: '无法读取编辑器设置。',
  failed: '剪辑工作台打开失败', selectSession: '请先选择项目和对话，再打开剪辑。',
  help: '在这里操作时间线，在左侧继续与漫途对话。请在编辑器内审阅修改并确认导出。',
}
