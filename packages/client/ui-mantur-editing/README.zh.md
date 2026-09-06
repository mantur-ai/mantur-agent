---
description: "在漫途对话旁打开本地剪辑工作台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mantur-editing

[English](README.md) | 中文

## 概述

在首页选择剪辑，即可在漫途对话旁打开本地编辑器。素材池、预览、时间线和工程保存由编辑器管理。这个可选展示插件需要已运行的本地编辑器和显式地址。

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

漫途 bundle 包含默认禁用的配置行。在 profile 补丁中启用 `ui-mantur-editing` 并提供 `config.editorUrl`。地址必须使用回环 HTTP，不能包含凭据或查询参数，可以包含工程 hash。选择剪辑会在模式偏好保存后打开工作台。选择其他模式或收起工作台会释放内嵌页面；再次选择剪辑可重新打开。

工作台标题栏、按钮与对话分隔线使用漫途的 0.5px 中性边框。

嵌入的剪辑器跟随漫途解析后的明暗主题，包括系统偏好变化，切换时不重新加载页面。OpenChatCut 部署必须在应用渲染前加载[主题适配器](adapters/openchatcut-theme.mjs)，并以明确可信的漫途回环源地址调用 `installManturTheme(window, parentOrigin)`。在剪辑器入口导入该模块，或通过服务器注入等效的模块脚本；部署资源中必须包含适配器。独立打开的剪辑器继续使用自己的皮肤偏好。适配器只修改界面颜色变量，保留媒体颜色和工程状态，不写入独立皮肤偏好。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `editorUrl` | 必填 | 本地编辑器绝对地址，可包含工程 hash |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host 设置发布编辑器地址。Client 注册 `main.workbench` 内容并监听用户明确选择漫途模式的事件。布局保持对话挂载在编辑器旁，不向 harness 复制编辑器状态。卸载插件会移除监听并关闭工作台。本包仅管理展示和配置，没有需要比较的独立运行时观察值，因此不发布 invariant companion。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [布局](../ui-layout/README.zh.md) — 对话与工作台的组合。
- [漫途导航](../ui-mantur-navigation/README.zh.md) — 创作模式选择。
- [MCP 客户端](../../mcp/mcp-client/README.zh.md) — 单独配置的剪辑工具。

-----

<a id="model-experience"></a>
## 模型体验

无，因为打开工作台不会增加模型上下文、工具或请求。单独配置的 MCP 客户端负责工具发现和执行。

#### KV Cache 影响

工作台查看状态不产生模型供应商 token。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 本插件不启动、打包或认证编辑器服务。部署方必须提供该进程并单独配置 MCP；传输凭据不能放入 `editorUrl`。
- 收起或重新加载会重建编辑器页面。工程保存和未保存修改的处理由编辑器负责。页面刷新会重置工作台显示状态。
- 内嵌上游编辑器保留自己的提案审核控件。多工程 Agent 绑定和原生 Windows 打包仍需单独验证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
