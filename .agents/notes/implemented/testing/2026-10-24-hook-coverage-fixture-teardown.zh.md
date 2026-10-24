# Agent Note: 删除脚本前释放 hook coverage 的 Context

Status: implemented

[English](2026-10-24-hook-coverage-fixture-teardown.md) | 中文

## Problem

Claude Code 和 Codex 的 hook coverage fixture 创建根 Context，并在私有临时目录中写入可执行脚本。Agent 空闲和脚本写入的标记均不能证明分离执行的 hook 及其进程已经结束。未释放资源所有者便删除脚本，会使迟到的执行访问已删除文件，并保留进程退出监听器。

## Decision

[共享 fixture 所有者](../../../../packages/hooks/hook-protocol/tests/coverage-fixture.ts) 在每个 Context 构造后立即登记。两份 coverage 用例矩阵依次停止已登记的 hook bridge fiber、停止 command scope、释放已登记的 AgentLoop fiber，再释放根 Context，最后删除所属脚本目录。Agent 所有者取消并等待自己拥有的存活 agent，在 persistence 仍挂载时完成 writer flush。Fixture 不遍历可能包含测试 stub 的公共 agent registry，也不调用要求持久化 writer 的 Host shutdown API，因为内存 fixture 不具备该前提。清理尝试释放所有已登记的根。Cordis 会记录 effect 失败而不拒绝 disposal，因此 fixture 临时观察每个根 logger 的 error 方法，转发原有行为，并在全部根结束后精确恢复该属性。记录的错误和直接 rejection 均使清理拒绝并保留目录；logger 自身失败也在其他 effect 结束后报告。失败记录跨后续清理调用保留，因为一次性 effect 消失不能证明已经恢复。取消和进程树静止仍由已有 hook、command-scope 和 subprocess 释放逻辑负责，运行时实现不变。

真实子进程用例、其分离执行完成条件和 afterEach 共用局部 15 秒预算，或更高的 `DSH_COVERAGE_TEST_TIMEOUT_MS` lane 预算。纯配置和不启动进程的用例保留 runner 默认值。诊断中一次未收到终止信号的正常 hook 完成耗时 5.754 秒，独立证明五秒无法容纳所有已观察到的启动。十五秒是为启动、顺序命令和清理预留的工程预算，不是操作系统延迟上界。既有 hook 和 shell 执行期限不变。

## Alternatives considered

**仅在断言成功后释放 agent handle。** 这会遗漏根 Context 所属的 bridge 和 subprocess 服务，也无法覆盖断言失败或插件安装未完成的 fixture。

**在标记出现或 agent 空闲后删除目录。** 标记可能早于脚本退出，分离执行的 hook 后续处理也可能晚于 agent turn。两种观测均未等待所属 effect 完成。

**通过增加超时解决清理问题。** 更大的时间预算不会释放 Context，也不能确定目录删除顺序。独立时序诊断观察到 fixture 脚本正文前的显著延迟；本生命周期修正不声称解决了启动成本，也不证明完整 coverage 下五秒足够。

**将错误观察器注册为根 effect。** 根 effect 并发释放，观察器可能在另一个 disposer 报告失败前消失。fixture 使用外层 finally 拥有并恢复观察器。

## Consequences

Coverage fixture 清理包含取消和异步释放。Barrier 回归阻止 Context effect 尚未完成时删除目录；移除 Context 释放便会失败。真实同步和异步 effect 失败验证原始错误传播、目录保留、等待另一个根以及 logger 精确恢复。另有断言覆盖独立根隔离，以及 logger 自身失败不打断其他 effect。真实子进程回归验证用例正文抛错后，子进程消失、进程退出监听器移除以及目录删除。真实 writer flush barrier 证明 agent 所有者完成前，根释放不能提前关闭 persistence；颠倒顺序会在不改期限的情况下触发断言失败。内存 agent 及已主动释放的 handle 覆盖普通 owner 释放。真实 hook 命令和断言保持完整。定向预算观测覆盖默认 lane 和 90 秒 lane，包括清理及分离执行的条件等待。完整 coverage 和平台时序仍需独立验证。
