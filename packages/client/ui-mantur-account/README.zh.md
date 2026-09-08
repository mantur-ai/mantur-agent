---
description: "漫途桌面客户端组装使用的漫途账号首次启动与设置界面。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-mantur-account`

[English](README.md) | 中文

## 概述

这个浏览器包提供漫途账号引导和设置页。Host 显式指定的身份模式选择桌面浏览器授权或独立设备登录。桌面入口打开系统浏览器，由漫途网站完成普通登录和设备同意。账号登录及“暂时跳过”独立于模型凭据。

原生 preload 发布带版本号的账号显示名、到期时间和待清理状态，绝不发布凭据、包含 state 的 URL 或授权码。一个订阅服务引导、设置页及按需弹窗。Main 持有回调、到期和精确交换恢复，跨 renderer 刷新保留。旧版本及已被取代的操作回包不能替换当前账号。原生能力缺失时明确报错，不选择独立凭据。

按需弹窗使用 `shell.overlay`。“返回创作”和 Escape 关闭界面，不取消 Main 已接受的操作；成功的“暂时跳过”持久保存选择并取消授权。重复打开共享同一结果。其他活跃弹窗、进行中的操作或所有者缺失时明确失败。卸载拒绝未完成请求并释放观察者；迟到结果不能重新打开已关闭弹窗。

登录页提供一个浏览器登录按钮和产品 Logo。等待、取消、交换重试、到期、独立设备退出和账号切换使用 Main 确认的状态。打开浏览器不会报告已登录。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发记录](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

### 账号界面

#### 模型看到什么

`settings.onboarding` 账号界面只属于浏览器呈现；其文案与状态不会进入模型请求。

#### Token 影响

账号界面不会向模型请求贡献 token。

#### KV Cache 影响

账号界面不会改变模型请求前缀或缓存复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 原生“暂时跳过”等待 Main 确认持久保存，并跨 renderer 刷新保留。独立模式的“暂时跳过”只对当前空会话引导序列生效。
- 模拟 preload 浏览器测试不能证明原生操作系统存储、真实网站同意或账号授权。macOS 和 Windows 原生验收仍需分别完成。
- 维护者更改 Host 环境配置时，已经安装到本机实时目录的 Skill 仍可使用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文—点击展开</summary>

原生引导、设置页和广场弹窗共用一个 Main 账号所有者。离线验证不会清除本地活跃且未到期的 grant；权威撤销会阻止使用。[浏览器授权决策](../../../.agents/notes/implemented/architecture/2026-09-08-browser-account-authorization.zh.md)记录恢复与验证要求。

</details>

**运行时不变式：**账号引导 slot 的顺序为 `-100`，排在现有顺序为 `0` 的 DeepSeek 步骤之前。不发布运行时不变式 companion。这个浏览器包不持有持久事件流或跨插件可变状态；本包测试会直接观察注册顺序与 effect 清理。
