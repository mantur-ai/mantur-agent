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

默认情况下，开发模式使用 `mantur-agent-dev` 用户数据目录，已安装构建使用 `mantur-agent`；各自的设置、会话、凭据和缓存保持分离。Electron 的 `app.isPackaged` 检查也会禁用开发模式的自动更新检查。如果 `apps/desktop` 之外的改动影响已构建的 Harness 或 Web 产物，需要再次执行 `pnpm run build:mantur`。

需要显式配置本地 profile 时，传入 Electron 的 `--user-data-dir=/absolute/directory` 启动参数。桌面端将该目录同时用于 `userData` 和 `sessionData`，包括浏览器 cookie 与缓存，并从其 `harness` 子目录派生 `DSH_HOME`。不同目录隔离各个 profile；选择同一目录会共享数据。目录不存在时会创建。空值、相对路径、含 NUL 的路径、文件系统根目录或不可用路径会在账号、草稿或 Harness 初始化前阻止启动；失败不会切换到默认目录。该选项不会搜索、迁移或复制账号、密钥及已有 profile。仅修改 `HOME` 不能隔离桌面数据。

`desktop:dev` 不会创建 DMG、ZIP 或 NSIS 安装包，不会签名或 notarize 应用，不会向操作系统应用目录安装任何内容，也不会检查 release。只在验证安装、签名、notarization、release 更新或发布候选版时使用原生打包。

## 构建内部安装包

调用原生打包器之前，先安装不可变依赖图，再使用漫途标题构建全部 host 与 client 产物。macOS 构建机必须提供 Xcode Command Line Tools 编译器，因为固定的 whisper.cpp 源码没有上游 macOS 发布二进制。资源构建器会把固定的 CMake 官方归档下载到 `.cache/mantur-cut/tools`，校验其 SHA-256 摘要，且不会进行全局安装：

```sh
pnpm install --frozen-lockfile
pnpm run build:mantur
pnpm run desktop:dist:mac:arm64
pnpm run desktop:smoke
```

每条 `desktop:dist:*` 命令都会先从固定的 OpenChatCut 与 whisper.cpp commit 准备对应的 Mantur Cut 资源树。该步骤会校验基础、打包运行时与退出三层补丁的摘要及结果 Git tree、package-lock integrity、下载归档哈希以及请求的原生目标。源码配置与运行资源清单要求格式版本 2，旧的两层资源会被拒绝。清单记录三层补丁摘要与应用退出补丁后的最终树。安装包会携带内嵌服务端、已构建编辑器、Remotion bundle 与 compositor、Chrome Headless Shell、FFmpeg、ffprobe、Whisper CLI 与 server、含全部三层补丁的精确源码记录、保留的许可证文件和生产依赖审计。打包运行时不会下载缺失可执行文件，也不会回退到开发检出。

Chrome for Testing 下载 URL 将版本号放在目录中，并使用 `chrome-headless-shell-<platform>.zip` 作为归档文件名。本地缓存文件名还会包含固定版本号。

macOS 命令先由 electron-builder 完成签名并生成更新 ZIP，再用 Apple 的 `hdiutil` 创建 DMG。构建阶段使用临时唯一卷名，避免与已安装或已挂载的同名应用冲突；最终镜像会恢复 `漫途Agent` 卷名、加入 Applications 快捷方式，并生成独立的更新 blockmap。挂载点使用 macOS `getconf DARWIN_USER_TEMP_DIR` 下的独立临时目录，镜像文件仍位于构建输出目录；解析或创建挂载点失败会停止打包。

macOS x64 命令必须在 Intel Mac 上运行，Windows 命令必须在 x64 Windows 上运行。手动触发的 `Desktop package` GitHub Actions 工作流会在三个原生 runner 上检出同一个 commit、运行打包 smoke，并将以下文件保留七天：

| Runner | 命令 | 产物 |
|---|---|---|
| macOS arm64 | `pnpm run desktop:dist:mac:arm64` | `Mantur-Agent-macOS-arm64.dmg`、`Mantur-Agent-macOS-arm64.zip` |
| macOS x64 | `pnpm run desktop:dist:mac:x64` | `Mantur-Agent-macOS-x64.dmg`、`Mantur-Agent-macOS-x64.zip` |
| Windows x64 | `pnpm run desktop:dist:win:x64` | `Mantur-Agent-Windows-x64.exe` |

