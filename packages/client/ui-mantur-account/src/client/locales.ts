/** Account dictionaries shared by native and standalone browser surfaces. */
import { nativeEn, nativeZh } from './native-locales.ts'

/** Simplified Chinese copy and key source for Mantur account surfaces. */
export const zh = {
  ...nativeZh,
  nav: '漫途账号',
  onboardingTitle: '登录漫途账号',
  onboardingDescription: '登录后可在后续版本中直接使用与你账号绑定的漫途算子。',
  login: '登录漫途账号',
  skip: '暂时跳过',
  preparing: '正在准备登录…',
  openBrowser: '在浏览器中继续',
  codeLabel: '设备码',
  waiting: '等待浏览器完成授权…',
  cancel: '取消登录',
  retry: '重试',
  failed: '登录未完成，请重试。',
  signedIn: '已登录',
  signedOut: '尚未登录漫途账号',
  signOut: '退出登录',
  signingOut: '正在退出…',
} satisfies Record<string, string>

/** Mantur account dictionary key union. */
export type ManturAccountKey = keyof typeof zh

/** English copy checked against the Chinese key set. */
export const en = {
  ...nativeEn,
  nav: 'Mantur account',
  onboardingTitle: 'Sign in to Mantur',
  onboardingDescription: 'Sign in now to use Mantur operators linked to your account in a future release.',
  login: 'Sign in to Mantur',
  skip: 'Not now',
  preparing: 'Preparing sign-in…',
  openBrowser: 'Continue in browser',
  codeLabel: 'Device code',
  waiting: 'Waiting for browser authorization…',
  cancel: 'Cancel sign-in',
  retry: 'Try again',
  failed: 'Sign-in did not complete. Try again.',
  signedIn: 'Signed in',
  signedOut: 'Not signed in to Mantur',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
} satisfies Record<ManturAccountKey, string>
