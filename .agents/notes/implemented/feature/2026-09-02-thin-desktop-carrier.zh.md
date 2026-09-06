# Agent Note: 轻量桌面载体

Status: implemented

[English](2026-09-02-thin-desktop-carrier.md) | 中文

## Problem

不使用终端的 Harness 用户需要普通桌面安装包，但第二套桌面专用 agent 组装会重复 Web 应用、插件组合、持久化、安全策略与发布行为。跨平台安装包还需要原生证据，因为 Electron、原生模块、DMG 创建与 NSIS 在各操作系统和架构上的行为不同。

## Decision

`apps/desktop` 是现有 Web 应用外的轻量 Electron 载体。Electron 主进程使用 `--profile mantur`、随机 `127.0.0.1` 端口并关闭浏览器打开来启动已构建的 `@deepseek-ai/dsh` 入口。它只接受带 token 的 loopback 就绪 URL，并在启用 sandbox 与 context isolation、禁用 Node integration 的 renderer 中加载该 URL。原生进程负责窗口生命周期并终止子进程；DSH profile 负责所有 agent、工具、凭据、会话与 Web 行为。

Electron 还通过 `ELECTRON_RUN_AS_NODE=1` 提供子进程的 Node 运行时。这样每个安装包只含一套运行时，并保留所有受支持 Node 应用都通过具名 `dsh` profile 启动的规则。桌面依赖根包含既有 Python 部署闭包、Web 应用闭包与必需的 session-title peer；electron-builder 会为目标 Electron 运行时重建原生依赖。

client 构建 profile `mantur` 会把 `DSH_CLIENT_TITLE` 固定为 `漫途Agent`，并同时写入仓库版本与 commit 元数据。Mantur 应用 profile 提供应用内身份。原生窗口、macOS Dock、关于面板和两个原生打包目标都使用带白色圆角底和透明外角的蓝色无限环图标；Web 客户端保留透明 Logo。载体声明稳定应用标识 `ai.mantur.agent`，并在 Electron 就绪前把其用户数据路径设为操作系统应用数据根目录下的 `mantur-agent` 目录。子进程只接收该目录的 `harness` 子目录作为 `DSH_HOME`，并从应用自有的中性目录启动；`~/.dsh` 下的 CLI 状态不会进入桌面启动。

同一用户数据根目录还持有 Harness 与桌面诊断的持久合并日志。启动失败会先关闭子进程并完成日志写入。只有错误指向 schema 无效的 `session_projcache` 时，才会提供一项窄范围恢复：在用户通过原生对话框明确同意后，载体只删除该投影缓存并重试。会话日志、设置、凭据、profile 与 workspace 保持不变。其他错误只提供日志与退出。

已安装构建通过 electron-updater 检查 `mantur-ai/mantur-harness` GitHub Releases。stable 构建只接收 stable release；版本号含 `alpha`、`beta` 或 `rc` 的构建可以接收预发布版本。检查会在启动后开始，并每六小时重复。macOS 的原生应用菜单和 Windows 的帮助菜单会显示当前版本、手动检查操作、检查与下载进度、失败状态和可安装操作。手动检查得到无更新或错误结果时，还会显示本地化原生对话框。两个改变状态的步骤都需要分别同意：载体会先在下载前询问，再在停止 Harness 并重启进入安装器前第二次询问。下载后选择稍后仍可从菜单触发安装。释放 updater 会移除监听器，并阻止尚未完成的对话框结果触发下载或安装。后台检查与失败都会写入桌面日志。

根目录的 `desktop:dev` 命令负责本地编辑循环，不会调用 electron-builder。监听器会重新运行桌面端 TypeScript 增量项目、bundle Electron 入口，并直接启动 Electron。源码或资源改动会终止活动 Electron 进程；Electron 先等待其 dsh 子进程关闭，再开始下一轮。开发 dsh 输出会同步显示在终端，同时保留在持久日志中。开发模式选用 `mantur-agent-dev` 用户数据目录，不会触及已安装应用的 `mantur-agent` 状态；`app.isPackaged` 会保持 updater 不活动。

## Packaging and verification

