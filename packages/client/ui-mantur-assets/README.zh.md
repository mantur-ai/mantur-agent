---
kind: package-reference
description: "项目内流水线报告、受版本保护的提示词提案和经验证的媒体预览。"
---

# 漫途资产服务

[English](README.md) | 中文

## 概述

此插件读取用户明确选择的漫途流水线报告，并分开保存提示词草稿、Agent 提案、实际请求字段和媒体观察结果。报告写回同时检查文件系统版本与 SHA-256 源指纹；替换前先写入待处理日志，恢复时不会猜测资产与媒体的绑定关系。

## 目录

- [报告与媒体操作](#report-and-media-operations)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 报告与媒体操作

<a id="report-and-media-operations"></a>

浏览器面板读取报告，扫描用户明确选择的项目内候选目录，预览经验证的图片和视频，选择提示词行，保存草稿，提交提案请求，并显示持久化的未完成请求和写入。候选预览只表示待审核的本地文件，不会自动填充报告中空的绑定字段。恢复由 Host 执行，面板不提供恢复按钮。仅当源版本和哈希仍匹配时才重试日志记录的替换；替换内容已经写入时则完成历史记录。存在冲突的源内容保持不变。

`AssetEntry` 和 `AssetCandidate` 描述项目内发现结果。`SourcePin` 保留路径、文件系统 `AssetVersion` 和 SHA-256 指纹；`AssetSnapshot` 将该观察结果与日志版本、报告行和待处理状态组合。`PromptEdit` 指定行指纹和可编辑的提示词字段。`AssetCommand` 为批量操作固定源和日志；`AssetProposal` 保留发起 Session 和请求状态。`AssetMedia` 标识经过验证的预览地址和媒体类型。声明位于 [types.ts](src/types.ts)。

不发布运行时不变量配套模块，因为每次文件系统操作都会检查报告、日志和媒体的新鲜度；服务没有需要单独比较的源状态缓存。

<a id="model-experience"></a>

## 模型体验

### 提示词提案

#### 模型看到什么

模型只能使用 `propose_asset_prompts` 工具记录请求的文本提案。工具不会生成媒体，也不会修改流水线报告。应用提案仍是明确触发的 Host 操作。

#### Token 影响

工具 schema 增加请求头 token。明确发起的提案请求与工具结果增加对话 token；浏览报告和预览媒体不发送模型消息。

#### KV Cache 影响

挂载工具会改变请求前缀。提案消息追加到已有对话历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 日志更新保留读取前观察到的文件系统版本，并使用条件写入。候选扫描只读取所选目录的直接子项，受项目根目录约束；预览会先验证文件签名，再返回回环地址。测试覆盖同一个 LocalFileSystem 实例的并发调用；尚未验证跨进程写入和断电持久性。测试在私有临时目录中创建合成报告和媒体文件头，不依赖外部用户文件。

<a id="dev-note"></a>
### 开发备注

[受保护的资产写回与恢复](../../../.agents/notes/implemented/feature/2026-09-09-mantur-asset-provider.zh.md) 记录源版本与日志要求。
