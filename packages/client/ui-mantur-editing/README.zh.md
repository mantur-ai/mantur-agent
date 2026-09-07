---
description: "在漫途对话旁打开本地剪辑工作台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mantur-editing

[English](README.md) | 中文

## 概述

在首页选择剪辑，即可在漫途对话旁打开本地编辑器。素材池、预览、时间线和工程保存由编辑器管理。这个可选插件在会话的工作目录下为每个会话启动独立编辑器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

漫途 bundle 包含默认禁用的配置行。在 profile 补丁中启用 `ui-mantur-editing` 并提供下表运行参数。选择剪辑通过已认证的 Remote 网关打开当前会话的编辑器。会话顶部也提供剪辑入口，便于收起工作台或刷新页面后重新打开已有会话的工程。没有选择会话或工作目录时显示明确提示。收起工作台释放页面，后台剪辑任务继续运行到 Agent 或 Host 卸载。

每个会话使用 `<cwd>/剪辑/<session-id>/`：`工程/` 保存工程和运行状态，`素材/` 保存导入媒体，`导出/` 是默认成片目录。Host 从已解析 Agent 的 Session header 读取 `cwd`，浏览器不能指定其他目录。会话目录拒绝路径穿越和符号链接，重新打开保留已有文件。同一项目内的不同会话也使用独立编辑进程和工具作用域。

工作台标题栏、按钮与对话分隔线使用漫途的 0.5px 中性边框。

嵌入的剪辑器跟随漫途解析后的明暗主题，包括系统偏好变化，切换时不重新加载页面。OpenChatCut 部署必须在应用渲染前加载[主题适配器](adapters/openchatcut-theme.mjs)，并以明确可信的漫途回环源地址调用 `installManturTheme(window, parentOrigin)`。在剪辑器入口导入该模块，或通过服务器注入等效的模块脚本；部署资源中必须包含适配器。独立打开的剪辑器继续使用自己的皮肤偏好。适配器只修改界面颜色变量，保留媒体颜色和工程状态，不写入独立皮肤偏好。

构建前，在固定的 OpenChatCut 0.2.14 源码目录用 `git apply` 应用[漫途Cut 补丁](adapters/mantur-cut.patch)。补丁移除内置对话、外部连接配置、重复的模型及外观设置、生成入口、技能扩展、品牌设计和上游推广。保留素材、字幕、时间线、历史、导出与浮动修改确认卡片。语言通过与主题相同的受校验消息通道跟随漫途。界面品牌为漫途Cut，源码归属、许可证、协议标识和工程格式保留上游名称。

紧凑的宿主标题栏和有宽度上限的对话栏为编辑器腾出更多空间。展示补丁默认采用较窄的素材区、较低的时间线并收起属性面板；已保存的编辑器面板偏好仍然生效。用户仍可拖动面板分隔线，或切换属性面板。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `editorRoot` | 必填 | 已安装依赖并应用补丁的编辑器源码绝对路径 |
| `nodeExecutable` | 必填 | 兼容编辑器的 Node 可执行文件绝对路径 |
| `startupTimeoutMs` | 必填 | 编辑器启动最长等待时间 |
| `stopTimeoutMs` | 必填 | 强制停止前的退出宽限时间 |
| `toolCallTimeoutMs` | 必填 | 单次剪辑工具调用最长时间 |

“项目素材”浏览当前 Agent 目录及子目录。兼容素材直接引用原文件；必要的兼容性转换另存文件，不修改原片。`import_asset` 与 `import_folder` 使用同一接口。隐藏目录、`node_modules` 及项目的 `剪辑` 目录不参与浏览和批量导入。刷新可读取新增文件；丢失的源文件保留离线状态，直到用户选择替代文件。移除素材池条目或引用记录不删除原文件。

Agent 导入本地文件在手动模式下保留单次确认，素材先加入编辑草稿。重复导入按草稿内素材去重，审阅时与时间线修改一起应用。真实工程同时发生其他修改，草稿仍会因版本过期而被拒绝。 失效、取消和失败的会话保留最后保存的检查点作为只读证据，包含原始版本、草稿文档和操作记录。首次保存、后续保存和终态关闭依次执行。重新加载不会恢复终态会话，也不会重建缺失的历史内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host Remote 解析 Agent，合并并发打开请求，并启动 `adapters/mantur-runtime.mjs`。既有 MCP 客户端挂载于该 Agent 作用域。所有挂载的 MCP 客户端解析到同一 peer 实例，保留 Agent 作用域内的服务器名称预留。MCP bearer 只存在于 Host 内存和子进程环境。卸载等待连接与子进程退出。Client 忽略已切走会话的启动结果。本包不发布 invariant companion：退出状态由子进程句柄直接持有，连接和工具版本约束由 MCP 客户端负责。

受控的[编辑器补丁](adapters/mantur-cut.patch)采用下列固定来源。在干净的上游源码目录执行 `git apply --index`，构建前用 `git write-tree` 核对结果树。补丁包含本地导入写入草稿的修复及终态检查点持久化修复，没有额外编辑器修改。

| 来源 | 固定值 |
|---|---|
| OpenChatCut 0.2.14 上游提交 | `19cba6e1a70a3e589545ce02de975f6494c918f6` |
| 适配后的编辑器提交 | `d8f59016ea605fcb240798f0b5a73be48647dabc` |
| 适配后的编辑器源码树 | `229a7d996c209b5f90a64d9ab92637bd55abbd34` |
| 补丁 SHA-256 | `4b786eca9ab82479fc63d47f1adc382d89a6f25d8cef3ae3c9b4a7df3d458401` |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [布局](../ui-layout/README.zh.md) — 对话与工作台的组合。
- [漫途导航](../ui-mantur-navigation/README.zh.md) — 创作模式选择。
- [MCP 客户端](../../mcp/mcp-client/README.zh.md) — Agent 作用域内的剪辑工具。

-----

<a id="model-experience"></a>
## 模型体验

通过当前 Agent 作用域内的 MCP 客户端间接影响模型；该客户端负责剪辑工具的发现、执行和结果日志。

#### KV Cache 影响

打开剪辑会改变当前 Agent 可用的工具定义；后续请求可能重建相应的提示缓存前缀。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 源码适配器用于本地开发集成；编辑器、依赖、原生二进制与各平台安装包的分发仍需另行处理。
- 收起或重新加载会重建编辑器页面。工程保存和未保存修改的处理由编辑器负责。页面刷新会重置工作台显示状态。
- 运行故障明确报错，清理后可由用户重试启动。先前实验工程保留在原目录，本集成不会静默迁移或自动接管。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
