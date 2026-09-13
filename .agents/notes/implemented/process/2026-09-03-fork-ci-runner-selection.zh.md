# Agent Note: 为 Mantur Fork 选择标准托管运行器

Status: implemented

[English](2026-09-03-fork-ci-runner-selection.md) | 中文

## Problem

拉取请求工作流使用 DeepSeek 上游组织拥有的大规格运行器标签。公开的 `mantur-ai/mantur-agent` Fork 没有注册这些标签对应的运行器，因此 Linux 和原生 Windows 作业会一直排队且不会启动任何步骤。

Cloudflare 预览工作流还依赖上游 Pages 项目、部署令牌与 Access 服务凭据。Mantur Fork 不拥有这套外部基础设施，但其产品检查必须保持完整且可见。

## Decision

拉取请求工作流在 GitHub 分配各作业前通过 `github.repository` 选择运行器。在 `mantur-ai/mantur-agent` 中，三个高容量 Linux 作业使用 `ubuntu-24.04`，四个原生 Windows 作业使用 `windows-2025`。这些作业保留原有命令、阻塞状态与聚合依赖。

Fork 档位将编译器密集型门禁的扇出限制为两个，运行两个单 worker 覆盖率分区且不与豁免套件重叠，并将 lint、publint、录制会话和浏览器 worker 上限设为两个。Windows 构建对串行执行，Windows 覆盖率使用相同的双分区串行档位，观测聚合每次运行两个门禁。这些限制匹配四核托管资源，同时保留全部检查。

`deepseek-ai/deepseek-harness` 保留大规格运行器标签和已有的仓库变量故障转移路径。Fork 专用条件只在 Mantur 仓库中优先匹配。

Cloudflare 预览作业只在 `deepseek-ai/deepseek-harness` 中运行。Mantur 拉取请求会将该作业明确报告为跳过，因为 Fork 未配置部署。产品构建、覆盖率、快照、产物、Wine 检查和原生 Windows 检查仍由 `ci.yml` 承担；缺少外部预览不会被表述为产品验证。

`scripts/ci-workflow.spec.ts` 固定运行器选择器的两个仓库分支，验证所有关键作业仍可由拉取请求触发，并固定仅上游运行预览的条件。

## Alternatives considered

**在 Fork 中注册上游大规格运行器的副本。** 否决，因为这会让普通拉取请求验证依赖私有组织基础设施，并重复运行器运维工作。

**跳过需要不可用标签的作业。** 否决，因为跳过构建、覆盖率、快照或原生 Windows 检查会把基础设施缺失变成错误的产品绿色信号。

**维护独立的 Fork 工作流文件。** 否决，因为重复的作业主体会在上游同步时产生漂移。仓库选择只改变运行器分配，并保留一份共享检查定义。

## Consequences

Mantur 拉取请求可以在 GitHub 托管运行器上执行全部关键检查，代价是并发较低且完成时间更长。上游拉取请求继续使用优化后的运行器池、并发设置与故障转移控制。

Mantur Fork 不发布 Cloudflare 拉取请求预览。预览作业会明确结算为跳过，而必需的产品证据继续由共享 CI 工作流提供。
