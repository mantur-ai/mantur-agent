/** Workbench copy owned by the Mantur editing plugin. */
export const en = {
  title: 'Editing workbench', close: 'Close workbench', reload: 'Reload editor',
  invalidAddress: 'The local editor address is invalid.',
  loading: 'Loading editor settings…', unavailable: 'Editor settings are unavailable.',
  help: 'Use the timeline here and continue editing with Mantur on the left. Review edit proposals and confirm exports inside the editor.',
}
/** English dictionary keys shared by both locales. */
export type EditingKey = keyof typeof en
/** Simplified Chinese workbench copy. */
export const zh: Record<EditingKey, string> = {
  title: '剪辑工作台', close: '收起工作台', reload: '重新加载编辑器',
  invalidAddress: '本地编辑器地址无效。',
  loading: '正在读取编辑器设置…', unavailable: '无法读取编辑器设置。',
  help: '在这里操作时间线，在左侧继续与漫途对话。请在编辑器内审阅修改并确认导出。',
}
