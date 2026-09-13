---
description: "在漫途对话旁打开本地剪辑工作台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mantur-editing

[English](README.md) | 中文

## 概述

点击漫途对话右侧边缘的箭头打开共同工作台，再选择“剪辑”。选择创作模式不会打开或关闭工作台。素材池、预览、时间线和工程保存由编辑器管理。这个可选插件在会话的工作目录下为每个会话启动独立编辑器。

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

浏览器组合需要[共同剧本工作台](../ui-mantur-script/README.zh.md)，由它拥有根面板并声明本插件的子槽。不支持只挂载剪辑的独立浏览器组合。卸载本插件会移除其标签和内容，不关闭共同外框。只有既有打开策略允许显示时，现场打开请求才会选择“剪辑”。

安装包中的桌面客户端使用包内资源目录和 Electron 可执行文件启用 `ui-mantur-editing`。开发 profile 显式选择 `runtimeMode: development` 并提供下表运行参数。常驻的边缘箭头通过已认证的 Remote 网关打开当前会话的编辑器，展开后可用同一箭头收起工作台。本地化无障碍标签和 `aria-expanded` 分别描述当前动作与状态。没有选择会话或工作目录时显示明确提示。收起工作台保留当前会话的编辑器页面和原生 Agent 绑定，再次展开可继续同一编辑草稿。标题栏的“刷新”重新创建同一会话的编辑器页面，不删除已保存的工程文件。卸载 Agent 或 Host 请求相同的受检查退出流程；排空结果未确认时保留所属实例。

Agent 可在原生剪辑工具挂载前调用 `open_editing_workbench`。调用不接受项目或会话参数，使用调用方 Agent 的既有工作目录。成功结果只表示运行时及原生 MCP 连接就绪，不表示修改已应用。常驻边缘按钮挂载后，Client 开始观察打开调用；仅在观察到现场调用从进行中变为成功后显示工作台。用户收起后，该会话后续调用（包括后续轮次）持续抑制自动打开；用户仍可随时用边缘箭头手动展开。历史回放和切回会话不会弹开面板。隐藏视图保留工具、编辑器页面和进行中的工作。

每个会话使用 `<cwd>/剪辑/<session-id>/`：`工程/` 保存工程和运行状态，`素材/` 保存导入媒体，`导出/` 是默认成片目录。Host 从已解析 Agent 的 Session header 读取 `cwd`，浏览器不能指定其他目录。会话目录拒绝路径穿越和符号链接，重新打开保留已有文件。同一项目内的不同会话也使用独立编辑进程和工具作用域。

工作台标题栏、按钮与对话分隔线使用漫途的 0.5px 中性边框。

嵌入的剪辑器跟随漫途解析后的明暗主题，包括系统偏好变化，切换时不重新加载页面。OpenChatCut 部署必须在应用渲染前加载[主题适配器](adapters/openchatcut-theme.mjs)，并以明确可信的漫途回环源地址调用 `installManturTheme(window, parentOrigin)`。在剪辑器入口导入该模块，或通过服务器注入等效的模块脚本；部署资源中必须包含适配器。独立打开的剪辑器继续使用自己的皮肤偏好。适配器只修改界面颜色变量，保留媒体颜色和工程状态，不写入独立皮肤偏好。

构建前，在固定的 OpenChatCut 0.2.14 源码目录用 `git apply` 应用[漫途Cut 补丁](adapters/mantur-cut.patch)。补丁移除内置对话、外部连接配置、重复的模型及外观设置、生成入口、技能扩展、品牌设计和上游推广。保留素材、字幕、时间线、历史、导出与浮动修改确认卡片。语言通过与主题相同的受校验消息通道跟随漫途。界面品牌为漫途Cut，源码归属、许可证、协议标识和工程格式保留上游名称。

紧凑的宿主标题栏和有宽度上限的对话栏为编辑器腾出更多空间。展示补丁默认采用较窄的素材区、较低的时间线并收起属性面板；已保存的编辑器面板偏好仍然生效。用户仍可拖动面板分隔线，或切换属性面板。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `runtimeMode` | 必填 | `development` 使用 Vite 源码；`packaged` 使用构建后的生产服务 |
| `editorRoot` | 必填 | 已准备源码或包内资源目录的绝对路径 |
| `nodeExecutable` | 必填 | 开发模式使用 Node 绝对路径；打包模式使用已安装 Electron 可执行文件 |
| `startupTimeoutMs` | 必填 | 编辑器启动最长等待时间 |
| `stopTimeoutMs` | 必填 | 关闭确认及子进程和管道结束的最长等待；超时只报错，不强杀 |
| `toolCallTimeoutMs` | 必填 | 单次剪辑工具调用及每次编辑器排空请求的最长时间 |

