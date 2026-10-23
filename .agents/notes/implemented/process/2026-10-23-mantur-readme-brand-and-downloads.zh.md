# Agent Note: Mantur README 品牌与发布下载

Status: implemented

[English](2026-10-23-mantur-readme-brand-and-downloads.md) | 中文

## Problem

仓库入口页需要独立于组织头像的产品标识，以及区分各平台实际可用版本的安装说明。

## Decision

根 README 配对页面使用 Web 公开资源中已有的蓝色无穷符号 PNG，保留产品名称、面向任务的介绍、截图、上游致谢与许可证链接。根页面省略 YAML frontmatter，使 GitHub 首屏展示产品标识而非元数据表格；包 README 的元数据规则保持不变。

下载链接使用[桌面发布配置](../../../../apps/desktop/package.json)和[发布流程](../../../../apps/desktop/README.zh.md)所拥有的官方 TOS 稳定地址。带核验日期的平台表区分可用安装包版本。发布附件、匿名 HEAD 响应及成功的签名工作流步骤为分发说明提供依据；仅存在于源码或尚未合入的工作不能证明能力已经发布。

[产品标识决策](../feature/2026-09-02-mantur-brand-identity.zh.md)继续负责运行时品牌。本次文档决策不替代该机制，也不改变组织头像或图片资源。

## Alternatives considered

**更改组织头像。** 头像由多个仓库共享，无法提供仓库专属的产品页头。

**将 GitHub 最新标签视为所有平台的安装包版本。** 官方稳定 Windows 安装包可能不同于最新 Mac 版本，也可能不同于 GitHub 附带的 Windows 附件。各平台需要单独核验可用性。

## Consequences

读者可以识别产品并下载可用安装包，不会把更新元数据误当成安装包。稳定地址会推进，因此展示版本带有核验日期，修改说明时需要重新检查。Windows 签名与更新可用性仍作为限制明确说明。

README 和本记录均保持双语三件套。配对、Markdown 链接、格式与独立内容审查用于验证文档；安装包实际运行及需要授权的创作流程仍属于单独的产品验收工作。
