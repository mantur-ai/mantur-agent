# Agent Note: 浏览器账号授权

Status: implemented

[English](2026-09-08-browser-account-authorization.md) | 中文

## Problem

桌面账号与内置 CLI 需要共用一个可撤销的设备身份。独立密码表单重复网站登录，共享网站 Cookie 或平台 Key 会暴露可复用的账号权限。丢失的响应和旧授权 attempt 不能恢复或撤销较新的登录。

## Decision

[Main](../../../../apps/desktop/src/auth/controller.ts)通过外部浏览器和精确的随机 IPv4 loopback 回调实现 browser-account-v2。交换一次性 code 前校验 state 与 issuer，并使用 PKCE。完整 create 请求及 exchange 身份在发出网络请求前由操作系统加密保存；code 在交换前加密保存。renderer 只接收公开状态和具名操作，不接收包含 state 的 URL、密码或秘密。只有确认的交换元数据才能启用登录并唤回窗口。

后台协议将设备 grant 固定到一个显式选定的默认 policy Key 和授权世代。只有明确的网站同意可以初始化缺失的默认 Key。默认 Key 失效时直接失败，不选择其他 Key。退出登录撤销设备 grant，不撤销共享 policy Key。Main 校验 issuer、环境、设备、世代和原始到期时间；后台仍须逐请求执行权限检查。

响应丢失后，在原始 attempt 截止时间前精确重试已加密的交换请求。重启时没有保存 code，则取消原 attempt；Main 不自动注册替代监听器或创建其他 grant。取消立即停用本地权限。结果未知的交换保留清理证明，直到 HTTP 204 或 attempt 到期时间加上协议最长九十天 grant 期限。旧成功回执被判定为已取代、撤销或到期时，不能启用本地请求。

[内置 CLI](../../../../apps/desktop/cli-runtime/README.zh.md)使用未经修改的固定归档和独立生产锁文件。Main 提供 profile 本地启动器，使用应用自身 Electron Node 运行时及桌面托管身份。broker-v2 将上游设备秘密保留在 Main，CLI 只得到每命令私有描述文件。资源或身份缺失时明确失败。这些改动使用桌面所有权和既有授权、命令插件，无需修改 agent-loop。

## Alternatives considered

**原生密码与注册表单。** 用户选定既有网站登录和设备同意作为唯一桌面登录路径。浏览器流程取代[原生账号提案](../../proposed/architecture/2026-09-07-desktop-native-account-identity.zh.md)中的对应 v1 章节；其 broker 所有权和原生平台验收要求仍有效。

**复制 Key 或复用全局 CLI 登录。** 分离的凭据不能保证本地账号切换与退出立即生效。内置 CLI 通过 broker-v2 使用同一 Main grant。

**使用新请求重试或推断其他默认 Key。** 响应丢失时授权可能已经提交。精确的有限重放和显式 policy 选择保留身份与撤销语义。

## Consequences

账号存储版本 2 拒绝其他非空版本，不自动迁移。没有兼容模式打开旧原生表单或发送 v1 凭据。生产默认仍为 `https://hub.mantur.ai`；测试配置显式选择 `https://hub.mantur.cn`，不跨 origin 重试。

本地 HTTP、SQLite、回调、Loader 和 CLI 测试使用受控数据。Electron Node 模式的 CLI 余额验证使用本地夹具响应，不是真实账号或 Java 服务。模拟 preload 浏览器快照只证明呈现与草稿保留。同版本 Java/PostgreSQL 16 联调、真实网站同意、原生 Keychain/DPAPI 与 Windows ACL 执行、打包资源及各平台浏览器返回仍待验收。本地结果不构成远端部署或真实 Key 创建授权。
