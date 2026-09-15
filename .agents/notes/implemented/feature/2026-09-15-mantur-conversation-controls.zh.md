# Agent Note: 漫途对话控件

Status: implemented

[English](2026-09-15-mantur-conversation-controls.md) | 中文

## Problem

漫途对话页显示了用户在漫剧生产中不需要的诊断标签、日志下载和汇总运行统计。推荐技能和侧栏积分的左边缘也与相邻控件不一致。

## Decision

[漫途 bundle](../../../../packages/bundle/mantur-app/README.zh.md)禁用 `ui-trajectory` 和 `session-log-download`；仅注册对话视图时，共享页头不显示标签栏。[导航插件](../../../../packages/client/ui-mantur-navigation/README.zh.md)以优先级 -1 的空组件覆盖输入框 dock 中的 `stats` 条目。卸载时恢复共享条目，会话持久化和其他 dock 条目保持可用。

技能按钮使用输入框侧边留白。展开侧栏的积分图标和数字分别与设置图标和文字对齐，收起状态保留紧凑布局。

## Alternatives considered

修改共享对话或聊天实现会影响其他 profile；隐藏生成的 CSS 类名会依赖具体构建产物。既有 profile 和 slot 覆盖机制足以表达这些漫途界面需求。

## Consequences

漫途页头和输入框不提供这些诊断入口，包括浏览器 `/export` 命令。持久化消息和后台统计仍启用，普通 Web profile 保留既有控件。记录轮次的浏览器检查覆盖刷新前后的对话，几何检查覆盖积分和技能按钮的对齐。
