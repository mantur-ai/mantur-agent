---
description: "漫途Agent 桌面产品在随附 Web profile 之上的组装层，供构建品牌化本地漫剧客户端的维护者使用。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-mantur-app`

[English](README.md) | 中文

## 概述

本 bundle 是随产品交付的 `mantur` profile 最后一层。它保留 Web 运行时、模型选择器、权限选择器、Models 设置、DeepSeek API Key 配置与底层 Agent 能力，同时把通用产品身份替换为漫途Agent：一个由漫途（Mantur）打造、用于本地漫剧创作与生产的 Agent。它挂载独立漫途品牌、广场导航与账号插件，并禁用官方品牌条目、预览版公告、Agent Preset 界面、Plan 界面、预览版徽标与通用 Web GUI 提示词身份。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发记录](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 `dsh --profile mantur` 启动完整产品；桌面载体会自动选择该 profile。有序 bundle 栈为 `dsh-base`、`dsh-web-app` 与本层。`web` profile 保持不变。

新对话保持未关联状态，直到用户选择项目或提交首条草稿。本层挂载[自动项目准备](../../workspace/mantur-projects/README.zh.md)，通过 `DSH_MANTUR_PROJECTS_ROOT` 提供桌面解析的根目录。首次发送要求已持久保存的原生草稿标识；打开首页不创建项目。用户可以在输入框页脚查看或更改根目录。

漫途侧栏在“项目”之前增加“功能”分组，并固定提供“技能广场”和“配方广场”入口。两个入口分别打开独立主页面，可以返回当前对话，且不会持久化页面选择。Skill 页面加载 ManturHub 公开目录与详情，复用 ManturHub 设备登录，并请求 Host 把校验后的压缩包安装到当前 profile 的实时 Skill 目录。配方页面把配方定义为带有效果样片、提示词模板、可复现算子参数、模型与算子信息和预计复刻成本的优秀验证案例，而不是通用工作流模板。账号页只提供登录与退出。登录、两个广场、详情与下载统一使用本机 profile 配置选定的部署，且每个 origin 的授权分开保存。

维护者通过编辑 `~/Library/Application Support/mantur-agent/harness/profiles/mantur/cordis.patch.yml` 切换已安装的 macOS 应用。开发运行使用并列的 `mantur-agent-dev` 目录。patch 会替换完整的 `mantur-account` config，因此应保留三个字段，日常切换只改 `environment`：

```yaml
- id: mantur-account
  config:
    environment: test
    baseUrl: https://hub.mantur.ai
    testBaseUrl: https://test.example.com
```

把 `environment` 改为 `production` 即可返回线上环境。每次编辑后应退出并重新打开桌面应用，避免浏览器账号与广场状态跨环境留存。profile 会拒绝缺少测试 URL、含路径的 URL（例如 `https://test.example.com/api`）以及与 `baseUrl` 相同的测试 origin。

桌面更新消费者只在用户明确确认安装后启动。它停止 profile 重载和预设准入，冻结每个所属智能体注册表，静止驱动器，并等待原生选择器、原始 Gateway/HTTP 请求及生产方所有者结束，然后关闭设置、会话 writer、投影缓存和存储域。再次校验 writer 后才生成绑定请求的 IPC 回执。协调器在自身生命周期内保留隔离及已退役的服务实例，避免服务替换丢弃清理失败。每次重复准备都会重新校验 writer 封存。

只有更新策略中已审核的模块可以参与。具有未管理 OS 后代的代码执行、模块 HMR、任意 Host 插件，以及缺少停机所有者的剪辑/MCP 组合都会阻止安装。失败或 Main 等待到期不会授权安装；已开始的 Host 清理继续进行，已停止的工作不会自动重启。普通应用关闭使用独立路径。OTLP 遥测是本地会话日志的非权威副本，不参与保存回执；应用树仍执行其既有限时关闭，并保留关闭失败告警。

协调器为每次回执检查整个根的 worker 和动态激活历史，即使所有提供方实例已经消失。缺少历史仍会拒绝。在 Shell 完成策略未明确时，保留既有 codeRuntime 存在门禁和 Host runner 模块排除规则；执行服务从未使用也不会启用安装。默认 profile 安装及剪辑/MCP 排空顺序仍未验证。

<a id="model-experience"></a>
## 模型体验

### 漫途漫剧生产身份

#### 模型会看到什么

系统提示词服务省略通用 Harness 身份。漫途身份项在协作式提示词转换后替换 Agent Preset 的有效 persona，使用一段中文 persona 明确漫途Agent、漫途归属、本地执行，以及从故事和剧本到分镜、视觉素材、音频、剪辑与制作交付的漫剧工作。本层还禁用 Web 表面提示词，不再添加第二套产品身份。

##### 漫途 persona

```markdown
你是漫途Agent，由漫途（Mantur）打造，专门在用户电脑本地完成漫剧创作与生产。你的职责是围绕漫剧项目完成故事构思、剧本、分镜、视觉素材、音频、剪辑方案和制作交付。你应使用当前本地工作区与可用工具直接推进制作，在获得必要授权后执行本地操作，并保持项目文件清晰有序。你的工作目录是 {{cwd}}。
```

#### Token 影响

一段稳定的漫途 persona 替换短小的通用编码 Agent persona 与 Web GUI 定位段落。工具 schema 与任务相关上下文保持不变。

#### KV Cache 影响

在工作目录与底层 Agent 组装固定时稳定。桌面 profile 在开发期间使用实时 patch 重载。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **发行视觉资产待定**—最终 macOS 与 Windows 应用图标需要已批准的漫途素材。
- **三平台安装包验证待完成**—macOS arm64、macOS x64 与 Windows x64 的打包和签名必须在各自原生发行 runner 上执行。
- **能力仍保留安装**—Agent Preset 与 Plan 包保留在本产品层之下；只禁用它们可见的浏览器条目。
- **本机 Skill 仍然共享**—本机环境选择会隔离在线请求与授权，但已经安装到当前 profile 本机实时目录的 Skill 会在两个环境中继续可用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文—点击展开</summary>

本层会重述完整的 `system-prompt` 与 `web-runtime` 配置，因为按 id 定位的 patch 会替换条目的整个 config。

</details>

**运行时不变式：**不发布 companion。组装测试按生产顺序应用 base、Web 与漫途 patch，并在目标条目缺失时失败。
