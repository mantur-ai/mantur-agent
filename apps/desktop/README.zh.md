# 漫途Agent 桌面端

[English](README.md) | 中文

桌面应用是由漫途（Mantur）打造、专门在本地完成漫剧创作与生产的漫途Agent。Electron 只负责原生窗口和一个子进程；子进程在随机 loopback 端口启动随附的 `dsh --profile mantur` 应用。开发应用与打包应用都把已确认的蓝色无限环 Logo 用于原生窗口、macOS Dock、关于面板和安装包资源。桌面包不会实现另一套 agent 运行时。

## 不打包开发

执行 `pnpm install` 后，先在干净检出上构建一次仓库产物：

```sh
pnpm run build:mantur
```

完成初始构建后，日常桌面端开发只需一条命令：

```sh
pnpm run desktop:dev
```

该命令会监听桌面端 TypeScript、资源和构建配置。每次改动都会执行桌面端 TypeScript 增量构建、bundle Electron 主进程、停止上一组 Electron 与 dsh 进程，再重新启动开发应用。dsh 的 stdout 和 stderr 仍会写入持久 Harness 日志，也会直接显示在终端。

开发模式使用 `mantur-agent-dev` 用户数据目录，已安装构建使用 `mantur-agent`；设置、会话、凭据和缓存不会在两种模式间串用。Electron 的 `app.isPackaged` 检查也会禁用开发模式的自动更新检查。如果 `apps/desktop` 之外的改动影响已构建的 Harness 或 Web 产物，需要再次执行 `pnpm run build:mantur`。

`desktop:dev` 不会创建 DMG、ZIP 或 NSIS 安装包，不会签名或 notarize 应用，不会向操作系统应用目录安装任何内容，也不会检查 release。只在验证安装、签名、notarization、release 更新或发布候选版时使用原生打包。

## 构建内部安装包

调用原生打包器之前，先安装不可变依赖图，再使用漫途标题构建全部 host 与 client 产物：

```sh
pnpm install --frozen-lockfile
pnpm run build:mantur
pnpm run desktop:dist:mac:arm64
pnpm run desktop:smoke
```

macOS x64 命令必须在 Intel Mac 上运行，Windows 命令必须在 x64 Windows 上运行。手动触发的 `Desktop package` GitHub Actions 工作流会在三个原生 runner 上检出同一个 commit、运行打包 smoke，并将以下文件保留七天：

| Runner | 命令 | 产物 |
|---|---|---|
| macOS arm64 | `pnpm run desktop:dist:mac:arm64` | `Mantur-Agent-macOS-arm64.dmg`、`Mantur-Agent-macOS-arm64.zip` |
| macOS x64 | `pnpm run desktop:dist:mac:x64` | `Mantur-Agent-macOS-x64.dmg`、`Mantur-Agent-macOS-x64.zip` |
| Windows x64 | `pnpm run desktop:dist:win:x64` | `Mantur-Agent-Windows-x64.exe` |

smoke 会从解包应用自己的依赖目录启动 `dsh`，把打印出的进程 token 换成会话 cookie，并要求带品牌标题的 Web 页面返回 HTTP 200。它还要求包内存在 updater 依赖与 GitHub release 配置。它使用空的临时 Harness home，避免开发者数据影响包检查结果。

## 发布已签名的 macOS release

手动触发的 `Desktop release` GitHub Actions 工作流会在原生 macOS runner 上分别构建 arm64 与 x64。两个任务都会使用 Developer ID Application 身份签名应用、提交 Apple notarization，并验证签名、Gatekeeper 评估与 stapled ticket；它们还会在产物进入组装步骤前运行 packaged smoke。

对外发布前，先在仓库设置中启用 Release Immutability。然后在 GitHub 的 `macos-release` 环境中配置一个变量和四个加密 secret：

| 类型 | 名称 | 值 |
|---|---|---|
| 变量 | `APPLE_TEAM_ID` | Apple Developer Team ID |
| Secret | `MACOS_CERTIFICATE` | 含 Developer ID Application 证书与私钥的 `.p12` 所对应的 Base64 内容 |
| Secret | `MACOS_CERTIFICATE_PASSWORD` | 导出 `.p12` 时使用的密码 |
| Secret | `APPLE_ID` | 用于 notarization 的 Apple ID |
| Secret | `APPLE_APP_SPECIFIC_PASSWORD` | 该 Apple ID 的 App 专用密码 |

工作流会把两份原生 `latest-mac.yml` 合并为一份可区分架构的更新通道，并把完整候选产物与 `SHA256SUMS` 保留七天。必须从精确匹配 `v<apps/desktop 版本>` 的 tag 运行；electron-updater 可以从 GitHub feed 中选择这种兼容 semver 的预发布 tag。`publish=false` 会在组装候选产物后停止；`publish=true` 会创建 GitHub release，并同时上传 DMG、更新 ZIP、blockmap、更新元数据与哈希。工作流会拒绝使用已有 release 的 tag，不会替换已发布文件；仓库级 Release Immutability 则会继续阻止之后修改 tag 或产物。

## 运行时设计

主进程通过 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 作为 Node 可执行文件，并以 `--profile mantur --host 127.0.0.1 --port 0 --no-open` 启动已构建的 `@deepseek-ai/dsh` 入口。就绪解析器只接受带 token 的 `127.0.0.1` URL。renderer 禁用 Node integration、启用 context isolation 与 sandbox，并把离开本地 origin 的导航交给操作系统浏览器。

