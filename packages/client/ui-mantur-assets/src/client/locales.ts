/** Localized copy for the production asset panel. */
export const en = { assets: 'Assets', source: 'Pipeline report', load: 'Load', refresh: 'Refresh', candidateDirectory: 'Candidate folder', scan: 'Scan candidates', candidates: 'Candidates', preview: 'Preview', prompt: 'Prompt', save: 'Save draft', request: 'Send proposal request', apply: 'Apply proposal', pending: 'Proposal pending', proposed: 'Proposal ready for review', unfinished: 'Write unfinished; recovery required', noMedia: 'No explicit media binding', actual: 'Actual request preserved', selected: 'Selected items', error: 'Asset operation failed' } as const
/** Simplified Chinese copy for the production asset panel. */
export const zh = { assets: '资产', source: '流水线报告', load: '读取', refresh: '刷新', candidateDirectory: '候选目录', scan: '扫描候选', candidates: '候选资产', preview: '预览', prompt: '提示词', save: '保存草稿', request: '发送提案请求', apply: '应用提案', pending: '提案处理中', proposed: '提案待审核', unfinished: '写入未完成，需要恢复', noMedia: '未绑定明确媒体', actual: '已保留实际请求', selected: '已选条目', error: '资产操作失败' } as const
/** Keys owned by the asset-panel locale namespace. */
export type AssetKey = keyof typeof en
