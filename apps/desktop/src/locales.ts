/** Native desktop copy selected from the operating-system locale. */

const zh = {
  accountUpgradeTitle: '重新登录漫途账号',
  accountUpgradeMessage: '此版本使用浏览器登录，需要重新授权。',
  accountUpgradeDetail: '继续会在本机私有账号目录旁保留旧账号数据备份，并清空本机登录状态。项目、草稿和模型 Key 不受影响。旧凭据不会被复用，此操作不会撤销网站上的旧设备授权。随后可在浏览器重新登录，或暂时跳过。',
  accountUpgradeButton: '备份并重新登录',
  accountUpgradeFailed: '无法完成账号存储更新，尚未启动登录。',
  accountUpgradeFailedDetail: '原始账号数据仍保留在原位置或本机私有备份中；项目、草稿和模型 Key 未修改。请退出并联系支持，不要删除账号目录。',
  directoryPickerTitle: '选择目录',
  directoryPickerBusy: '目录选择窗口已打开，请先完成或取消当前选择。',
  directoryPickerUnavailable: '正在准备更新或退出，暂时无法选择目录。',
  directoryPickerInvalidated: '窗口已关闭或页面已更换，本次目录选择已失效。',
  directoryPickerInvalidResult: '系统目录选择窗口未返回一个有效的绝对目录路径。',
  updateDirectoryPickerPending: '请先完成或取消目录选择，再重启并更新。',
  updateShutdownUnavailable: '草稿已保存，但尚无法确认本地任务最终记录已安全保存。本次未执行安装，也未停止任务。',
  startupFailedTitle: '漫途Agent 启动失败',
  startupFailedMessage: '无法启动本地 Agent 服务。',
  resetCacheButton: '重置缓存并重试',
  showLogButton: '查看日志',
  quitButton: '退出',
  laterButton: '稍后',
  updateReadyTitle: '下载完成，重启安装',
  updateSavingTitle: '正在准备更新',
  updateSavingMessage: '正在等待消息提交完成并保存草稿。你可以取消等待，继续使用当前版本。',
  cancelUpdateButton: '取消更新',
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
  upToDateStatus: '暂无可用更新',
  updateErrorStatus: '检查更新失败',
  upToDateTitle: '暂无可用更新',
  upToDateMessage: (version: string) => `当前版本为 ${version}，暂未发现更高版本的更新。`,
  updateFeedUnavailable: '更新服务暂未发布完整的安装包，请稍后重试。当前版本可以继续使用。',
  updateTransferFailed: '暂时无法检查或下载更新，请稍后重试。详细信息已写入应用日志。',
  updateVerificationFailed: '更新文件未通过校验，请重新下载。当前版本未被替换。',
  updateErrorTitle: '更新暂不可用',
  updateErrorMessage: (detail: string) => `无法完成更新。\n\n${detail}`,
  okButton: '好',
} as const

type DesktopCopy = {
  [Key in keyof typeof zh]: typeof zh[Key] extends (...args: infer Args) => string
    ? (...args: Args) => string
    : string
}

const en = {
  accountUpgradeTitle: 'Sign in to Mantur again',
  accountUpgradeMessage: 'This version uses browser sign-in and needs new authorization.',
  accountUpgradeDetail: 'Continuing keeps a private backup beside the local account directory and clears local sign-in. Projects, drafts and model keys are unchanged. Old credentials are not reused, and existing website device grants are not revoked. You can then sign in through your browser or skip sign-in.',
  accountUpgradeButton: 'Back up and sign in again',
  accountUpgradeFailed: 'Account storage could not be updated. Sign-in has not started.',
  accountUpgradeFailedDetail: 'Original account data remains in its original location or a private local backup. Projects, drafts and model keys were not changed. Quit and contact support; do not delete the account directory.',
  directoryPickerTitle: 'Choose a directory',
  directoryPickerBusy: 'A directory chooser is already open. Complete or cancel that selection first.',
  directoryPickerUnavailable: 'Directories cannot be selected while preparing an update or quitting.',
  directoryPickerInvalidated: 'The window closed or the page changed. This directory selection is no longer valid.',
  directoryPickerInvalidResult: 'The system directory chooser did not return one valid absolute directory path.',
  updateDirectoryPickerPending: 'Complete or cancel the directory selection before restarting to update.',
  updateShutdownUnavailable: 'Drafts were saved, but a verified final task checkpoint is unavailable. Installation was not started and tasks were not stopped.',
  startupFailedTitle: 'Mantur Agent failed to start',
  startupFailedMessage: 'The local agent service could not start.',
  resetCacheButton: 'Reset cache and retry',
  showLogButton: 'Show log',
  quitButton: 'Quit',
  laterButton: 'Later',
  updateReadyTitle: 'Update downloaded',
  updateSavingTitle: 'Preparing the update',
  updateSavingMessage: 'Waiting for message submission and saving drafts. Cancel to keep using the current version.',
  cancelUpdateButton: 'Cancel update',
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
  upToDateStatus: 'No updates available',
  updateErrorStatus: 'Update check failed',
  upToDateTitle: 'No updates available',
  upToDateMessage: (version: string) => `Current version: ${version}. No newer update is available.`,
  updateFeedUnavailable: 'The update service has not published a complete installer. Please try again later. You can keep using the current version.',
  updateTransferFailed: 'Unable to check or download updates right now. Please try again later. Details are recorded in the application log.',
  updateVerificationFailed: 'The update did not pass verification. Please download it again. The installed version has not been replaced.',
  updateErrorTitle: 'Update unavailable',
  updateErrorMessage: (detail: string) => `Mantur Agent could not complete the update.\n\n${detail}`,
  okButton: 'OK',
} satisfies DesktopCopy

/** Resolve native-window copy for one operating-system locale. */
export function desktopCopy(locale: string): DesktopCopy {
  return locale.toLowerCase().startsWith('zh') ? zh : en
}

/** Return localized updater feedback without exposing HTTP headers, paths, or stack traces. */
export function describeUpdateError(error: unknown, locale: string): string {
  const copy = desktopCopy(locale)
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' || code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS') return copy.updateFeedUnavailable
  if (code === 'ERR_UPDATER_INVALID_SIGNATURE' || code === 'ERR_UPDATER_CHECKSUM_MISMATCH') return copy.updateVerificationFailed
  return copy.updateTransferFailed
}
