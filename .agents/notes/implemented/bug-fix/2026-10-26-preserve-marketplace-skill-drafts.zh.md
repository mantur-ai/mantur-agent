# Agent Note: 使用广场技能时保留所选草稿

Status: implemented

[English](2026-10-26-preserve-marketplace-skill-drafts.md) | 中文

## Problem

使用广场技能时新建会话，会把所选会话的未发送正文、引用和附件留在原处。原生恢复持有草稿锁时立即插入引用也会失败，即使技能已经安装。

## Decision

使用技能会向所选会话的常驻编辑器追加结构化引用，包括已有历史记录的会话；没有选定会话时则使用未分配草稿。追加前等待原生恢复，并重新验证所选编辑器，不创建会话或发送消息。恢复失败或编辑器归属变化会阻止插入；已被替代的操作不能用错误覆盖较新的请求状态。

本决定部分替代[技能广场草稿](2026-10-22-marketplace-skill-drafts.zh.md)中的新建会话分支。旧记录继续约束未分配草稿、结构化引用和安装状态展示。[桌面检查点决定](../architecture/2026-09-06-desktop-draft-checkpoints.zh.md)继续拥有持久文档与恢复锁，不被本决定替代。

导航插件无法从同步插入失败安全推断恢复就绪，因此共享 Conversation 接口通过 `SessionInputResolver.waitForDraft(id)` 和 `ConversationDrafts.waitForDraft()` 暴露已有恢复 Promise。涉及共享文件为 [contract/input.ts](../../../../packages/client/ui-conversation/src/client/contract/input.ts)、[contract/draft.ts](../../../../packages/client/ui-conversation/src/client/contract/draft.ts) 和 [input/draft.ts](../../../../packages/client/ui-conversation/src/client/input/draft.ts)；会话实现已拥有对应 Promise。Agent-loop 与会话日志格式不变。

## Alternatives considered

**创建新会话并复制部分字段。** 这会改变对话上下文，并可能遗漏编辑器元数据或附件。向常驻文档追加能保留完整内容及其归属。

**用定时器重试插入。** 返回 false 可能表示锁定或其他拒绝原因。等待恢复所有者的明确结果能保留真实失败，无需轮询或无限重试。

## Consequences

正文、已有引用和附件保留在原草稿中，相同引用保持幂等。原生恢复失败时保留已存检查点，不回退为空草稿。仅选择广场技能不会产生模型可见效果。

[恢复锁回归](../../../../packages/client/ui-mantur-navigation/tests/skill-draft-restoration.client.spec.ts)使用真实编辑器和持久化所有者，证明同步插入失败，以及保留正文、三个旧引用和附件时的首次点击成功。Controller 测试覆盖选择变化、绑定替换、卸载和重叠请求。[自动项目浏览器场景](../../../../apps/web/tests/mantur-automatic-project.expected.e2e.ts)通过真实应用组合验证未分配草稿和历史会话草稿，不调用真实模型。这些是共享 API 改动的升级检查；打包桌面的 GUI 复测仍交给发布任务。