安装包携带既有运行时依赖闭包和已构建 Web 前端。Loader profile、插件 manifest、原生模块与 subprocess helper 都需要普通文件，因此 `asar` 保持禁用。关闭或重启应用时，Electron 会等待子进程终止后再退出。Electron 父进程通过 Node IPC 通道连接子进程；各功能模块负责校验自己的消息。

Main 持有操作系统加密的原生账号存储，并校验来自当前本地主 frame 的账号操作。桌面启动显式选择漫途 provider 的 `desktop-managed` 身份。Host API 响应通过逐请求 loopback broker 流式传输，仅 Main 向上游发送设备 bearer。命令描述文件保持私有，直至 consumer 确认整棵进程树清理完成。退出登录会取消已接受的流与命令，但保留加密的远端清理记录，直到 HTTP 204 或原始到期时间。

永久应用标识为 `ai.mantur.agent`。Electron 就绪前，载体会在操作系统的应用数据根目录下设置稳定的 `mantur-agent` 用户数据目录。其 `harness` 子目录是已安装应用使用的唯一 `DSH_HOME`，因此 `~/.dsh` 中的 CLI 或开发数据不会影响桌面启动。子进程从应用自有的中性目录启动，并把 stdout、stderr、恢复与 updater 诊断追加到同一用户数据根下的 `logs/harness.log`。

如果启动错误只识别到过期的 `session_projcache` schema，载体会先关闭失败的子进程并完成日志写入，再由本地化原生对话框在用户明确同意后删除这份可丢弃的投影缓存并重试。它不会删除会话日志、设置、凭据、profile 或 workspace。其他启动错误只提供查看日志与退出，不猜测修复方式。

已打包应用会在 macOS 的原生应用菜单和 Windows 的帮助菜单中显示当前版本与**检查更新…**。菜单会显示检查中、下载进度、可安装、已是最新版与失败状态；手动检查还会打开本地化的结果或错误对话框。应用启动后会开始检查，并每六小时重复。stable 构建只接收 stable release，版本号含 `alpha`、`beta` 或 `rc` 的构建可以接收预发布版本。后台发现新版本时保持安静。漫途侧栏在展开与收起状态下都在设置上方显示更新入口；空闲或已是最新版时不保留卡片。只有用户点击下载才开始传输，显示实际字节数，仅在已知时显示百分比。下载并校验完成后，准备重启前会请求确认。Host 尚未提供可验证的最终任务日志保存回执，因此自动安装保持阻止状态；此路径不会停止任务。选择稍后会保留重启安装入口，不重复弹窗。侧栏和原生菜单共用主进程确认；保存失败会保留已校验的下载并报告错误。关闭 updater 会抑制后续安装。

macOS Intel、macOS Apple Silicon 与 Windows 使用同一个更新控制器。macOS release 更新需要已签名并 notarize 的应用，以及生成的 ZIP 与更新元数据；DMG 仍是人工安装产物。Windows 对外更新需要代码签名身份、受保护的发布凭据与生成的 NSIS 更新产物；本仓库不提供或绕过这些前置条件。

## 草稿检查点

<a id="draft-checkpoints"></a>

沙箱化 preload 仅暴露具名的草稿读取、保存、重启准备及更新状态与操作消息。主进程只接受当前本地主 frame 的调用，并在 `userData/drafts` 下写入完整检查点，不依赖随机 loopback origin。检查点保留完整编辑器文档、Skill 引用标识，以及用户已经选择的图片原始字节和 SHA-256 摘要。一个 revision 覆盖所有草稿归属以及未关联草稿转入 Session 的两端。过期 revision、附件不完整、存储错误或 renderer 无响应都会阻止重启准备；取消会释放输入锁。

在 macOS 上，保存回执仅在检查点文件与父目录同步后返回。Windows 尚未实现原生持久发布路径，保存会明确失败；Node 未提供所需的目录 fsync 操作。恢复只读取应用检查点和当前 origin 中存在的旧文本草稿。发生冲突会明确报告，不扫描其他浏览器 origin，也不替换其数据。漫途 profile 在启用首次发送准备前将未关联输入框接入此检查点。

载体将 `app.getPath('documents')` 下的 `漫途项目` 子目录作为 `DSH_MANTUR_PROJECTS_ROOT` 传给 Host。该值只指定默认根目录，不提前创建目录。[项目所有者](../../packages/workspace/mantur-projects/README.zh.md)持久保存用户明确更改的位置，仅在首次发送时创建子目录。

## 已知限制

- 原生账号 Main、preload、provider、表单与 Bash、PowerShell、PTY 消费方已在源码中连接。表单提供注册、浏览器授权、持久跳过和精确到期状态，不发布设备 bearer。广场登录路由、打包 CLI 调用和原生操作系统验收仍未完成。Loopback IPC、模拟 preload 浏览器测试和固定 CLI 测试不能证明完整原生登录已可用；[接入提案](../../.agents/notes/proposed/architecture/2026-09-07-desktop-native-account-identity.zh.md)记录剩余验收条件。
- `Desktop package` 产物仍是未签名的内部安装包。macOS Gatekeeper 与 Windows SmartScreen 可能对这些文件显示警告；对外分发 macOS 客户端时只能使用 `Desktop release` 产物。
- 原生图标源文件是带白色圆角底和透明外角的 1024 px PNG，Web 客户端单独使用透明 Logo。macOS 和 Windows 包会在原生构建时生成各自的平台图标格式；当前没有矢量源文件。
- 已签名的 release 工作流只发布 macOS。Windows 在具备代码签名身份与受保护的发布路径之前不支持外部更新。
- 每个目标只在其原生 runner 同时完成打包和 smoke 后有效。一个架构上的构建不能作为另一目标的证据。
