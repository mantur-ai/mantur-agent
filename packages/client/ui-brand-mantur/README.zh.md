---
description: "漫途Agent 在侧边栏与空会话首页中的 Logo 和产品文案占位者，供组装漫途桌面客户端的维护者使用。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-brand-mantur`

[English](README.md) | 中文

## 概述

本包在通用侧边栏和空会话首页显示已确认的蓝色无限环 Logo、本地化的 `漫途Agent` 产品名称与漫途产品承诺。收起的侧边栏显示同一 Logo，悬停时再显示普通面板按钮；空的 hero badge 占位者则使漫途组装不显示 Web 预览版徽标。它不改变布局、对话、模型、权限或 Agent 能力。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发记录](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

只通过 [`dsh-mantur-app`](../../bundle/mantur-app/README.zh.md) 组装本条目。浏览器端在所有者声明后注册 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`、`conversation.hero.headline` 与 `conversation.hero.badge`。中英文 locale 都在侧边栏显示已确认的产品名称 `漫途Agent`，首页则在“故事起于一念，余下交给漫途”或其英文等价文案前显示已确认的 Logo。漫途 Web 应用必须在构建页面旁提供 `mantur-logo.png`。

浅色外观使用已确认的“朱蓝分镜册”配色：暖纸底色、钴蓝操作和加深的状态文字。应用在构建页面旁提供 `mantur-storyboard-background.svg`；装饰标记只显示在外框边缘，窗口小于 900 px 时隐藏。图片预览使用中性底色，视频留边保持深色。深色外观与挂载在 body 的引导页保留各自配色。插件卸载时移除样式表和 body 标记；[主题决策](../../../.agents/notes/implemented/feature/2026-09-06-mantur-storyboard-theme.zh.md)记录对比度与作用范围约束。

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现，漫途的模型身份归 profile bundle 所有。

#### KV Cache 影响

无；本包中的文本不会进入 provider 请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **已确认的源文件为位图**—在漫途批准矢量源文件前，Web 与原生打包使用字节完全相同的 1024 px PNG 文件。
- **完整产品名仍然可见**—Logo 会补充展开侧边栏中的 `漫途Agent`，不会取代本地化名称。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文—点击展开</summary>

展开行、收起轨道与首页使用同一图片 URL。侧边栏 shell 负责在收起状态悬停时，把 Logo 切换为面板导航指示。

</details>

**运行时不变式：**不发布 companion。一个浏览器 effect 会成组安装和移除全部五个 slot 占位者。
