# Agent Note: 安装版更新模块审核

Status: implemented

[English](2026-09-16-packaged-update-module-review.md) | 中文

## Problem

桌面端重启更新路径在保存前拒绝内置漫途组合，因为已审核模块集合遗漏了 Host runner、剧本、资产、剪辑和原生选择器 UI 模块。发现更新与签名验证不会执行这条路径。

## Decision

更新策略包含这五个内置模块。剧本和资产变更仍由 Gateway 请求与 AgentLoop 工具执行持有。剪辑保留现有有序关闭所有者。原生选择器 UI 没有 Host 工作，原生对话框保留现有取消所有者。未使用的 worker runtime 与 Host runner 关闭准入并排空受管调用；根级执行历史仍拒绝任何曾启动的 worker 或曾激活的动态程序。

这修订了[程序历史决策](../architecture/2026-09-07-update-program-history.zh.md)与[剪辑关闭决策](../architecture/2026-09-08-editing-before-host-shutdown.zh.md)中的模块级排除；历史检查、未管理执行拒绝和关闭失败保留规则不变。修改属于漫途 bundle，不改动上游循环。

## Alternatives considered

移除模块验证会放行未经审核的插件。从 profile 移除 runner 会禁用已有功能。两者均不采用。

## Consequences

macOS 与 Windows 安装版组合检查会发现未审核的启用模块。Loader 关闭回归验证未使用 runner 的准入关闭；现有回归保留执行后及剪辑失败时的拒绝。包含旧策略的已发布客户端需要手动安装一次签名安装包，因为替换前运行的是旧客户端自己的关闭检查；更改下载包不能修复该旧检查。
