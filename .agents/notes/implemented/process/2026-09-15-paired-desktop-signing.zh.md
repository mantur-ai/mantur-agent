# Agent Note: 双平台桌面签名

Status: implemented

[English](2026-09-15-paired-desktop-signing.md) | 中文

## Problem

同时提供两个桌面平台的版本，需要来自同一源码的已签名安装包和更新元数据。另一平台失败后仍发布其中一个平台，会让自动更新发现不完整的版本。

## Decision

[桌面发布工作流](../../../../.github/workflows/desktop-release.yml)在 macOS 架构选择之外接受明确的 Windows 选项。Windows 签名使用受保护的 `windows-release` 环境，并验证安装包和解包后应用的 Authenticode 签名。组装要求每个选中平台均成功；未选中的 Windows 任务可以跳过。单个发布步骤同时接收安装包、blockmap、各平台更新元数据和哈希。

## Alternatives considered

分别发布各平台会让用户在两个更新通道齐备之前发现版本。用未签名 Windows 包替代会违背已签名交付的要求。保留 Windows 可选项，允许凭证不可用时明确构建仅包含 macOS 的候选版本。

## Consequences

[桌面发布说明](../../../../apps/desktop/README.zh.md)负责说明凭证配置和精确源码发行审核。缺少 Windows 凭证会阻止已选中的双平台发布，不会削弱发行审核。工作流测试会执行每种平台组合的产物选择，并约束上传前的签名验证。实际证书有效性和打包后启动仍由原生 CI 检查；本地工作流测试无法证明这两项结果。