smoke 会从解包应用自己的依赖目录启动 `dsh`，把打印出的进程 token 换成会话 cookie，并要求带品牌标题的 Web 页面返回 HTTP 200。它还会校验 Mantur Cut manifest 中的每条路径，以 `--help` 启动包内 Whisper CLI 与 server，要求源码、许可证、构建及安全记录齐全，并检查 updater 依赖与 GitHub release 配置。它使用空的临时 Harness home，避免开发者数据影响包检查结果。

smoke 还会检查内置 CLI 的固定来源记录、包版本、许可证和依赖入口，创建真实的配置目录内启动脚本，并要求 `manturhub --version` 使用包内 Electron 可执行文件返回 `0.11.0`。启动脚本关闭 CLI 和技能更新检查。缺少资源直接失败，不搜索全局 CLI。该检查不会创建账号授权尝试，也不验证浏览器授权、Main 的操作系统存储，或以 macOS 结果证明 Windows 行为。

打包时将 CLI 来源记录和 `node_modules` 目录分别作为资源输入。Electron Builder 在复制目录时排除其顶层 `node_modules` 子目录；直接选择模块目录本身，才能保留内置 CLI 及其依赖。

## 发布已签名的 macOS release

手动触发的 `Desktop release` GitHub Actions 工作流会在原生 macOS runner 上分别构建 arm64 与 x64。两个任务都会使用 Developer ID Application 身份签名应用、提交 Apple notarization，并验证签名、Gatekeeper 评估与 stapled ticket；它们还会在产物进入组装步骤前运行 packaged smoke。

对外发布前，先在仓库设置中启用 Release Immutability。然后在 GitHub 的 `macos-release` 环境中配置两个变量和四个加密 secret：

| 类型 | 名称 | 值 |
|---|---|---|
| 变量 | `APPLE_TEAM_ID` | Apple Developer Team ID |
| 变量 | `MANTUR_CUT_DISTRIBUTION_APPROVAL` | 对精确源码、补丁、二进制、依赖、审计、源码交付及许可证固定项完成审核后填写 `approved:<source-config-sha256>` |
| Secret | `MACOS_CERTIFICATE` | 含 Developer ID Application 证书与私钥的 `.p12` 所对应的 Base64 内容 |
| Secret | `MACOS_CERTIFICATE_PASSWORD` | 导出 `.p12` 时使用的密码 |
| Secret | `APPLE_ID` | 用于 notarization 的 Apple ID |
| Secret | `APPLE_APP_SPECIFIC_PASSWORD` | 该 Apple ID 的 App 专用密码 |

工作流会把两份原生 `latest-mac.yml` 合并为一份可区分架构的更新通道，并把完整候选产物与 `SHA256SUMS` 保留七天。必须从精确匹配 `v<apps/desktop 版本>` 的 tag 运行；electron-updater 可以从 GitHub feed 中选择这种兼容 semver 的预发布 tag。`publish=false` 会在组装候选产物后停止。`publish=true` 还要求审批变量指向完整固定源码配置的 SHA-256 摘要，之后才会创建 GitHub release，并同时上传 DMG、更新 ZIP、blockmap、更新元数据与哈希。工作流会拒绝使用已有 release 的 tag，不会替换已发布文件；仓库级 Release Immutability 则会继续阻止之后修改 tag 或产物。

## 运行时设计

目录选择使用无参数的 `manturDirectoryPicker.pick()` preload 能力。Main 只接受当前本地主 frame，并将 Electron 单目录对话框的父窗口设为当前应用窗口。取消返回 `null`；失败直接报错，不调用 Host 选择器。对话框尚未结束时，重复请求会被拒绝，更新准备也会被阻止，直到原生调用结束。更新准备或退出期间，Main 拒绝新请求；主 frame 导航、窗口关闭或退出后，迟到的结果会失效。

