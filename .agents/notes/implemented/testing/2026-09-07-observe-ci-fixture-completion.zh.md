# Agent Note: 观察 CI fixture 操作完成

Status: implemented

[English](2026-09-07-observe-ci-fixture-completion.md) | 中文

## 问题

投影缓存阈值测试在安排写入后，用五秒轮询 JSON 文件。这把事件计数策略断言与文件系统延迟绑定在一起。Team 邮箱覆盖还依赖异步恢复在目标离开活跃注册表后读取已持久化回执。npm 解析基准在子进程退出后立即递归删除目录，但 Windows 可能短暂保留临时目录句柄。

## 决定

[缓存阈值测试](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) 观察真实的 `write` Promise，检查两个事件不会安排额外写入，而第三个事件恰好安排一次写入。它只在该写入完成后读取存储值，不主动调用 flush 来满足断言。

[Team 邮箱 fixture](../../../../packages/experimental/agent-team/tests/team.spec.ts) 持久化目标回执，等待其活跃确认工作完成，停止目标，然后将消息加入 Lead 队列。分发必须确认存储中的回执，且不能恢复目标、再次投递提示或发起模型请求。Lead 的存储日志必须恰好包含一个已投递事件。

[npm 基准](../../../../scripts/benchmark-npm-resolution.ts) 在子进程和注册表服务器关闭后，使用现有的 [junction 安全清理辅助函数](../../../../scripts/test-fixture-cleanup.ts) 删除消费方目录。辅助函数的有界重试处理 Windows 文件延迟释放，重试耗尽仍传播清理错误。[npm 测试截止时间](2026-09-04-windows-npm-resolution-test-budget.zh.md) 保持不变。

[快照子会话轮次等待器](../../../../packages/test-support/session-snapshot/src/harness.ts) 自行管理轮询截止时间，并等待每次文件系统收集完成。Vitest 可能在异步回调生成子会话诊断之前使其超时；自有循环会在当前读取完成后报告子会话与所需轮次。超时不会让已开始的读取与场景清理重叠，截止时间之后完成的读取也不能将超时变为成功。

## 考虑过的替代方案

延长各 fixture 的轮询截止时间仍然测量存储延迟，而不是写入是否完成。重复邮箱场景不能确保覆盖冷回执路径。忽略清理错误会留下临时数据。这些做法都不能证明所需结果。

## 后果

fixture 断言观察已完成的操作和精确的持久化结果。测试保留覆盖率阈值，写入拒绝或清理重试耗尽仍会导致失败。本地通过不代表 Windows 执行通过，Windows lane 仍须通过。
