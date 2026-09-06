# Agent Note: 桌面原生账号身份

Status: proposed

[English](2026-09-07-desktop-native-account-identity.md) | 中文

## 问题

桌面账号登录与随附 ManturHub CLI 需要共用一个设备身份，但不能把可复用的账号秘密复制到 renderer 状态、进程参数或 shell 环境。授权响应丢失与离线退出登录不能遗留无人持有的凭据，也不能在重启后悄悄恢复本地授权。

## 提案

Electron Main 将拥有 profile 内的安装身份，以及相互独立、由操作系统加密保存的 attempt 和设备秘密。native-account-v1 协议在联网前提交完整的 verifier-first 请求，结果未知时保留原请求。确认 ready 的元数据包含凭据原始到期时间，必须先保存再激活。设备凭据按绝对九十天到期，不刷新。

Main 将提供原生密码登录、公共待激活注册，以及同源的系统浏览器授权页面。跳过选择独立于模型密钥与草稿持久保存。沙箱化 renderer 只接收公开账号状态与受保护的具名操作。桌面托管 CLI 命令将收到私有、限时的 broker-v2 描述文件；真实设备 bearer 由 Main 附加到上游请求。托管身份缺失或无效时明确失败，不读取独立 CLI 凭据。

本地退出登录先禁用精确记录，并在远端清理前中止该记录已接受的请求。Main 等待响应读取和命令进程树清理结束，不只发出 abort。待取消或待撤销材料保留操作系统加密，直至精确远端请求返回 HTTP 204，或到达原始到期时间。激活结果未知的 ready attempt 按凭据有效期保留，不使用更短的 attempt 有效期。网络失败不能证明过期。

## 部分实现

桌面存储、HTTP 客户端、请求所有者与登录控制器实现了授权创建和精确凭据清理。[Main](../../../../apps/desktop/src/auth/host.ts)通过子进程 IPC 接收漫途 provider 配置，拥有撤销重试定时器，并暴露 frame 绑定的 preload 操作。[Host 连接](../../../../packages/credentials/authorization-manturhub/src/native.ts)持有流式响应直到 EOF 或取消。其销毁会中止命令 scope，但不能替命令 consumer 发出清理回执。Main 会保留每个私有 broker-v2 描述文件，直到该 consumer 释放。公开快照独立报告本地已激活且未过期的凭据，不把离线验证失败当成失效。

公开快照与命令准入以本地禁用状态优先于持久 active 元数据。退出写盘失败时，本地访问保持阻止并报告 `logout-storage`，不称退出已持久保存或远端已确认撤销。保留记录允许用户明确重试。

真实 loopback 与子进程 IPC 测试覆盖这些所有者。固定解包 CLI 的测试通过 broker 覆盖余额、流式读取、预签名上传和退出登录取消。原生表单、Bash、PowerShell、PTY consumer 与打包 CLI 调用仍未完成；这些测试不能代替真实组装入口或原生操作系统验收。

## 考虑过的替代方案

**通过 renderer 存储或 CLI 环境共享设备 bearer。** 这会把账号权限暴露到 Main 之外，也不能提供逐命令的取消或到期控制。

**七天后删除离线撤销材料。** 这会使仍处于九十天有效期内的凭据失去后续远端撤销能力。保留仅在确认撤销或原始截止时间到达时结束。

**重新创建 attempt 或重发密码来恢复。** 响应丢失不代表服务器拒绝了首次操作。恢复使用已提交的身份与明确的服务器状态，不创建新凭据，也不自动重试密码。

## 验收标准

真实 Main、preload、provider 和界面路径必须对冻结后端验证登录、跳过、注册、浏览器授权、重启恢复与退出登录部分失败。可追溯的随附 CLI 必须通过 broker-v2 联合测试，覆盖环境隔离、描述文件权限、进程树归属、到期、退出登录、完整流式取消与预签名上传。测试必须证明 renderer 消息、命令参数与诊断中没有设备 bearer 或密码。原生 Keychain 与 Windows DPAPI、ACL 验收必须在对应平台完成，替代加密器的测试不能证明这些能力。

## 风险

控制器依赖 Main 调用者等待完整响应读取与命令清理。失联的子进程无法证明孤立后代已停止，关闭必须报告缺少该证明。原生界面轮询、真实 shell 与 PTY 清理、打包和操作系统接入仍是必要条件；内部测试不足以证明客户端已可用。

既有[账号引导](../../implemented/feature/2026-09-03-mantur-account-onboarding.zh.md)保留独立客户端调用者。[环境隔离](../../implemented/architecture/2026-09-03-mantur-environment-isolation.zh.md)与[有界广场 JSON 读取器](../../implemented/simplification/2026-09-03-share-manturhub-json-reader.zh.md)仍然适用。桌面托管身份显式替换桌面凭据来源，绝不回退到独立凭据。