主进程通过 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 作为 Node 可执行文件，并以 `--profile mantur --host 127.0.0.1 --port 0 --no-open` 启动已构建的 `@deepseek-ai/dsh` 入口。就绪解析器只接受带 token 的 `127.0.0.1` URL。renderer 禁用 Node integration、启用 context isolation 与 sandbox，并把离开本地 origin 的导航交给操作系统浏览器。

安装包携带既有运行时依赖闭包和已构建 Web 前端。Loader profile、插件 manifest、原生模块与 subprocess helper 都需要普通文件，因此 `asar` 保持禁用。关闭或重启应用时，Electron 会等待子进程终止后再退出。Electron 父进程通过 Node IPC 通道连接子进程；各功能模块负责校验自己的消息。

打包后的 Main 将 `resources/mantur-cut` 和自身可执行文件提供给漫途剪辑 profile。首次打开工作台才以 Electron 的 Node 模式启动编辑器，不创建第二个 Electron 窗口。安装包必须包含清单声明的生产服务、静态前端与目标平台渲染二进制；不完整的编辑器包会明确报错。开发模式不继承这一打包选择。会话可写目录和待完成的分发检查见[剪辑运行服务](../../packages/client/ui-mantur-editing/README.zh.md)。

Main 持有 browser-account-v2 授权及操作系统加密的 profile 存储。登录按钮打开所配置 issuer 的普通网站登录与同意页。Main 注册精确的 `127.0.0.1` 回调，校验 state 与 issuer，加密保存一次性 code，再使用 PKCE 和设备证明交换授权。只有确认的 grant 元数据才能启用登录及唤回窗口。renderer 不接收包含 state 的 URL 或凭据。

交换恢复在 attempt 到期前复用原始加密请求。进程重启后尚未收到 code 的 attempt 会取消，不注册新端口。退出登录立即阻止本地调用，并保留加密的取消或撤销资料，直到服务端 HTTP 204 或 grant 绝对期限结束；结果未知的交换保留九十天上界。浏览器账号存储使用版本 2，拒绝其他非空格式且不重写数据。

[内置 CLI 输入](cli-runtime/README.zh.md)由审核过的归档和独立 npm 锁文件组成。开发与打包都会准备 `mantur-cli` 资源。Main 创建 profile 本地启动器，将它置于受监督 Host 的 PATH 首位，并使用自身 Electron 可执行文件的 Node 模式。缺少资源时启动失败。命令使用 broker-v2 描述文件；只有 Main 向上游附加设备 bearer。运行时不会安装或寻找全局 CLI。

永久应用标识为 `ai.mantur.agent`。Electron 就绪前，载体会在操作系统的应用数据根目录下设置稳定的 `mantur-agent` 用户数据目录。其 `harness` 子目录是已安装应用使用的唯一 `DSH_HOME`，因此 `~/.dsh` 中的 CLI 或开发数据不会影响桌面启动。子进程从应用自有的中性目录启动，并把 stdout、stderr、恢复与 updater 诊断追加到同一用户数据根下的 `logs/harness.log`。

如果启动错误只识别到过期的 `session_projcache` schema，载体会先关闭失败的子进程并完成日志写入，再由本地化原生对话框在用户明确同意后删除这份可丢弃的投影缓存并重试。它不会删除会话日志、设置、凭据、profile 或 workspace。其他启动错误只提供查看日志与退出，不猜测修复方式。

