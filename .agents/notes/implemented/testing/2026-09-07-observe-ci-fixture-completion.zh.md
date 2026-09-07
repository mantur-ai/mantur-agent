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

[Team 恢复夹具](../../../../packages/experimental/agent-team/tests/persistence.spec.ts) 区分子任务从注册表移除与邮箱确认完成。屏障延迟真实目标 flush 的返回，随后等待已登记的确认操作，再检查投递结果。确认尚未完成时，目标就可能离开注册表；一秒轮询不能证明操作完成。

Windows 覆盖率运行加载 [fork 诊断预加载脚本](../../../../scripts/vitest-fork-diagnostics.cjs)，并在失败时保留其 JSONL 文件。记录仅包含生命周期事件、父进程和 worker PID、Node 版本、平台、退出码和信号。观察器不改变子进程结果，不记录参数、环境、测试载荷或原始崩溃报告。退出事实用于缩小未解释的 worker 死亡范围；收集信息本身不是修复。

[原生账号 Host 夹具](../../../../apps/desktop/tests/native-account-host-support.ts) 将当前 Vitest 用例的预算传给真实 IPC 子进程。Windows 覆盖率为每例提供 90 秒，而[运行 34089493592](https://github.com/mantur-ai/mantur-harness/actions/runs/34089493592/job/101639924686) 的描述符 ACL 用例耗时 27–51 秒；夹具原先的 10 秒父进程回复期限在准备完成前就已到期。握手测试观察子进程实际发来的预算，而不只检查父进程输入。产品通信期限和独立 Bash 命令夹具保持不变。消费方回执断言失败后，夹具清理仍尝试关闭 Main；两步都拒绝时保留两个错误。子进程结束和临时目录清理仍需等待；这既不会把失败回执视为成功，也不代表本地完成了原生 Windows 验收。

可选的 [workflow reporter](../../../../scripts/workflow-case-reporter.ts) 记录父进程收到的模块与用例回调。将 `DSH_WORKFLOW_CASE_DIAGNOSTICS` 设为已存在的产物目录中的文件路径，并在 Vitest 命令后添加 `--reporter=default --reporter=./scripts/workflow-case-reporter.ts`。[测试 setup](../../../../scripts/workflow-case-setup.ts) 将同步的 `before-each` 和 `after-each` 记录写入该路径追加 `.worker.jsonl` 后的文件；配置仅在设置该变量时加载它。两个观察器仅选择 `workflow-worker-thread.spec.ts`，记录标识、时间戳和阶段，不包含载荷或错误。两个文件应与 fork 退出证据一同保留。空路径或写入失败会使诊断运行失败。

[ci.yml](../../../../.github/workflows/ci.yml) 的 native-tests 命令启用这两种已有观察器。其 `failure()` 上传只选择作业临时目录中的父进程用例、worker hook 和 fork 退出 JSONL 文件，保留七天；诊断文件全部缺失时报告错误。它不上传任意临时文件，也不改变测试失败结果。

worker 死亡可能丢失缓冲的父进程回调，因此缺少父进程用例事件不能证明用例未开始。同步测试 hook 会在 worker 突然退出前保留已进入的 hook 记录；它们不覆盖导入失败、不证明所有清理均已完成，也不能将原生崩溃归因于最后一个用例。先前启动的原生工作仍可能重叠。正常和强制退出的子进程检查验证 hook 记录已落盘；Windows 原生异常归因仍需 Windows 证据。

## 考虑过的替代方案

延长各 fixture 的轮询截止时间仍然测量存储延迟，而不是写入是否完成。重复邮箱场景不能确保覆盖冷回执路径。忽略清理错误会留下临时数据。这些做法都不能证明所需结果。

## 后果

fixture 断言观察已完成的操作和精确的持久化结果。测试保留覆盖率阈值，写入拒绝或清理重试耗尽仍会导致失败。本地通过不代表 Windows 执行通过，Windows lane 仍须通过。