打包模式在打开会话前校验目标平台的 `manifest.json`。格式版本 2 标识应用全部三层编辑器补丁后构建的资源；支持退出管理的运行时拒绝版本 1，不复用旧资源。`./packaged-resources` 导出供安装包冒烟复用相同资源检查。缺少资源、不支持的目标或越出安装目录的路径会报错；运行时不会下载替代资源或启动 Vite。生产入口只将需要写入的 Remotion bundle 和 compositor 复制到会话私有目录，并将临时文件置于其中。正常退出在 HTTP 关闭后删除该目录，Host 随后等待子进程结束。排空或关闭失败会保留私有运行文件，并拒绝退出成功。持久工程、素材和导出目录保留。资源字段及尚未完成的分发检查见[打包运行提案](../../../.agents/notes/proposed/architecture/2026-09-07-mantur-packaged-editing-runtime.zh.md)。

“项目素材”浏览当前 Agent 目录及子目录。兼容素材直接引用原文件；必要的兼容性转换另存文件，不修改原片。`import_asset` 与 `import_folder` 使用同一接口。隐藏目录、`node_modules` 及项目的 `剪辑` 目录不参与浏览和批量导入。刷新可读取新增文件；丢失的源文件保留离线状态，直到用户选择替代文件。移除素材池条目或引用记录不删除原文件。

Agent 导入本地文件在手动模式下保留单次确认，素材先加入编辑草稿。重复导入按草稿内素材去重，审阅时与时间线修改一起应用。真实工程同时发生其他修改，草稿仍会因版本过期而被拒绝。 失效、取消和失败的会话保留最后保存的检查点作为只读证据，包含原始版本、草稿文档和操作记录。首次保存、后续保存和终态关闭依次执行。重新加载不会恢复终态会话，也不会重建缺失的历史内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

公开 `./types` 入口发布为 `lib/types.js`，与 Host 和 Client bundle 分开。TypeScript 声明保留在 `lib/types/` 下；私有浏览器 JavaScript 及其未打包的样式表导入不参与发布。

`ctx.manturEditing.stopForShutdown()` 停止接收新的打开请求及原生 MCP 调用，保留正在启动和已经打开的实例，等待已接受的响应与附件写入。随后编辑器冻结浏览器输入，等待已接受的浏览器工作及其后续提交的任务，通过现有认证的 poll/result 通道保存工程和运行状态，并确认浏览器注销已经持久化。原生传输在该确认之后关闭。MCP GET 长连接及 DELETE 处理器的原始 Promise 与保存回调分别保留；Host 关闭已排空的 MCP 客户端后，适配器等待 `finishTransportShutdown()`，随后才关闭 HTTP。Host 最终必须收到编辑器子进程的实际 `close`，包括管道结束。重复调用保留原有成功或失败。超时保留运行中的工作并报错；协调器必须在此 Promise 完成前保持 Agent 服务、HTTP 和编辑器页面可用。

应用[打包补丁](adapters/mantur-cut-packaged.patch)得到编辑器树 `2a5be55239826a9e74bde5a5a5484a0f033d4da0` 后，再应用[退出补丁](adapters/mantur-cut-shutdown.patch)。退出补丁不增加公开 MCP 工具，也不修改固定的音频收尾流程。受管理的渲染路径传播 `browser.close()` 失败，但 Remotion 4.0.509 没有提供受支持的子进程及管道完整关闭确认；实际取得渲染浏览器的实例因此拒绝退出确认。使用过尚未接入排空的工作来源，或保留有保存及任务错误时，也拒绝确认。该增量不代表完整安装许可；[退出决策](../../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-editing-owned-shutdown.zh.md)记录验证限制。

编辑器固定修复后的图像与归档依赖，保留模型及语音提供方；范围与原生验证限制见[依赖安全决策](../../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-editor-security-dependencies.zh.md)。

浏览器工具结果会在完成 MCP 调用前同步权威项目版本。同步失败仍返回错误，取消或注册替换不能恢复成功状态；见[结果版本决策](../../../.agents/notes/implemented/bug-fix/2026-09-09-mantur-editor-result-revision.zh.md)。

编辑器通过工程存储通道确认实际语义向量可用性后才执行索引操作；检查失败或响应无效仍然报错。已接受的修改纳入浏览器退出等待。扩展与模型目录的指定 GET 请求保留原始完成 Promise；下载及安装请求仍须具备自己的退出管理。

本地 `/api/extract-frames` 请求保留 FFmpeg、FFprobe、可选 Python 标注及临时文件清理的完成结果。部分预览不会清除采样或标注错误；这些错误仍会拒绝退出。[抽帧决策](../../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-extract-frames-shutdown.zh.md)记录实际媒体验证与范围限制。

