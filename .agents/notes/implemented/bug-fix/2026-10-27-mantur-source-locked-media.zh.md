# Agent Note: 交付固定源码且分离 FFmpeg ABI 的桌面媒体

Status: implemented

[English](2026-10-27-mantur-source-locked-media.md) | 中文

## Problem

固定的 macOS arm64 外部 FFmpeg 自报 nonfree 且不可再分发。编辑器还会加载两套不同的 FFmpeg ABI。仅复制 compositor 目录会遗漏兄弟库，而 Remotion 的 `DYLD_LIBRARY_PATH` 可能选择名称相同但不兼容的库。npm 包装器元数据既不能标识实际媒体程序，也不提供其对应源码。

## Decision

[源码清单](../../../../apps/desktop/mantur-cut/source.json)绑定已批准媒体归档、完整文件库存、对应源码归档、源码锁与构建配方。[配方](../../../../scripts/mantur-media-build.README.md)构建带 x264 和原生 AAC 的 FFmpeg 6.1.6 GPL 命令行工具，并为固定的 Remotion 原生程序分别构建 FFmpeg 7.1.5 LGPL 库。GPL 库保留 ABI 主版本文件名，LGPL 库保留 Remotion 所需的无版本名称。暂存与 Session 副本保持完整的 `bin`、`lib`、`compositor` 目录关系。受管工具路径和默认 npm 解析使用同一批资源。

媒体输入使用独立、不可变、非 Latest 发布，使 CI 能在桌面版本发布前取得输入。[桌面源码发布器](../process/2026-10-26-desktop-release-sources.zh.md)将实际对应源码归档及最终校验值一并交付。归档包含固定上游源码、配方、配置、构建记录与通知，只有 URL 库存不足以交付源码。保留的 Electron FFmpeg 具有独立的固定来源、源码与通知，不称为由本配方重建。

[仅目标平台暂存决策](2026-09-09-mantur-native-resource-staging.zh.md)继续负责缓存和平台裁剪。其同目录 compositor 规则适用于该布局；固定源码媒体布局只接受经过校验且位于完整媒体目录内的依赖。两种布局都不允许任意父目录跳转、缺失库或非系统绝对依赖。发行签名会改变二进制字节，因此最终签名库存与批准的输入库存分开记录。

已检查的 Remotion 源码与可执行文件具有固定来源链。其精确 FDK fork 保留 FDK-AAC 条款，而补丁改变的是 configure 分类；这些源码没有建立额外的 GPL 兼容许可。替换方案移除这一未闭合组合，不根据编码器名称推断违法，也不对旧发布作法律判定。

## Alternatives considered

**保留主外部二进制或修改批准字符串。** 可执行文件报告 nonfree 配置，元数据不能修复这一输入。

**保留全部原 Remotion 库。** 源码与字节来源本身不足以闭合固定 FDK fork 的组合许可问题。

**共用一套 GPL 库或将两套库平铺。** Remotion 原生程序直接链接 FFmpeg 库，并要求其 7.1 ABI。独立 LGPL 库保留该依赖，而不同的 GPL 库文件名避免加载器替换。

**每次本地集成检查都重新编译已批准候选。** 重编译会改变验收对象，并消耗时间，却没有验证打包改动。本地集成采用批准的归档，固定源码与配方仍可用于再生构建。

## Consequences

已验证候选支持 macOS arm64。其他目标需要各自已验证的输入，不能复用旧 nonfree 二进制。部署目标元数据不证明每个旧 macOS 版本的实际兼容性。受支持的 Cut H.264 路线使用 PCM 后接原生 AAC；任意请求 `libfdk_aac` 的 Remotion 调用不属于该路线。

归档与运行时检查拒绝哈希变化、路径逃逸、不完整库和不支持的配置。验收还要求真实 Session 加载与导出、默认与回退解析、签名包库存、Developer ID 签名、公证和 GUI 成片检查。媒体候选的独立能力与源码审查不能替代最终应用检查。本改动扩展打包与剪辑适配器，不修改 Harness 核心。