原生矩阵会从同一个检出 commit 运行 macOS arm64、macOS x64 与 Windows x64。每个 runner 都会执行完整漫途构建，对启动语法和品牌构建环境运行单元测试，只创建自己的原生安装包，再从解包应用的依赖目录启动 DSH。smoke 会执行进程 token 交换、请求已认证页面，并要求 HTTP 200、Web boot payload、`漫途Agent` 文档标题、包内 updater 依赖与预期的 release feed 配置同时存在。

内部打包工作流会生成未签名的 DMG、macOS 更新 ZIP 与一键 NSIS 安装包。私有 desktop workspace 仍不属于 npm release family；该工作流只把文件作为私有 Actions artifact 保留，不创建 tag 或 GitHub release。只有某个目标的原生打包和 packaged smoke 都通过后，才可认为该目标完成验证。

桌面端 release 工作流为原生 macOS 与 Windows 签名使用不同的受保护 GitHub 环境。macOS 任务会验证 Developer ID 签名、Gatekeeper 评估、stapled ticket 与 packaged smoke，再合并两份架构专属通道文件。Windows 任务使用已配置的 PFX 签名解包应用与 NSIS 安装器，要求两份签名都具有预期证书指纹与时间戳，并运行 packaged smoke。只有从精确 `v<version>` tag 发起的显式发布任务才会创建一份 GitHub release，其中包含三个原生安装包、更新 archive、blockmap、平台元数据与 SHA-256 哈希。electron-updater 可以从 GitHub feed 中选择这种兼容 semver 的 alpha、beta 与 RC release。工作流会拒绝已存在的 release；发布前还必须启用仓库级 Release Immutability，以阻止之后修改 tag 和产物。

## Alternatives considered

**内嵌 Harness Host，并用 Electron IPC 替代 HTTP。** 否决。这样会创建桌面专用应用组装与 transport，重复既有 Web 认证和生命周期行为，并在一键安装证明需求之前造成更大的上游差异。

**只在系统浏览器中打开现有 Web profile。** 否决。这样不能提供用户期望的已安装应用、单实例窗口与应用生命周期。

**在 Electron 旁附带一套独立 Node 可执行文件。** 否决。Electron 已提供兼容的 Node mode，electron-builder 也会为它重建原生模块。第二套运行时会增大安装包，并增加另一套需要维护的版本与许可证载荷。

**在一台 host 上交叉构建全部目标。** 否决。产生 archive 不能证明目标专属原生模块能够加载，也不能证明打包应用能够启动。原生 runner smoke 才是验收证据。

**为每次开发改动构建原生安装包。** 否决。DMG、ZIP、NSIS、签名、notarization 与更新元数据不会为普通 Electron 入口改动提供证据。这些操作仍属于发布路径检查，开发命令则直接验证同一套未打包主进程和 dsh Web 启动。

**通过 Web 应用暴露桌面 updater 状态。** 否决。renderer 有意不提供 Electron preload bridge、Node integration 或桌面专用 HTTP API。原生菜单可以呈现应用生命周期功能，而无需给 Harness profile 或 Web client 增加桌面 transport。

## Consequences

- 桌面用户可以获得普通安装包，而 Web profile 仍是唯一的交互式 Harness 应用实现。
- loopback 子进程增加了一条本地 HTTP 生命周期，并通过本地化原生对话框显式呈现启动失败。
- 已安装桌面状态与 CLI 状态隔离；schema 无效的会话投影缓存可执行一次由用户同意的可丢弃重置，而不是无期阻止应用启动。
- 更新检查会自动运行，也可由用户手动触发，但下载与重启安装仍由用户决定。stable 用户不会收到预发布版本。外部更新需要对应平台的受保护签名环境；缺少 macOS 或 Windows 身份时，release 工作流会失败。
- 桌面端改动通过一条受监听的开发命令运行，不生成安装包；开发数据与已安装数据保持分离。
- 完整运行时依赖闭包与解包文件使安装包大于专用客户端；这项成本避免了第二套应用运行时，并让 Loader 与原生模块路径保持为普通文件路径。
- 签名、notarization 与预期签名者身份仍是受保护的部署输入。内部打包工作流无法访问这些凭据，也不能发布 release。
