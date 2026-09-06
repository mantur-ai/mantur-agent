/** Automatic-project controls and first-send failures. */
export const zh = {
  automatic: '自动创建项目',
  newProject: '新项目',
  location: '新项目保存位置',
  loading: '正在读取保存位置…',
  unconfigured: '请先选择保存位置',
  change: '更改保存位置',
  changing: '正在选择…',
  retry: '重试',
  futureOnly: '更改位置仅用于新项目，已开始创建的项目不会迁移。',
  creating: '正在创建项目，草稿已保留…',
  settingsFailed: '无法读取保存位置，请重试。',
  selectionFailed: '无法确认保存位置，请重新读取后重试。',
  rootRequired: '请先选择新项目的保存位置，再发送。',
  directoryConflict: '项目目录已存在，未覆盖其中的文件。请选择已有项目继续。',
  directoryInvalid: '本次项目目录已移除或被替换，请选择已有项目继续。',
  createFailed: '项目创建未完成，草稿已保留。可以重试或选择已有项目。',
  sessionFailed: '项目已准备，但会话连接未完成。草稿已保留，重试会使用同一项目。',
  storageFailed: '无法保存本次创建记录，尚未创建项目。请检查客户端存储后重试。',
} satisfies Record<string, string>

/** Automatic-project locale keys. */
export type ProjectKey = keyof typeof zh

/** English automatic-project copy. */
export const en = {
  automatic: 'Create a project automatically',
  newProject: 'New project',
  location: 'Location for new projects',
  loading: 'Loading project location…',
  unconfigured: 'Choose a project location first',
  change: 'Change location',
  changing: 'Choosing…',
  retry: 'Retry',
  futureOnly: 'Location changes apply to new projects. Projects already being created are not moved.',
  creating: 'Creating the project. Your draft is retained…',
  settingsFailed: 'Could not read the project location. Please retry.',
  selectionFailed: 'Could not confirm the project location. Reload it and retry.',
  rootRequired: 'Choose a location for new projects before sending.',
  directoryConflict: 'The project directory already exists. No files were overwritten. Choose an existing project to continue.',
  directoryInvalid: 'This project directory was removed or replaced. Choose an existing project to continue.',
  createFailed: 'Project creation did not finish. Your draft is retained. Retry or choose an existing project.',
  sessionFailed: 'The project is prepared, but the conversation could not connect. Your draft is retained. Retry uses the same project.',
  storageFailed: 'Could not save this creation request. No project was created. Check client storage and retry.',
} satisfies Record<ProjectKey, string>
