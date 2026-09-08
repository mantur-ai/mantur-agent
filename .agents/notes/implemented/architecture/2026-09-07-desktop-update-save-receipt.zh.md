# Agent Note: 桌面更新保存回执

Status: implemented

[English](2026-09-07-desktop-update-save-receipt.md) | 中文

## Problem

窗口关闭、请求取消或子进程退出都不能证明已接受的操作及持久化写入已经结束。单个资源所有者也不能自行授权安装，需要消费者按顺序协调各方结果。

## Decision

Mantur bundle 拥有 Host 更新消费者；CLI 只为桌面所属启动安装继承 IPC 监听器。Main 在安装确认后开始准备，保存草稿，只接受匹配的 Host 回执，然后关闭账号通道并通过 IPC 请求 Host 正常释放。Main 在允许 updater 安装前，要求子进程真正退出且诊断日志完成关闭。失败、取消和超时都会拒绝安装。

Host 冻结智能体准入，停止 profile 和预设变更，并等待驱动器、原生操作、Gateway/HTTP 调用及资源生产方结束，再关闭设置、会话 writer、投影缓存和存储。它按所有者身份清点每个作用域服务，并保留被替换的实例。重新校验会检测先前回执之后的写入尝试，并在应用树释放后、正常退出前再次执行。未知模块、未管理的 OS 后代、模块 HMR，以及所有者缺少已验证停止结果的组合仍不受支持。策略不会禁用这些模块，也不会把其退出当作保存回执。

上游生命周期修改仅位于 [AgentLoop](../../../../packages/core/agent-loop/src/index.ts)：`quiesceForShutdown()` 将驱动器和启动工作完成与已发布 writer 的关闭分开。现有外部 hook 无法在停止私有驱动器的同时，为已接受的 RPC 保留 writer。升级检查在停机期间保持真实 Gateway 调用，追加它的最终 Session 事件，并比较物理 JSONL 记录与返回的偏移。核心生命周期回归覆盖待处理输入、启动回滚和 writer 失败保留。启动取消只接受所属中止原因，或同时具有 `ABORT_ERR` 且以该原因作为 cause 的 Node `AbortError`；无关中止和 writer 关闭错误仍作为失败保留。

独立 CLI 启动检查覆盖生产 IPC 监听器、启动回滚、正常退出和原始日志重新打开。Main 测试分别阻塞保存与退出，并拒绝陈旧回执、保存失败、等待取消、异常退出、日志错误和超时。`scripts/check-workspace-constraints.ts` 中的包载荷检查要求携带两个 Mantur 更新入口；对应回归会拒绝入口缺失或多余产物。这些检查不会安装更新，也不证明未管理子进程已受约束。

## Alternatives considered

**用应用树释放充当保存操作。** Cordis 会容纳 disposer 失败，驱动器释放也可能在已接受请求结束前关闭 writer。显式所有者结果和有序 writer 关闭才能提供所需证据。

**保存草稿后终止子进程。** Main 无法根据草稿存储或退出码推断 Host 日志已持久化。独立且绑定请求的 Host 回执必须先于正常退出和最终日志关闭。

## Consequences

安装准备失败可能让 Host 保持冻结，同时清理继续进行。应用不会重放已完成工作，也不会自动重启排队工作。运行时保留旧所有者对象直到 Host 退出，避免替换抹去清理证据。Windows 草稿持久化和无所属所有者的 OS 后代仍是独立阻断条件；协调测试通过不会消除它们。
