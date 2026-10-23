<p align="center">
  <img src="apps/web/public/mantur-logo.png" alt="ManTur Agent" width="128" />
</p>

# ManTur Agent

[English](README.md) | 中文

面向剧本创作、AI 漫剧制作和素材生产的桌面工作台。带上剧本与参考素材，用自然语言描述目标，与 Agent 一起完成方案整理、资产准备、生成和剪辑。

[下载](#run) · [安装使用指南](https://guiyi2023.feishu.cn/docx/Iq3id4fr8o2uo9xKfpEcIck9nRf) · [ManturHub](https://hub.mantur.ai) · [反馈问题](https://github.com/mantur-ai/mantur-agent/issues)

![ManTur Agent 首页与文件导入](docs/assets/mantur-agent/home.png)

## 可以用它做什么

| 你的任务 | 漫途如何协助 |
| --- | --- |
| 创作剧本 | 在项目对话中讨论题材、人物、分集结构与剧本修改。 |
| 筹备制作 | 导入剧本和参考素材文件夹，让 Agent 整理角色、场景、道具及分镜提示词。 |
| 生成创作素材 | 选择技能，通过关联的 ManturHub 算子调用任务所需的生成能力。 |
| 复用创作方法 | 在配方广场选择参考效果，将配方要求应用到自己的内容。 |
| 进入剪辑 | 打开内置剪辑工作台，继续处理制作素材。 |

实际结果取决于所选技能、模型、算子、权限及输入素材。交付前请审核剧本和生成素材；发起对话并不代表成片已经完成。

<details>
<summary>产品截图：技能广场与配方广场</summary>

![技能广场](docs/assets/mantur-agent/skills.png)

![配方广场](docs/assets/mantur-agent/recipes.png)

截图来自使用空白演示配置的实际桌面应用。广场内容与数量随服务更新而变化。

</details>

<a id="run"></a>

## 安装与开始使用

官方加速下载：

| 平台 | 安装包 | 可用版本 |
| --- | --- | --- |
| macOS Apple Silicon | [下载 DMG](https://mantur-pro.tos-accelerate.volces.com/mantur-agent/stable/Mantur-Agent-macOS-arm64.dmg) | 0.1.21 |
| Windows x64 | [下载 EXE](https://mantur-pro.tos-accelerate.volces.com/mantur-agent/stable/Mantur-Agent-Windows-x64.exe) | 0.1.20 |

版本核验于 2026 年 10 月 23 日。以上官方稳定下载地址按平台独立更新。[GitHub Releases](https://github.com/mantur-ai/mantur-agent/releases) 提供发布历史与校验和；GitHub 最新发布 [v0.1.21](https://github.com/mantur-ai/mantur-agent/releases/tag/v0.1.21) 仅包含 Apple Silicon Mac 安装包。此下载列表不提供 Intel Mac 或 Linux 安装包。

1. 从上表下载适合自己电脑的安装包，图文安装步骤及版本说明见[安装使用指南](https://guiyi2023.feishu.cn/docx/Iq3id4fr8o2uo9xKfpEcIck9nRf)。
2. **macOS Apple Silicon**：打开 DMG，将应用拖入“应用程序”。**Windows x64**：运行 EXE，按安装程序提示完成安装。
3. 打开 ManTur Agent，在设置中配置模型提供商并选择模型。请使用自己的提供商凭证；安装包不附带供所有用户共用的模型 API Key。
4. 创建对话，添加剧本或参考素材。选择已有项目，或在首次发送前检查保存位置；未选择已有项目时，应用会在首次发送时创建项目。检查 Agent 返回的结果。

Windows 安装包包含应用运行环境，解压进度并不是再次下载应用。所提供的 Windows 安装包尚无 Windows 签名证书，系统可能提示“未知发布者”；Mac 0.1.21 发布包已通过 Developer ID 签名及 Apple 公证检查。Windows 0.1.20 没有自动更新通道，请使用上方安装包手动更新。安装说明请查看指南。

## 导入剧本或整个文件夹

在桌面端，将文件或文件夹从访达或资源管理器拖入对话输入区，也可以点击**添加文件**或**添加文件夹**。支持导入 Markdown（`.md`）、Word（`.doc` / `.docx`）、图片、音频及其他普通文件，并保留嵌套目录和空文件夹。

应用会创建本地副本，并将路径加入草稿；发送消息后，再由 Agent 按要求读取。导入 Word 文档会保留原始文件，正文解析取决于 Agent 可用的文档工具。导入不等于自动同步到云端；调用云端模型或算子时，任务所需的内容可能发送至对应服务。

不支持符号链接，也不能导入包含应用自身附件存储目录的文件夹。导入失败会撤销该批副本，不修改原文件。纯浏览器部署仍使用图片导入方式，不具备桌面端的文件夹导入能力。

可以先发送这样一条需求：

> 请读取我添加的剧本和参考素材文件夹，整理分集、角色、场景和道具，列出缺失信息，再给出第一集的制作方案。等我确认后再生成素材。

## ManturHub 账号与模型设置

**漫途账号**用于关联 [hub.mantur.ai](https://hub.mantur.ai)。在设置的账号页面选择浏览器登录，在网站完成登录与设备授权，然后返回应用检查账号是否显示已登录。仅打开浏览器不代表授权完成。云端操作需要有效授权，并按平台展示的规则计费。

**模型设置**用于选择对话使用的语言模型并配置提供商凭证，与漫途账号登录相互独立。未登录漫途账号时也可以创建本地对话；调用云端能力仍需相应授权。

## 常见问题

| 问题 | 如何处理 |
| --- | --- |
| 为什么模型配置已经有内容？ | 应用会保留本地设置，重启或更新后仍可读取。看到已有配置不代表安装包内置了凭证。 |
| 为什么高级配置文件是空的？ | 首次创建时可以为空。日常配置请使用账号与模型页面，登录不需要编辑 YAML 文件。 |
| 登录报错怎么办？ | 保留错误原文和应用版本。接口缺失或响应不兼容需要发布方排查，修改本地模型密钥无法修复。 |
| 为什么只能添加图片？ | 检查是否使用带“添加文件／添加文件夹”的桌面安装版，而非纯浏览器部署。 |
| `latest-mac.yml` 和 `.blockmap` 是什么？ | 它们是更新元数据，不是安装包。安装请下载指南指定的 DMG 或 EXE。 |

反馈问题时，请附上应用版本、操作系统及芯片架构、复现步骤、错误原文或截图。发布到 [GitHub Issues](https://github.com/mantur-ai/mantur-agent/issues) 前，请去除凭证和私人剧本内容。

<a id="run-from-source"></a>

## 开发与贡献

仓库使用 Node.js（`^22.19.0 || >=24.0.0`）与 pnpm 11.7.0，桌面 CI 使用 Node.js 24。漫途产品通过 `mantur` 配置启动；上游 npm 包并非漫途桌面安装包。按下方开发指南准备源码和依赖后，使用以下命令构建漫途配置：

```sh
pnpm run build:mantur
```

原生打包、签名前置条件和安装包启动检查见[桌面开发指南](apps/desktop/README.zh.md)。修改代码前请阅读[开发指南](docs/development.zh.md)、[架构文档](docs/architecture.zh.md)、[贡献指南](CONTRIBUTING.zh.md)及[仓库规则](AGENTS.md)。漫剧功能应尽量通过插件、技能和配置扩展，并随修改提供针对性测试。

## 开源基础与许可证

ManTur Agent 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的漫途漫剧制作版本，沿用 DeepSeek AI 开发的上游框架及其 [Cordis](https://github.com/cordiverse/cordis) 插件架构。本仓库维护漫途产品适配。

仓库代码采用 [MIT 许可证](LICENSE)。第三方组件保留各自许可证，详见[第三方声明](THIRD_PARTY_NOTICES.md)及[桌面分发要求](apps/desktop/README.zh.md)。仓库许可证不替代内置剪辑、媒体组件或云服务自身的条款。从源码运行前请阅读[安全说明](SAFETY.zh.md)。
