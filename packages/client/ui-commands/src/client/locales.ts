/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.compact.name': '压缩上下文',
  'command.compact.description': '精简较早的对话内容',
  'command.feedback.name': '反馈问题',
  'command.feedback.description': '记录本次会话的反馈',
  'command.goal.name': '任务目标',
  'command.goal.description': '设置或查看长期任务目标',
  'command.permission.name': '访问权限',
  'command.permission.description': '切换文件访问和操作确认方式',
  'command.plan.name': '计划模式',
  'command.plan.description': '进入或退出计划模式',
  'command.model.name': '选择模型',
  'command.model.description': '选择本会话使用的模型',

  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.imagesUnsupported': '/{command} 不接受图片附件，请先移除图片',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.compact.name': 'Compact history',
  'command.compact.description': 'Compact older conversation history',
  'command.feedback.name': 'Feedback',
  'command.feedback.description': 'Record feedback about this session',
  'command.goal.name': 'Task goal',
  'command.goal.description': 'Set or view the goal for a long-running task',
  'command.permission.name': 'Permissions',
  'command.permission.description': 'Switch file access and approval settings',
  'command.plan.name': 'Plan mode',
  'command.plan.description': 'Enter or leave plan mode',
  'command.model.name': 'Select model',
  'command.model.description': 'Select the model used by this session',

  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.imagesUnsupported': '/{command} does not accept image attachments; remove them first',
} satisfies Record<CommandKey, string>
