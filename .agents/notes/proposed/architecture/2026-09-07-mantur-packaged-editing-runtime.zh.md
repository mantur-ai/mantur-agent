# Agent Note: 打包漫途剪辑运行服务

Status: proposed

[English](2026-09-07-mantur-packaged-editing-runtime.md) | 中文

## 问题

[本地工作台](../../implemented/feature/2026-09-06-mantur-local-editing-workbench.zh.md) 依赖外部源码和 Node 路径。品牌安装包即使装入插件代码，也不意味着包含可用编辑器。集成必须区分生产运行服务与开发预览，同时保留会话存储和剪辑协议。

## 提案

打包既有 OpenChatCut 生产前端和内嵌服务，依次应用固定漫途基础、宿主集成与退出三层补丁。桌面端向发布 profile 提供只读资源根目录和 Electron 可执行文件。打包模式要求目标平台清单；开发模式保持显式配置。子进程使用 Electron 的 Node 模式，不另行下载 Node 分发包。

资源清单使用 formatVersion 2、platform 和 arch、全部三层补丁摘要及最终结果树，以及 server、web、remotionBundle、browserExecutable、ffmpeg、ffprobe、compositor、whisperCli 和 whisperServer 九个相对路径。版本 1 会被拒绝，支持退出管理的 Host 因此不能复用旧的两层资源格式。服务导出 startEmbeddedServer，接受明确的漫途随机端口和父源选项。web 目录包含 index.html 与 mantur-theme.mjs。每个引用资源必须存在且位于包内。构建准备负责哈希、明确的生产依赖闭包和许可材料；运行时不获取缺失资源。

子进程将 OPENCHATCUT_WHISPER_CLI 设为校验后的 CLI 路径。上游原生 ASR 在 CLI 同目录查找 whisper-server(.exe)，因此清单必须声明同一个相邻文件。漫途 iframe 未暴露上游桌面推理 preload；打包这些程序不代表已启用或验证原生转写。接通原生推理需要独立实现和验收，不能替换提供方来代替。

Host 只为已打开的会话启动编辑器。持久工程、素材和导出路径保留既有归属。会话工程目录下的私有目录存放临时文件、可写 Remotion bundle 和 compositor 副本。包本身不接收运行写入。就绪通知使用既有 Host IPC 消息；停止请求等待 HTTP 关闭和子进程结束。这不证明任意脱离后代进程已纳入安全更新管理。

## 考虑过的替代方案

**复制开发源码和 node_modules。** 这会包含开发工具和本机路径，无法明确生产依赖闭包或原生目标。

**在安装包中使用本地 Vite 服务。** 开发服务改变运行依赖，并允许写入源码树。上游既有内嵌生产服务无需 Vite 服务即可管理相同 HTTP 中间件。

**首次使用时下载缺失运行文件。** 这会掩盖不完整的安装包，并引入未验证的网络依赖行为。缺少资源必须拒绝启动。

## 验收标准

每个受支持的原生包必须加载 Node 侧模块、启动真实内嵌编辑器、在包资源之外保留工程写入、连接作用域 MCP 工具、渲染受控视频，并停止全部所属进程。错误目标身份、缺少资源和越界路径必须在创建会话状态前失败。既有无密钥剪辑工作流和原生账号入口行为必须保持有效。候选必须附带固定产物哈希与许可、源码材料。

## 风险

当前实现及 IPC 夹具检查不构成完整安装包或原生导出验收。macOS arm64、macOS x64 和 Windows x64 各自需要原生依赖与打包运行证据。固定 macOS Whisper 程序的构建需要 CMake；生产依赖审计仍有未解决的高危项。分发许可和源码义务仍是发布前提。活动导出取消、动态加入的管理对象及脱离后代仍属独立安全更新限制；闲置 HTTP 关闭成功不能授权安装。
