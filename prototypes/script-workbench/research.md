# 剧本工作台：选型与接入核对

核对日期：2026-09-09。结论是先保持「一集一个文本文件」，生产版优先复用仓库已有 Lexical 依赖及基础编辑能力；不复制聊天输入框整个组件，不引入完整剧本应用。本次隔离原型使用原生 textarea，零新增第三方浏览器依赖，验证选段和文件生命周期；尚未证明 Lexical 完成剧本集成。

| 候选 | 复用与文档定位 | 文件与导出 | 许可证、维护与体积 |
| --- | --- | --- | --- |
| Lexical | 仓库 ui-conversation 已用 0.49.0。核心可独立嵌入；聊天 Composer 还绑定引用节点、附件和提交状态，不能跨插件直接导入。选区 anchor/focus 需要映射到原文件偏移；节点 key 不能直接当跨文件版本的稳定定位。 | 官方提供 JSON、Markdown、HTML 序列化能力；本项目保留文本文件为事实来源，避免无意规范化原文。PDF/FDX 不属于核心能力。 | MIT，可商业使用，分发需保留版权和许可文本。官方 releases 可见 0.50.0（9 月 2 日）。本机 0.49.0 的 Lexical.prod.mjs 为 175,413 字节，gzip 55,085；plain-text.prod.mjs 为 3,771 / gzip 1,441。是两个文件的实测，非完整依赖闭包或最终包增量。 |
| Tiptap / ProseMirror | 无头、可嵌入，扩展和文档事务适合复杂富文本。引入另一套文档模型，当前需求不足以抵消成本。事务位置映射仍不能代替外部文件版本校验。 | 以结构化编辑为主，格式转换要逐项确认扩展；不能默认购买版转换、版本和 AI 能力均在开源核心内。 | 开源核心 MIT，保留版权及许可；Pro 扩展官方明确需要有效订阅。官方仓库与 releases 仍有维护活动。未安装、未测完整体积，不声称比 Lexical 小。 |
| Beat | 完整 macOS/iOS 剧本应用，不是 React/Web 可直接嵌入组件；适合参考剧本阅读、场次和修订交互，不适合作为此 MVP 的依赖。 | Fountain 原文、场景结构、修订及 Final Draft 导入/导出。 | 官方说明 GPL 且持续开发。LICENSE 原文抓取失败，具体 GPL 版本与第三方组件义务未核清，因此本次不复制或分发其代码。没有量测安装体积；原生应用体积不能拿来与 JS 核心文件比较。 |

官方依据：[Lexical 仓库](https://github.com/facebook/lexical)、[选区文档](https://lexical.dev/docs/concepts/selection)、[MIT 原文](https://raw.githubusercontent.com/facebook/lexical/main/LICENSE)、[发布记录](https://github.com/facebook/lexical/releases)；[Tiptap 仓库及 Pro 说明](https://github.com/ueberdosis/tiptap)、[MIT 原文](https://raw.githubusercontent.com/ueberdosis/tiptap/main/LICENSE.md)、[发布记录](https://github.com/ueberdosis/tiptap/releases)；[Beat 官方仓库](https://github.com/lmparppei/Beat)、[Fountain 语法](https://fountain.io/syntax/)。CodeMirror 官方站点多次读取失败，未将未核实资料作为推荐依据。

## 已核对的 DSH 接口

本工作树基线为 `d347e70390`。`packages/client/ui-layout/src/client/index.ts` 的 `details` 为被会话详情占用的 single slot；`layout.openDetails/closeDetails` 只控制可见性。直接注册将替换会话详情，不可当成新增面板入口。

现主开发提供并已只读核对的新基线为 `b40bfafdade28b3490f851da609827e995ddeb91`，在独立发行源树中。该树 `ui-layout` 具有 `main.workbench` 和 `main.workbench.toggle`，两者仍为 single slot，提供 `layout.openWorkbench/closeWorkbench`。`ui-mantur-editing` 正在注册这些槽。其 `WorkbenchInjection.openWorkspace(sessionId)` 调用剪辑专属 `remote.manturEditing.open`，不能冒充剧本文件 API。`agent-opening.ts` 只响应观察到的成功 live 打开结果，按会话记住用户主动收起；这套产品行为可沿用，本原型没有复制或修改其代码。

现有 `conversation.send(text)` 通过 scoped session 的 `prompt([{type:'text',text}], 'queue')` 投递，成功只代表接收。接入时由当前 session scope 提供此回调，把选段、文件、版本和要求序列化为普通用户消息，保留现有日志机制。原型接点只验证会话一致性和调用，不曾运行真实主 Agent。

现有 `str_replace` 工具检查 old_str 唯一匹配，多处匹配会拒绝；它没有提供本需求的「整文件版本 + 精确偏移 + 草稿修订」联合提交机制。提示词要求只改一段不是写入保护。需要文件写入拥有者执行校验和恢复，不能仅在工具调用前检查后任由其他工具写入。

## 最小生产接入范围

1. 与工作台拥有者协调，在现有单一工作台内加一个明确的「剧本 / 剪辑」选择和内容分派；复用现有展开、收起及会话抑制，不改 Agent loop，不另造全局工作台框架。本原型没有执行这项修改。
2. 新增私有剧本插件，使用现有项目/会话身份与文件能力，明确剧本目录或清单，不把项目中每份 README 猜成一集。草稿由按项目、文件和会话归属的视图状态保存，避免卸载损失。
3. 同会话发送普通用户消息；新增受约束的选段写入能力或扩展现有写入拥有者，要求请求身份、整文件版本、精确选区、权限和取消状态均匹配，并在同一提交机制内处理竞争写入。结果元数据关联请求，落盘后再读回，才显示完成。
4. 把浏览器内恢复历史升级为持久版本，接入真实文件变更观察；补 Loader 真组合、Session 回放快照、真实 UI 和经授权的模型端到端。当前纯受控测试不能替代这些证据。

不需要新的登录门禁、模型账号、独立聊天系统、在线协作、制片或素材管理。模型使用仍受原主 Agent 的凭据和额度约束。本次没有调用任何付费模型或用户私有凭据。
