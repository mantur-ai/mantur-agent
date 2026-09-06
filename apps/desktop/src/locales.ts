/** Native desktop copy selected from the operating-system locale. */

const zh = {
  updateShutdownUnavailable: '草稿已保存，但尚无法确认本地任务最终记录已安全保存。本次未执行安装，也未停止任务。',
  startupFailedTitle: '漫途Agent 启动失败',
  startupFailedMessage: '无法启动本地 Agent 服务。',
  resetCacheButton: '重置缓存并重试',
  showLogButton: '查看日志',
  quitButton: '退出',
  laterButton: '稍后',
  updateReadyTitle: '下载完成，重启安装',
  updateReadyMessage: (version: string) => `漫途Agent ${version} 下载完成，重启安装。重启会中断当前客户端正在执行的任务；远端任务不会因此取消，部分任务需要重新发起。是否继续？`,
  restartButton: '重启并更新',
  aboutMenu: '关于漫途Agent',
  editMenu: '编辑',
  viewMenu: '显示',
  windowMenu: '窗口',
  helpMenu: '帮助',
  currentVersion: (version: string) => `当前版本 ${version}`,
  checkForUpdates: '检查更新…',
  checkingForUpdates: '正在检查更新…',
  updateAvailableStatus: (version: string) => `发现新版本 ${version}`,
  downloadUpdate: (version: string) => `下载 ${version}…`,
  downloadProgress: (version: string, percent: number | null) => `正在下载 ${version}${percent === null ? '' : `（${percent}%）`}`,
  updateReadyStatus: (version: string) => `${version} 已可安装`,
  installUpdate: (version: string) => `重启并更新 ${version}`,
  upToDateStatus: '已是最新版本',
  updateErrorStatus: '检查更新失败',
  upToDateTitle: '已是最新版本',
  upToDateMessage: (version: string) => `漫途Agent ${version} 已是最新版本。`,
  updateErrorTitle: '更新失败',
  updateErrorMessage: (detail: string) => `无法完成更新。\n\n${detail}`,
  okButton: '好',
} as const

type DesktopCopy = {
  [Key in keyof typeof zh]: typeof zh[Key] extends (...args: infer Args) => string
    ? (...args: Args) => string
    : string
}

const en = {
  updateShutdownUnavailable: 'Drafts were saved, but a verified final task checkpoint is unavailable. Installation was not started and tasks were not stopped.',
  startupFailedTitle: 'Mantur Agent failed to start',
  startupFailedMessage: 'The local agent service could not start.',
  resetCacheButton: 'Reset cache and retry',
  showLogButton: 'Show log',
  quitButton: 'Quit',
  laterButton: 'Later',
  updateReadyTitle: 'Update downloaded',
  updateReadyMessage: (version: string) => `Mantur Agent ${version} has finished downloading. Restarting will interrupt tasks running in this client. Remote tasks are not cancelled, and some tasks may need to be started again. Restart and update?`,
  restartButton: 'Restart and update',
  aboutMenu: 'About Mantur Agent',
  editMenu: 'Edit',
  viewMenu: 'View',
  windowMenu: 'Window',
  helpMenu: 'Help',
  currentVersion: (version: string) => `Current version ${version}`,
  checkForUpdates: 'Check for Updates…',
  checkingForUpdates: 'Checking for updates…',
  updateAvailableStatus: (version: string) => `Version ${version} is available`,
  downloadUpdate: (version: string) => `Download ${version}…`,
  downloadProgress: (version: string, percent: number | null) => `Downloading ${version}${percent === null ? '' : ` (${percent}%)`}`,
  updateReadyStatus: (version: string) => `Version ${version} is ready to install`,
  installUpdate: (version: string) => `Restart and update ${version}`,
  upToDateStatus: 'Mantur Agent is up to date',
  updateErrorStatus: 'Update check failed',
  upToDateTitle: 'Mantur Agent is up to date',
  upToDateMessage: (version: string) => `Mantur Agent ${version} is the latest version.`,
  updateErrorTitle: 'Update failed',
  updateErrorMessage: (detail: string) => `Mantur Agent could not complete the update.\n\n${detail}`,
  okButton: 'OK',
} satisfies DesktopCopy

/** Resolve native-window copy for one operating-system locale. */
export function desktopCopy(locale: string): DesktopCopy {
  return locale.toLowerCase().startsWith('zh') ? zh : en
}