已打包应用会在 macOS 的原生应用菜单和 Windows 的帮助菜单中显示当前版本与**检查更新…**。菜单会显示检查中、下载进度、可安装、已是最新版与失败状态；手动检查还会打开本地化的结果或错误对话框。应用启动后会开始检查，并每六小时重复。stable 构建只接收 stable release，版本号含 `alpha`、`beta` 或 `rc` 的构建可以接收预发布版本。后台发现新版本时保持安静。漫途侧栏在展开与收起状态下都在设置上方显示更新入口；空闲或已是最新版时不保留卡片。只有用户点击下载才开始传输，显示实际字节数，仅在已知时显示百分比。下载并校验完成后，准备重启前会请求确认。确认安装后，Main 保存原生草稿，通过所属 IPC 通道请求 Host 停机回执，再关闭账号通道并请求 Host 正常退出。Main 等待进程真正退出和诊断日志关闭后才调用安装器。不支持的 Host 组合、保存失败、取消、异常退出和超时都会阻止安装；检查和下载不会冻结工作。等待失败后 Host 清理可能继续，工作不会自动恢复。参见 [Host 更新策略](../../packages/bundle/mantur-app/README.zh.md#use-this-package)。选择稍后会保留重启安装入口，不重复弹窗。侧栏和原生菜单共用主进程确认；保存失败会保留已校验的下载并报告错误。关闭 updater 会抑制后续安装。

macOS Intel、macOS Apple Silicon 与 Windows 使用同一个更新控制器。macOS release 更新需要已签名并 notarize 的应用，以及生成的 ZIP 与更新元数据；DMG 仍是人工安装产物。Windows 对外更新需要代码签名身份、受保护的发布凭据与生成的 NSIS 更新产物；本仓库不提供或绕过这些前置条件。

## 草稿检查点

<a id="draft-checkpoints"></a>

沙箱化 preload 仅暴露具名的草稿读取、保存、重启准备及更新状态与操作消息。主进程只接受当前本地主 frame 的调用，并在 `userData/drafts` 下写入完整检查点，不依赖随机 loopback origin。检查点保留完整编辑器文档、Skill 引用标识，以及用户已经选择的图片原始字节和 SHA-256 摘要。一个 revision 覆盖所有草稿归属以及未关联草稿转入 Session 的两端。过期 revision、附件不完整、存储错误或 renderer 无响应都会阻止重启准备；取消会释放输入锁。

在 macOS 上，保存回执仅在检查点文件与父目录同步后返回。Windows 尚未实现原生持久发布路径，保存会明确失败；Node 未提供所需的目录 fsync 操作。恢复只读取应用检查点和当前 origin 中存在的旧文本草稿。发生冲突会明确报告，不扫描其他浏览器 origin，也不替换其数据。漫途 profile 在启用首次发送准备前将未关联输入框接入此检查点。

载体将 `app.getPath('documents')` 下的 `漫途项目` 子目录作为 `DSH_MANTUR_PROJECTS_ROOT` 传给 Host。该值只指定默认根目录，不提前创建目录。[项目所有者](../../packages/workspace/mantur-projects/README.zh.md)持久保存用户明确更改的位置，仅在首次发送时创建子目录。

## 已知限制

- 主应用依赖固定版本及其验证范围见[桌面依赖安全决策](../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-main-app-security.zh.md)。
- 将 Whisper 可执行文件打入安装包并启动，只能证明其原生文件及相邻动态库能在目标平台加载，不能让内嵌工作台直接具备本地转写能力。Mantur iframe 尚未安装 OpenChatCut 的桌面推理 preload，因此编辑器的原生 ASR adapter 当前会返回不可用。
- 构建出内部安装包不等于获得分发批准。OpenChatCut 的 AGPL 源码交付义务、Remotion 的实体与用途条款、FFmpeg 与 ffprobe 的 GPL/LGPL 义务、需保留的 notice、二进制再分发条款及全部生产依赖审计发现，都必须针对精确补丁 tree 完成审核后才能公开发布。
- 本地回调、加密存储、模拟 preload 和内置 CLI 测试不能证明真实网站授权。CLI 余额夹具使用受控本地响应。macOS 和 Windows 原生账号存储、浏览器返回、安装包资源、PostgreSQL 16 与经授权的测试站检查仍需分别验收；参见[浏览器授权决策](../../.agents/notes/implemented/architecture/2026-09-08-browser-account-authorization.zh.md)。
- `Desktop package` 产物仍是未签名的内部安装包。macOS Gatekeeper 与 Windows SmartScreen 可能对这些文件显示警告；对外分发 macOS 客户端时只能使用 `Desktop release` 产物。
- 原生图标源文件是带白色圆角底和透明外角的 1024 px PNG，Web 客户端单独使用透明 Logo。macOS 和 Windows 包会在原生构建时生成各自的平台图标格式；当前没有矢量源文件。
- 已签名的 release 工作流只发布 macOS。Windows 在具备代码签名身份与受保护的发布路径之前不支持外部更新。
- 每个目标只在其原生 runner 同时完成打包和 smoke 后有效。一个架构上的构建不能作为另一目标的证据。