隔离配置下 `/upload` 的 POST 和 PUT 请求保留请求体、存储工作及文件流关闭结果。其他上传路由和默认配置仍未确认。[本地上传决策](../../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-local-upload-shutdown.zh.md)记录支持路径与验证限制。

| 退出补丁层 | 固定值 |
|---|---|
| 编辑器提交 | `2ee4ba5962336268d5de95b24a4fe5b09d8ba5c1` |
| 结果树 | `6f3b4ba1dbfbfbe02fcaefd80998b8f6d049c15b` |
| 补丁 SHA-256 | `ed820c9fd777c305986f713be304387109003d6cb7b4fb07f0956f5865bbb9c4` |

Host Remote 解析 Agent，合并并发打开请求，并启动 `adapters/mantur-runtime.mjs`。既有 MCP 客户端挂载于该 Agent 作用域。所有挂载的 MCP 客户端解析到同一 peer 实例，保留 Agent 作用域内的服务器名称预留。MCP bearer 只存在于 Host 内存和子进程环境。卸载等待连接与子进程退出。Client 忽略已切走会话的启动结果。本包不发布 invariant companion：退出状态由子进程句柄直接持有，连接和工具版本约束由 MCP 客户端负责。

打开工具随剪辑插件注册，不依赖面板是否可见。成功结果携带无凭据的 `mantur-editing-workspace` 展示元数据，包含调用会话、本机编辑器地址和剪辑目录。地址由校验后的本机端口构造；Bearer 保留在 Host。启动及取消失败继续作为普通工具错误。Client 通过既有对话事件接收打开信号，不解析模型文案。见 [Agent 入口决策](../../../.agents/notes/implemented/feature/2026-09-09-mantur-agent-editing-entry.zh.md)。

工作台成功启动后，在所属 Agent 的作用域内挂载原生 MCP 工具和一个 `systemPrompt.section`。该说明涵盖草稿读取、审核与终态确认、应用后开启新草稿、重复修改前核对已保存内容，以及工程与源素材帧率的区别。下一次模型请求通过 `request/header` 记录这段说明。未打开工作台的 Agent 不接收剪辑说明；隐藏视图保留说明，释放 Agent 或 Host 则移除。说明本身不能修复断开的连接，也不能证明剪辑成功。

受控的[编辑器补丁](adapters/mantur-cut.patch)采用下列固定来源。在干净的上游源码目录执行 `git apply --index`，构建前用 `git write-tree` 核对结果树。补丁包含草稿导入、终态检查点持久化及普通 H.264 音频收尾。后者分离现有 PCM 混音，在视频渲染后直接将 AAC 编入 MP4，保留视频包及固定 Remotion 版本的音轨行为。失败处理、回归命令和升级限制见[音频时序决策](../../../.agents/notes/implemented/bug-fix/2026-09-07-mantur-cut-aac-timing.zh.md)。

| 来源 | 固定值 |
|---|---|
| OpenChatCut 0.2.14 上游提交 | `19cba6e1a70a3e589545ce02de975f6494c918f6` |
| 适配后的编辑器提交 | `863354fba45960fafc9e7d0661b65f413d1baeee` |
| 适配后的编辑器源码树 | `65d96973380a14050c19c0928a22d1fd59714af7` |
| 补丁 SHA-256 | `6a292e61b74e4915723d389cc7c77f87fcbd91f71860f666223e2c6916479307` |

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

### 剪辑入口与原生工作流

#### 模型看到什么

首次使用前即可发现 `open_editing_workbench`；成功时以 JSON 返回调用会话、本机编辑器地址和剪辑目录，失败仍为工具错误。启动后，Agent 作用域的原生 MCP 工具及工作流说明进入有日志的模型请求。打开、应用草稿、保存和导出分别报告结果。

#### Token 影响

打开工具 schema 增加固定请求开销。成功打开会增加原生工具定义和工作流说明；工具结果在会话历史中累积，直到上下文压缩。

#### KV Cache 影响

打开剪辑会改变当前 Agent 的工具定义和系统提示；后续请求可能重建相应的提示缓存前缀。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 源码适配器用于本地开发集成；编辑器、依赖、原生二进制与各平台安装包的分发仍需另行处理。
- 切换会话、明确重新加载编辑器或刷新页面会重建编辑器页面，不支持跨这些操作继续旧草稿。其他会话不保留隐藏的编辑器页面，已保存工程仍在磁盘上。页面刷新会重置工作台显示状态。
- 运行故障明确报错，清理后可由用户重试启动。先前实验工程保留在原目录，本集成不会静默迁移或自动接管。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
