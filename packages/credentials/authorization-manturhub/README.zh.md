---
description: "漫途桌面 profile 使用的 ManturHub 设备授权提供方与浏览器安全账号 Remote。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-authorization-manturhub`

[English](README.md) | 中文

## 概述

这个 Host 包把 ManturHub 请求路由到已选的线上或测试部署。`standalone` 身份拥有逐 origin 的凭据记录与设备码 flow；`desktop-managed` 身份委托 Electron Main，绝不读取这些记录。生成的 Remote 暴露身份模式与脱敏账号状态，不返回 API Key 或环境配置。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发记录](#dev-note)

-----

<a id="configuration"></a>

## 配置

`environment` 默认为 `production`。`baseUrl` 默认为 `https://hub.mantur.ai`，用于命名线上 origin；`testBaseUrl` 用于命名可选测试 origin，选择 `test` 前必须先配置。两个值都必须是不含凭据、路径、查询或片段的 HTTP(S) origin，且测试 origin 必须与线上不同。维护者通过本机 `cordis.patch.yml` 的 `mantur-account` 条目选择环境；账号浏览器 Remote 无法读取或更改环境。变更后重启桌面应用会清空内存中的账号与广场状态。

`identity` 默认为 `standalone`。此模式下，公共线上 origin 保留原凭据 key，其他 origin 使用由环境与 origin 共同区分的 key。更换测试 URL 后会从未登录状态开始。授权保留在凭据提供方中，不写入 patch 文件。

`desktop-managed` 要求 Electron 父进程 IPC 通道，以及显式的 `native` 配置：`environmentLabel`、`requestTimeoutMs`、`maxResponseBytes`、`leaseMs` 与 `revocationRetryMs`。漫途桌面 profile 提供这些预算。provider 可用前，Main 会校验所选 origin。需要认证的 GET 会持有 broker scope，直到响应 EOF 或取消。命令环境租约只有在命令 consumer 确认整棵进程树清理后才能释放。连接销毁会中止 scope，并等待这些回执。Main 缺失或托管身份无效时明确失败，不查询独立凭据存储。原生账号操作属于受保护的 preload bridge，旧设备登录 Remote 会拒绝这些操作。

原生 provider 注册到 [command-scopes](../../shell/command-scopes/README.zh.md)。Bash、PowerShell 和持久终端在分配进程前准备身份，仅在完整进程树清理后确认释放。未登录命令收到显式桌面托管模式和空描述文件路径，覆盖调用方的陈旧环境值。

`stopNativeForShutdown()` 是连接 effect 使用的显式原生提供者清理操作。它撤销命令身份、停止命令注册并关闭 broker API 的接纳，同时等待实际命令/PTY 清理、API 响应体取消和 lease 回执。Main 必须保持 IPC 连通直到完成。重复调用返回同一结果，包括清理失败；standalone 或未初始化的提供者会拒绝该操作。它不证明独立授权、调用方拥有的未认证请求、会话持久性或整个 Host 已停止。

独立设备登录会拒绝来自其他 origin 的验证地址。会话缺少 `interval` 或 `expires_in` 时使用 5 秒与 600 秒。`slow_down` 会给当前轮询间隔增加 5 秒；拒绝与过期会在不写入凭据的情况下结束本次尝试。

<a id="model-experience"></a>
## 模型体验

### 账号授权

#### 模型看到什么

`manturAccount` 授权状态保留在所有模型请求之外；账号信息、设备码与凭据都不会进入模型请求。

#### Token 影响

授权 flow 不会向模型请求贡献 token。

#### KV Cache 影响

授权不会改变模型请求前缀或缓存复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 独立登录尝试只存在于当前进程中，独立退出登录仅删除本机授权。
- 桌面浏览器授权报告账号显示名；独立账号状态保留邮箱字段。macOS 和 Windows 原生操作系统存储、网站同意和真实账号验收仍待完成。参见[浏览器授权决策](../../../.agents/notes/implemented/architecture/2026-09-08-browser-account-authorization.zh.md)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文—点击展开</summary>

设备接口与账号接口从同一个配置 origin 解析。本包拥有的有界 JSON 读取函数与 ManturHub Host consumer 共享，使响应缓冲只保留一套实现。测试会指定本机假服务。

</details>

未发布运行时不变式 companion，因为授权服务既提交凭据又报告成功，不存在会独立变化的观测结果。
