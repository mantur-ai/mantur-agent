# 原生客户端会话账号

[English](README.md) | 中文

Electron Main 通过 `/api/auth/client/sessions` 和 `/api/auth/client/token` 管理 LOOPBACK/PKCE 授权。正式环境默认为 `https://hub.mantur.ai`；测试环境必须显式配置。浏览器回到随机端口的 `127.0.0.1` 监听器 `/callback` 路径。Main 校验 state 且只接受一次 code；取消会关闭监听器。一次性换码被中断后需要重新登录。

Main 将账号 token 和专用的九十天 API Key 保存到按站点隔离、由系统加密的 `client-session` 记录。桌面端不使用明文存储。即将过期的 token 通过共享刷新操作轮换。Key 通过 `/api/agent/v1/api-keys` 创建一次；创建结果不确定时阻止重试，要求在账号 Key 管理中核对。Broker-v2 仅向 CLI 提供短期命令权限，OpenAPI 请求的 Key 由 Main 添加。

退出先禁止本地访问、终止命令并等待清理，再删除本地凭证；同时尝试远端撤销 Key 和退出客户端，离线退出仍清除本地状态。关闭等待已接受的网络与加密工作。旧设备授权数据库不转换为客户端会话，用户需要重新授权。参见[迁移决策](../../../../.agents/notes/implemented/architecture/2026-09-17-client-session-migration.zh.md)。
