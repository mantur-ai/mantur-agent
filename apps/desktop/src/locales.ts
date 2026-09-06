/** Native desktop copy selected from the operating-system locale. */

const zh = {
  updateShutdownUnavailable: '草稿已保存，但尚无法确认本地任务最终记录已安全保存。本次未执行安装，也未停止任务。',
  startupFailedTitle: '漫途Agent 启动失败',
  startupFailedMessage: '无法启动本地 Agent 服务。',
  resetCacheButton: '重置缓存并重试',
  showLogButton: '查看日志',
  quitButton: '退出',
  updateAvailableTitle: '发现新版本',
  updateAvailableMessage: (version: string) => `漫途Agent ${version} 已发布，是否下载？`,
  downloadButton: '下载',
  laterButton: '稍后',
  updateReadyTitle: '更新已下载',
  updateReadyMessage: (version: string) => `漫途Agent ${version} 已准备好，是否立即重启安装？`,
  restartButton: '重启安装',
  aboutMenu: '关于漫途Agent',
  editMenu: '编辑',
  viewMenu: '显示',
  windowMenu: '窗口',
  helpMenu: '帮助',
  currentVersion: (version: string) => `当前版本 ${version}`,
  checkForUpdates: '检查更新…',
  checkingForUpdates: '正在检查更新…',
  updateAvailableStatus: (version: string) => `发现新版本 ${version}`,
  downloadProgress: (version: string, percent: number) => `正在下载 ${version}（${percent}%）`,
  updateReadyStatus: (version: string) => `${version} 已可安装`,
  installUpdate: (version: string) => `重启并安装 ${version}`,
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
  updateAvailableTitle: 'Update available',
  updateAvailableMessage: (version: string) => `Mantur Agent ${version} is available. Download it now?`,
  downloadButton: 'Download',
  laterButton: 'Later',
  updateReadyTitle: 'Update downloaded',
  updateReadyMessage: (version: string) => `Mantur Agent ${version} is ready. Restart and install it now?`,
  restartButton: 'Restart and install',
  aboutMenu: 'About Mantur Agent',
  editMenu: 'Edit',
  viewMenu: 'View',
  windowMenu: 'Window',
  helpMenu: 'Help',
  currentVersion: (version: string) => `Current version ${version}`,
  checkForUpdates: 'Check for Updates…',
  checkingForUpdates: 'Checking for updates…',
  updateAvailableStatus: (version: string) => `Version ${version} is available`,
  downloadProgress: (version: string, percent: number) => `Downloading ${version} (${percent}%)`,
  updateReadyStatus: (version: string) => `Version ${version} is ready to install`,
  installUpdate: (version: string) => `Restart and install ${version}`,
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
