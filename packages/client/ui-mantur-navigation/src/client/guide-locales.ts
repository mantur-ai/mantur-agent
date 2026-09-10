/** Fixed guide copy; no model request is needed to present it. */

/** Simplified Chinese guide dictionary. */
export const zh = {
  'modes': '创作方向',
  'mode.script': '剧本创作',
  'mode.production': '漫剧制作',
  'mode.assets': '素材生产',
  'intro.script': '把小说改成剧本、改编已有剧本，或拆解参考作品。选好技能，再告诉我你的想法。',
  'intro.production': '从剧本制作漫剧，复刻参考短片，或剪辑已有素材。选好技能，再补充你的需求。',
  'intro.assets': '上传已有漫剧或短剧，提取高光片段，制作投放素材。',
  'assistant': '馒头仔',
  'welcome.title': '你好呀，我是馒头仔，漫途的创作小助手！',
  'welcome.body': '从写剧本、做画面到剪成片，我都会陪着你。选一个创作方向，或者直接告诉我你的想法吧。',
  'selected': '已选好「{name}」。补充你的需求或上传素材，再点击发送开始。',
  'installFailed': '这个技能暂时没有安装成功，可以重试。',
  'insertFailed': '当前输入框暂时无法添加技能，请稍后重试。',
  'preferencesLoading': '正在读取创作偏好…',
  'preferencesUnavailable': '创作偏好暂时无法读取，请重新连接后重试。',
  'saveFailed': '偏好没有保存成功，请重试。',
  'recommended': '推荐技能',
  'previousSkills': '向左查看技能',
  'nextSkills': '向右查看技能',
  'alias.short-drama': '剧本改编',
  'alias.drama-asset-seedance-pipeline': '漫剧生产',
  'alias.mantur-copyhit': '短片复刻',
  'alias.mantur-smartclip': '高光智剪',
  'aliasMissing': '部分推荐技能缺少展示短名，请维护推荐配置。',
  'empty': '当前目录还没有这个方向的推荐技能，可以查看更多技能。',
  'more': '更多技能',
  'notInstalled': '尚未安装此技能。安装后可添加到当前对话。',
  'installAndUse': '安装后使用',
  'use': '添加到当前对话',
  'close': '关闭引导',
} satisfies Record<string, string>

/** Guide locale keys shared by both languages. */
export type GuideKey = keyof typeof zh

/** English copy; the mascot keeps its formal Chinese name. */
export const en = {
  'modes': 'Creation direction',
  'mode.script': 'Script writing',
  'mode.production': 'Drama production',
  'mode.assets': 'Asset production',
  'intro.script': 'Adapt a novel or a script, or analyze a reference. Choose a skill, then share your idea.',
  'intro.production': 'Produce a drama from a script, recreate a reference short, or edit existing footage. Choose a skill, then add your requirements.',
  'intro.assets': 'Upload an existing drama to extract highlights and make promotional clips.',
  'assistant': '馒头仔',
  'welcome.title': 'Hello, I’m 馒头仔, your Mantur creative assistant!',
  'welcome.body': 'From writing scripts and making pictures to editing a finished video, I’m here to help. Choose a direction or tell me your idea.',
  'selected': '“{name}” is selected. Add your requirements or upload assets, then click Send to begin.',
  'installFailed': 'This skill could not be installed. You can try again.',
  'insertFailed': 'The composer cannot add a skill right now. Please try again shortly.',
  'preferencesLoading': 'Loading creation preferences…',
  'preferencesUnavailable': 'Creation preferences are unavailable. Reconnect and try again.',
  'saveFailed': 'Your preference could not be saved. Please try again.',
  'recommended': 'Recommended skills',
  'previousSkills': 'View previous skills',
  'nextSkills': 'View more skills',
  'alias.short-drama': 'Adapt scripts',
  'alias.drama-asset-seedance-pipeline': 'Make drama',
  'alias.mantur-copyhit': 'Recreate shorts',
  'alias.mantur-smartclip': 'Cut highlights',
  'aliasMissing': 'Some recommended skills need a display label. Update the recommendation configuration.',
  'empty': 'No recommended skills for this direction are in the current catalog. Browse more skills.',
  'more': 'More skills',
  'notInstalled': 'This skill is not installed. Install it to add it to this conversation.',
  'installAndUse': 'Install and use',
  'use': 'Add to this conversation',
  'close': 'Close guide',
} satisfies Record<GuideKey, string>

/** Curated shortcut labels; IDs and full catalog titles remain unchanged. */
export const GUIDE_SKILL_LABELS: ReadonlyMap<string, GuideKey> = new Map([
  ['short-drama', 'alias.short-drama'],
  ['drama-asset-seedance-pipeline', 'alias.drama-asset-seedance-pipeline'],
  ['mantur-copyhit', 'alias.mantur-copyhit'],
  ['mantur-smartclip', 'alias.mantur-smartclip'],
])
