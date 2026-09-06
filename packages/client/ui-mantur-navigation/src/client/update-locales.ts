/** Locale-owned native updater controls and progress copy. */
export const zh = {
  'unit.bytes': 'B',
  'unit.kibibytes': 'KiB',
  'unit.mebibytes': 'MiB',
  available: '发现新版本 {version}',
  download: '下载更新',
  downloading: '正在下载 {version}',
  ready: '下载完成，重启安装',
  install: '重启并更新',
  checking: '正在检查更新',
  failed: '更新未完成',
  retry: '重新检查',
  progress: '更新下载进度',
  transferred: '已下载 {bytes}',
  known: '{received} / {total}',
  preparing: '正在确认并保存',
  error: '操作未完成：{detail}',
}

/** Keys shared by both update dictionaries. */
export type UpdateKey = keyof typeof zh

/** English update controls. */
export const en: Record<UpdateKey, string> = {
  'unit.bytes': 'B',
  'unit.kibibytes': 'KiB',
  'unit.mebibytes': 'MiB',
  available: 'Version {version} is available',
  download: 'Download update',
  downloading: 'Downloading {version}',
  ready: 'Downloaded. Restart to install.',
  install: 'Restart and update',
  checking: 'Checking for updates',
  failed: 'Update did not complete',
  retry: 'Check again',
  progress: 'Update download progress',
  transferred: '{bytes} downloaded',
  known: '{received} / {total}',
  preparing: 'Confirming and saving',
  error: 'Action did not complete: {detail}',
}
