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

安装包中的桌面客户端使用包内资源目录和 Electron 可执行文件启用 `ui-mantur-editing`。开发 profile 显式选择 `runtimeMode: development` 并提供下表运行参数。选择剪辑通过已认证的 Remote 网关打开当前会话的编辑器。会话顶部也提供剪辑入口，便于收起工作台或刷新页面后重新打开已有会话的工程。没有选择会话或工作目录时显示明确提示。收起工作台保留当前会话的编辑器页面和原生 Agent 绑定，再次展开可继续同一编辑草稿。卸载 Agent 或 Host 请求相同的受检查退出流程；排空结果未确认时保留所属实例。

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

打包模式在打开会话前校验目标平台的 `manifest.json`；`./packaged-resources` 导出供安装包冒烟复用相同资源检查。缺少资源、不支持的目标或越出安装目录的路径会报错；运行时不会下载替代资源或启动 Vite。生产入口只将需要写入的 Remotion bundle 和 compositor 复制到会话私有目录，并将临时文件置于其中。正常退出在 HTTP 关闭后删除该目录，Host 随后等待子进程结束。排空或关闭失败会保留私有运行文件，并拒绝退出成功。持久工程、素材和导出目录保留。资源字段及尚未完成的分发检查见[打包运行提案](../../../.agents/notes/proposed/architecture/2026-09-07-mantur-packaged-editing-runtime.zh.md)。

“项目素材”浏览当前 Agent 目录及子目录。兼容素材直接引用原文件；必要的兼容性转换另存文件，不修改原片。`import_asset` 与 `import_folder` 使用同一接口。隐藏目录、`node_modules` 及项目的 `剪辑` 目录不参与浏览和批量导入。刷新可读取新增文件；丢失的源文件保留离线状态，直到用户选择替代文件。移除素材池条目或引用记录不删除原文件。

Agent 导入本地文件在手动模式下保留单次确认，素材先加入编辑草稿。重复导入按草稿内素材去重，审阅时与时间线修改一起应用。真实工程同时发生其他修改，草稿仍会因版本过期而被拒绝。 失效、取消和失败的会话保留最后保存的检查点作为只读证据，包含原始版本、草稿文档和操作记录。首次保存、后续保存和终态关闭依次执行。重新加载不会恢复终态会话，也不会重建缺失的历史内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`ctx.manturEditing.stopForShutdown()` 停止接收新的打开请求及原生 MCP 调用，保留正在启动和已经打开的实例，等待已接受的响应与附件写入。随后编辑器冻结浏览器输入，等待已接受的浏览器工作及其后续提交的任务，通过现有认证的 poll/result 通道保存工程和运行状态，并确认浏览器注销已经持久化。原生传输在该确认之后关闭；Host 随后必须收到编辑器子进程的实际 `close`，包括管道结束。重复调用保留原有成功或失败。超时保留运行中的工作并报错；协调器必须在此 Promise 完成前保持 Agent 服务、HTTP 和编辑器页面可用。

应用[打包补丁](adapters/mantur-cut-packaged.patch)得到编辑器树 `2a5be55239826a9e74bde5a5a5484a0f033d4da0` 后，再应用[退出补丁](adapters/mantur-cut-shutdown.patch)。退出补丁不增加公开 MCP 工具，也不修改固定的音频收尾流程。受管理的渲染路径传播 `browser.close()` 失败，但 Remotion 4.0.509 没有提供受支持的子进程及管道完整关闭确认；实际取得渲染浏览器的实例因此拒绝退出确认。使用过尚未接入排空的工作来源，或保留有保存及任务错误时，也拒绝确认。该增量不代表完整安装许可；[退出决策](../../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-editing-owned-shutdown.zh.md)记录验证限制。

编辑器通过工程存储通道确认实际语义向量可用性后才执行索引操作；检查失败或响应无效仍然报错。已接受的修改纳入浏览器退出等待。扩展与模型目录的指定 GET 请求保留原始完成 Promise；下载及安装请求仍须具备自己的退出管理。

| 退出补丁层 | 固定值 |
|---|---|
| 编辑器提交 | `08950ed125145b67c0835777a958992baeb377d9` |
| 结果树 | `078f8d3f343cafd003276ac10ea57fcb1ed7d47a` |
| 补丁 SHA-256 | `78ca03afd9a2afee5525af43c11d9713e87b7ff3e812b314755fd7d9226441df` |

Host Remote 解析 Agent，合并并发打开请求，并启动 `adapters/mantur-runtime.mjs`。既有 MCP 客户端挂载于该 Agent 作用域。所有挂载的 MCP 客户端解析到同一 peer 实例，保留 Agent 作用域内的服务器名称预留。MCP bearer 只存在于 Host 内存和子进程环境。卸载等待连接与子进程退出。Client 忽略已切走会话的启动结果。本包不发布 invariant companion：退出状态由子进程句柄直接持有，连接和工具版本约束由 MCP 客户端负责。

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

通过记录在模型请求中的 Agent 作用域内 MCP 工具和工作流提示段间接影响模型。

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
