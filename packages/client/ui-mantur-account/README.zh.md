---
description: "漫途桌面客户端组装使用的漫途账号首次启动与设置界面。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-mantur-account`

[English](README.md) | 中文

## 概述

这个浏览器包添加漫途的首个引导步骤和“漫途账号”设置页。Host 显式指定的身份模式选择原生桌面表单或独立设备登录流程。桌面用户可以使用密码登录、通过邮箱验证码提交待激活注册，或在系统浏览器中继续 Google 授权。账号登录和“暂时跳过”独立于既有模型凭据步骤；账号登录不会配置模型或授予模型额度。

原生 preload 发布带版本号的公开账号元数据，绝不发布设备 bearer。密码和注册验证码只作为临时表单输入及具名 IPC 参数存在，不进入可观察 store。原生能力缺失或身份模式查询失败时明确报错，不切换到独立凭据。同一个客户端订阅服务引导和设置页，拒绝陈旧回包，并每两秒轮询等待中的浏览器授权。重新打开使用已保存的 attempt；密码、注册和验证码请求绝不自动重试。

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
- 原生表单和模拟 preload 浏览器测试不能证明 Electron、操作系统存储或真实站点已验收。广场登录入口与打包 CLI 仍需原生接入验收。
- 维护者更改 Host 环境配置时，已经安装到本机实时目录的 Skill 仍可使用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文—点击展开</summary>

原生引导与设置页共享 Main 确认的到期、注册、关联验证和待撤销状态。注册提交不代表已登录，离线不代表过期。独立模式继续使用 Remote 控制器。内嵌 Google 标志保留官方 PNG 原始字节，不属于仓库软件许可范围；来源记录在 `google-logo.ts`。

</details>

**运行时不变式：**账号引导 slot 的顺序为 `-100`，排在现有顺序为 `0` 的 DeepSeek 步骤之前。不发布运行时不变式 companion。这个浏览器包不持有持久事件流或跨插件可变状态；本包测试会直接观察注册顺序与 effect 清理。
