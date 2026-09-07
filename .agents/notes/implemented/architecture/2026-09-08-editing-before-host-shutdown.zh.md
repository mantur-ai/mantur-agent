# Agent Note: 剪辑先于 Host 关闭排空

Status: implemented

[English](2026-09-08-editing-before-host-shutdown.md) | 中文

## Problem

AgentLoop quiesce 会取消已接纳工具的信号。Gateway 与 HTTP 关闭会拒绝回调，其他生产方停止可能终止 worker 或进程。在剪辑仍等待 MCP 结果、附件写入或浏览器保存时启动这些操作，可能中断权威数据写入。

## Decision

Mantur 协调器在其他条件已获准的组合中，首先等待每个保留的 `manturEditing.stopForShutdown()`。剪辑所有者负责自己的分阶段截止：拒绝新的 Host open/execute 请求；完成已接纳的 MCP 执行与附件写入；关闭 editor job 准入并包含该实际截止前接纳的 UI 工作；排空 job 和 export；完成浏览器与服务端保存；关闭自身 transport/server 并观察其 child close。协调器不宣称 Host 与 editor 同时截止。

该阶段成功前，协调器保留 Agent/inbox 准入、有效信号、HTTP/Gateway 回调、writer 和其他生产方。随后启动既有 quiesce、网络关闭及生产方排空，再封存权威 writer。剪辑失败被缓存，并阻止这些后续操作。剪辑排空中创建的所有者也会被收集并排空；在后续生产方或设置清理期间出现的所有者会阻止 writer 封存。后续回执校验也会拒绝未排空的剪辑所有者。

模块允许列表与 codeRuntime/Host runner 排除规则不变。真实剪辑所有者尚未交付整合后的固定实现，所以其模块继续被排除。本变更提供 Host 顺序接线，不授予安装准入，也不新增 UI 冻结通知。

## Evidence

受控剪辑所有者暂停关闭期间，真实 loopback HTTP 与真实 Typert Gateway 仍可使用。其回调在所有者完成前追加 Session 事件；生成的 checkpoint 与重新打开的物理 JSONL 日志一致。对实际关闭方法的 spy 证明，暂停期间不会启动 AgentLoop quiesce 及 terminal/workflow/subprocess 停止。错误对照覆盖写入失败、取消或完成状态未知后保留 writer 和回调。已退役与新发现所有者的对照覆盖阶段切换。把 quiesce 或网络关闭移到剪辑排空之前会使回调测试失败；恢复顺序后通过。

这些测试确立协调器顺序，不证明真实 MCP 信号传播、浏览器 job 接纳、工程持久化或 GUI 安装。后者需要剪辑所有者的固定交付与真实整合组合检查。

## Alternatives considered

**先 quiesce。** 它会取消已接纳执行的信号。**根据不同 origin 关闭 Host 网络。** origin 分离不能证明回调或 Host 依赖已完成。**把生产方停止当作准入冻结。** terminal、workflow 和 subprocess 停止可能取消工作。**整合前放行 editor 模块。** 受控所有者不能证明真实 editor 的完成保证。

## Consequences

剪辑所有者停滞时，准备过程持续等待并保留其依赖。Main 等待到期不授权安装。剪辑所有者失败后，该 Host 持续返回失败。未知生产方与 Shell 完成范围仍阻止发布验收；本变更不引入永久 Shell 策略，也不证明所有脱离管理的后代已经结束。
