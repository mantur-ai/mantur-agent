# Agent Note: 删除目录前排空列表测试缓存

Status: implemented

[English](2026-10-24-subagent-listing-fixture-teardown.md) | 中文

## Problem

[子代理列表测试夹具](../../../../packages/subagent/subagent/tests/list-children.spec.ts) 拥有一个 Context 以及私有 JSONL 和投影缓存目录。session 创建会独立于列表操作完成安排检查点写入。在写入已接纳时删除目录，会使异步文件系统操作与递归删除竞争；聚合覆盖率运行在夹具清理中暴露了 ENOTEMPTY。

## Decision

夹具在构造 Context 后立即登记它。共享异步清理先等待投影缓存关闭，再释放 Context，最后删除目录。缓存关闭必须先于 Context 释放，因为并发 fiber 释放器可能在已接纳检查点进入写队列前关闭存储域。此顺序应用[代理关闭写入者决定](../architecture/2026-09-07-agent-shutdown-writers.zh.md)中描述的投影缓存所有权，使用现有服务操作，不修改运行时实现。

## Alternatives considered

**只等待 Context 释放。** 在存储域写队列前被阻塞的检查点会因并发释放关闭存储而收到域已关闭错误。显式排空缓存能在存储清理前完成已接纳的写入。

**重试删除或延迟清理。** 两者都不能证明写入者已停止。夹具保留现有 JSONL 删除策略，不增加缓存目录重试或调度延迟。

## Consequences

清理需要等待已接纳的缓存写入和 Context 释放，包括部分初始化的夹具。barrier 回归在存储域 put 前阻塞真实缓存写入，验证清理保留目录，再在允许删除目录前验证持久记录。同一个 barrier 在直接删除实现下，无论是否启用 V8 覆盖率都会失败。此夹具修复不建立 Cordis 并发释放器的一般顺序保证；运行时关闭顺序仍由运行时组件负责。
