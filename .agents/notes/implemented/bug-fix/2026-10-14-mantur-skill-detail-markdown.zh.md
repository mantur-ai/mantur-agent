# Agent Note: 将漫途技能详情渲染为 Markdown

Status: implemented

[English](2026-10-14-mantur-skill-detail-markdown.md) | 中文

## Problem

广场说明包含 HTML 实体转义的 Markdown，以及面向 Agent 自动注入的平台接入段落。普通段落会暴露内部标记，并在狭窄弹窗内把标题和代码显示成纯文本。

## Decision

漫途导航插件解码 HTML 实体，仅从展示内容中移除成对的 `MANTUR_AGENT_PLATFORM_ACCESS_START` / `END` 段落，再使用共享的不可信 Markdown 渲染组件。弹窗采用响应式 800 像素宽度和单一内容滚动区域。已安装技能的执行说明保持不变。

## Alternatives considered

**修改下载的执行说明：** 不采用，因为广场隐藏实现细节不应移除执行时需要的指令。

**渲染原始 HTML：** 不采用，因为目录内容不可信，共享 Markdown 渲染器已经负责安全的文本展示。

## Consequences

组件检查覆盖实体解码、标题、加粗、代码、内部段落移除以及不存在可执行脚本元素。真实广场页面快照覆盖正文展示和弹窗宽度。Windows 原生视觉验收仍待完成。
