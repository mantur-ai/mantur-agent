# Agent Note: 绑定 Cut 会话比较

Status: implemented

[English](2026-10-24-cut-session-comparison.md) | 中文

## Problem

录制的 Cut 工作台使用动态分配的回环端口，并在系统提示中记录工作区目录。精确的重放比较需要处理这些单次运行值，同时保留工具结果、指令或生命周期事件的变化。

## Decision

[会话快照库](../../../../packages/test-support/session-snapshot/README.zh.md) 提供显式 Cut 比较适配器。它先验证工作台调用与成功结果的关联，再映射两处编辑器 URL 字段。会话头为自身、已验证的工作台目录和指定系统提示位置提供 cwd。身份映射明确指定已观察的事件字段，不把任意业务标识符视为动态值。原样载荷归一化防止通用路径、spill 和用量替换；原始提示长度保留末尾换行和序列分界。适配器比较完整归一化会话以及完整提示和工具 schema 序列；它不删除事件，也不改写原录制。

## Alternatives considered

**忽略工作台结果或只比较选定事件。** 这会接受缺失的生命周期事件和变更的业务内容，因此无法证明录制会话等价。

**使用未纳入维护的验收 helper。** 任务局部 helper 没有永久负例或可发现的测试归属。共享测试支持库提供这些检查，同时不改变产品 Cut 实现或默认归一化策略。

## Consequences

比较证明输入产物的等价性，不代表执行了 GUI 场景。完整 Cut 回归仍需要正式 profile 重放驱动、有版本和来源哈希的真实录制，以及独立声明的完整工作区预期。旧产品版本的录制不能证明新版本的 GUI 行为。私有录制和凭据不是公开 fixture（测试前置数据）。

[适配器对照测试](../../../../packages/test-support/session-snapshot/tests/cut-comparison.spec.ts) 拒绝无效的调用与结果绑定，以及业务内容、生命周期事件、请求头和 fixture 哈希的变更。合成对照验证比较器，并非真实产品录制。完整工作区捕获仍由现有[工作区 helper](../../../../packages/test-support/session-snapshot/src/workspace.ts) 负责。
