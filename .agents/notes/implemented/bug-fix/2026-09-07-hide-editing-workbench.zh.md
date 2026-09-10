# Agent Note: Retain the current editing workbench when hidden

Status: implemented

[English](2026-09-07-hide-editing-workbench.md) | 中文

## Problem

关闭工作台会卸载浏览器编辑器。编辑器的原生 Agent 桥接注销，再次打开会产生不同的编辑器身份。即使工程版本未变，已绑定的 MCP 客户端也会将替换后的实例判为过期。因此，一次普通的面板收起操作可能使尚未应用的剪辑操作无法继续访问。

## Decision

[布局组件](../../../../packages/client/ui-layout/src/client/AppFrame.tsx)保留当前 Session 已打开的工作台，通过原生 `hidden` 属性隐藏。样式表为该状态保留 `display: none`。子组件只在首次打开后挂载；选择其他 Session 或卸载外层界面会释放它。其他 Session 不保留浏览器编辑器。已有的打开状态记忆与已挂载实例分别管理。

此改动必须位于通用布局，因为移除整个剪辑插件子树的条件由它控制，子插件无法阻止父级移除。涉及的上游文件为 AppFrame、其样式表以及布局插槽和服务文档。[剪辑集成](../feature/2026-09-06-mantur-local-editing-workbench.zh.md)保留既有 Host 和 MCP 归属，不修改传输、身份检查、工具重放或工程格式。

常驻的 `main.workbench.toggle` 插槽位于对话边缘、被隐藏的子树之外。剪辑插件提供原生箭头按钮，带有本地化动作标签和展开状态。创作模式事件不改变工作台可见性。标题栏保留“刷新”，不再提供重复的收起操作。

## Alternatives considered

**隐藏后重新连接或绑定。** 这会改变连接恢复和草稿归属，而不是在仅改变显示的操作中保留编辑器。原生过期绑定保护保持不变。

**保留所有访问过的 Session 编辑器。** 这会引入历史 Session 的资源保留策略。保留范围限定为当前 Session；切换 Session 后返回，不承诺继续旧草稿。

## Consequences

当前编辑器隐藏后保留内存和原生桥接，直到切换 Session 或卸载所属组件。隐藏内容不参与布局和键盘导航。明确重新加载编辑器或刷新页面仍会重建编辑器；已保存文件保留，但不会自动恢复或重放旧草稿。

升级检查覆盖首次按需挂载、保持同一编辑器身份的反复收放、Session 隔离和资源释放。完整客户端验证将本地视频导入包含两个操作的草稿，收起并展开同一编辑器，再通过原生审阅应用和终态查询确认视频可见且已持久化。AppFrame 回归测试及其组件所属的 DOM 快照固定隐藏子树和切换 Session 时释放的行为。
