# Agent Note: 恢复 macOS 桌面草稿存储

Status: implemented

[English](2026-10-22-macos-draft-bridge.md) | 中文

## Problem

桌面重启会改变 loopback origin。仅依靠逐 Session 浏览器存储，未分配会话的文本、精确 Skill 引用和已选图片字节无法跨重启保留。技能更新桌面验收暴露了 macOS 恢复路径缺失。

## Decision

macOS 载体挂载既有草稿存储和经过主 frame 鉴权的 IPC 桥，并暴露固定 preload 操作。既有 Conversation 适配器在启用输入前恢复完整文档和图片字节。不扫描或迁移 profile，不向模型发送草稿内容。

正常退出在停止 Host 前等待持久版本回执。重复退出请求共享该待完成操作。保存失败会释放输入锁，保留应用窗口并显示本地化重试提示。更新安装在独立 Host 检查点和已验证退出前使用同一草稿准备过程。正常退出不能与更新准备重叠；更新尝试结束后用户可重试退出。

Windows 保留浏览器草稿存储，因为现有原生存储明确拒绝该平台的持久化路径。Main 和 preload 均仅在 macOS 启用原生适配器。本决策仅取代[原生文件导入](../feature/2026-09-11-desktop-file-import.zh.md)中移除 macOS 草稿的决策；文件导入及其存储引用保留。[草稿检查点设计](../architecture/2026-09-06-desktop-draft-checkpoints.zh.md)拥有文档和图片校验规则。无需修改上游核心文件。

## Alternatives considered

保留纯浏览器存储无法在端口变化后恢复。只保存剪贴板文本会丢失 Skill 元数据和图片字节。Windows 暴露原生适配器会激活已知被拒绝的存储路径并阻止编辑；本次不声称 Windows 持久化可用。

## Consequences

macOS 恢复保留精确身份和附件，不发送任务。不支持或损坏的检查点显式失败，不替换为空内容。草稿保存占用私有磁盘空间；强制终止进程无法等待最终回执。Windows 仍不支持跨 origin 恢复。

## Verification

Main 入口测试覆盖延迟回执、重复退出请求、保存失败后的重试和更新重叠。preload 测试覆盖固定频道和 Windows 排除；桥接与真实临时文件测试覆盖 frame 鉴权、版本匹配及损坏附件。既有 Conversation 快照固定恢复的引用和图片字节；本地化拒绝快照固定新增错误文案。桌面验收使用隔离 profile 和原生窗口，不发送模型任务或发布。
