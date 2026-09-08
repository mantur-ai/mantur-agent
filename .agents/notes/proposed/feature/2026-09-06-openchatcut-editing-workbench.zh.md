# Agent Note: 验证 OpenChatCut 剪辑工作台

Status: proposed

[English](2026-09-06-openchatcut-editing-workbench.md) | 中文

## Problem

漫途用户需要在现有对话旁操作可编辑时间线，并具备手动接管、预览、撤销、项目保存和可播放导出能力。单独的编辑器窗口或成功的工具返回都不能证明这一工作流成立。

## Proposal

在添加产品代码前，验证固定提交 `19cba6e1a70a3e589545ce02de975f6494c918f6` 的 OpenChatCut 0.2.14。漫途继续负责推理，复用现有插件、profile、工具和 UI 扩展点。上游 Skill 文档中的外部入口是 MCP；浏览器桥属于内部接口，未找到受支持的剪辑 CLI（命令行界面）或已发布 SDK。用户已授权实验 MCP 连接。[本地工作台实现](../../implemented/feature/2026-09-06-mantur-local-editing-workbench.zh.md)记录浏览器、持久化和导出证据；生产打包与多工程绑定仍待实现。

源码使用 `useEditor`、`buildCommands`、`makeDraft` 和项目/历史 reducer，并没有单独发布的 EditorCore 包。源码级检查导入三段合成 MP4 的素材引用，在 30 fps 下各裁至 60 帧，使用 `edit_track/reorder_items` 将 C、A、B 放在第 0、60、120 帧。原子撤销/重做、直接命令改动后工具读回及 JSON 往返检查通过。这些结果不能证明浏览器导入、用户手势、应用持久化、渲染、导出或漫途接入。

隔离的 Node 24 服务在回环地址返回 HTTP 200，使用显式空白数据目录且不带模型凭据。九项上游聚焦检查通过。接入验证中内置浏览器可用；此前的 `ERR_BLOCKED_BY_CLIENT` 不能据此认定为 OpenChatCut 缺陷。单条 `move_item` 可能报告成功，但碰撞约束会改变最终帧位置，因此接入方必须在修改后验证状态。

可分发桌面端方案只在匹配的原生 runner 上构建，并固定 OpenChatCut commit、上游 tree、三层补丁摘要与结果 tree、npm 包 integrity、Chrome 归档、FFmpeg 二进制、whisper.cpp v1.9.2 commit 及 CMake 官方 macOS 归档。CMake 只保留在构建缓存中，不进行全局安装。生成的只读 `resources/mantur-cut` 资源树包含内嵌服务端、编辑器资产、Remotion bundle 与 compositor、Chrome Headless Shell、FFmpeg、ffprobe、Whisper CLI 与 server、生产依赖、源码标识、补丁、保留的许可证、依赖清单、构建与工具版本、内容哈希及生产审计。由于 electron-builder 会排除额外资源根目录中名为 `node_modules` 的目录，生产依赖位于 `runtime/node_modules` 下；仅供构建使用的包命令链接会在计算哈希前移除。Electron 通过 `ELECTRON_RUN_AS_NODE=1` 提供 Node 24 运行时，安装包不再携带另一份 Node。运行时代码必须在该资源根目录内解析 manifest 声明的每条相对路径，不得下载或使用开发回退。macOS 打包由 electron-builder 完成签名与更新 ZIP，再由 `hdiutil` 使用临时唯一卷名生成 DMG 和 blockmap，最后恢复正式产品卷名。应用数据仍写入已安装应用的用户数据与项目目录。

内部打包工作流为 macOS arm64、macOS x64 和 Windows x64 构建未签名候选包。公开工作流会签名并 notarize macOS 候选包，但只有受保护的 `MANTUR_CUT_DISTRIBUTION_APPROVAL` 变量精确等于完整固定分发配置的 `approved:<source-config-sha256>` 时才能发布。该批准记录外部发布决策；构建成功不代表系统自行接受许可证条款。

## Alternatives considered

复制编辑器核心会形成第二套维护实现。以外部客户端身份调用可信浏览器桥会依赖不受支持的私有接口。打开外部浏览器不能满足内置工作台要求。上述方案均未实现。

## Acceptance criteria

用户在漫途内部打开工作台，对话同时保持可用。三段明确标识的本地测试片段经过导入、漫途排序裁切、预览、手动修改后 agent（智能体）读回、撤销、保存重开，并导出可播放 MP4。草稿审阅和每次导出的确认仍有效。每个原生包都要校验全部 manifest 路径，启动包内 Whisper CLI 与 server，执行一次导出，并记录精确源码、构建、审计、签名与 notarization 证据。证据区分命令测试与端到端结果；macOS Intel 和 Windows 需要原生验证。

## Risks

OpenChatCut 的 AGPL-3.0-or-later 条款要求为修改后的分发版本提供具体的对应源码交付方式。Remotion 4.0.509 使用独立条款，其免费授权取决于实体资格和允许用途；分发方必须确认资格或取得所需公司许可证。ffmpeg-static 声明 GPL-3.0-or-later，各目标 ffprobe 包声明 GPL-3.0 或 LGPL-2.1，whisper.cpp 声明 MIT，Chrome Headless Shell 携带独立 notice 文件。当前固定生产依赖审计在 `@huggingface/transformers`、`onnxruntime-node`、`adm-zip` 和 `sharp` 中报告四项高危发现；打包成功不会消除或批准这些问题。Mantur iframe 尚未安装 OpenChatCut 的桌面推理 preload，因此打包并启动 Whisper 二进制不会使原生 ASR 可用。内置字体条款及其他二进制依赖也需要审核。开源不等于商业嵌入已获许可。源码通过绑定会话、运行、工具及参数的一次性批准开放真实项目导出；README 中排除外部导出的表述已滞后。打包、媒体权限、浏览器隔离、项目所有权、取消操作及编辑器生命周期仍是尚未验证的接入成本。
