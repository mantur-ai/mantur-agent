# Agent Note: Windows 原生媒体输入

Status: implemented

[English](2026-10-28-windows-native-media-inputs.md) | 中文

## Problem

桌面编辑器需要具有完整源码记录的 Windows 可执行文件和 DLL。macOS 媒体归档不能证明 PE 架构、Windows 加载行为或 npm 所附 FFmpeg DLL 的构建配置。

## Decision

[Windows 媒体候选工作流](../../../../.github/workflows/desktop-windows-media.yml)在原生 Windows 的 MSYS2 UCRT64 工具链下运行[固定构建配方](../../../../scripts/mantur-media-build-windows.py)。外部 FFmpeg 和 FFprobe 使用 GPL CLI 构建；Remotion 进程加载按其所需 ABI 独立编译的 LGPL FFmpeg DLL。工具版本、源码哈希、配置、导入依赖和执行探测随候选及对应源码归档一并留存。

该工作流只有仓库只读权限，不接触发布凭据。它保留失败证据，不改安装器、tag 或更新渠道。独立原生任务读取精确已发布 Windows 基线的更新配置，不安装或启动它。[源码交付策略](2026-10-26-desktop-release-sources.zh.md)继续管理产品源码归档；[双平台桌面签名](2026-09-15-paired-desktop-signing.zh.md)继续管理对应的独立工作流。

## Alternatives considered

**复用 Mac 归档。** Mach-O 二进制不能提供 Windows 运行证据或可执行输入。

**复用 npm compositor 的全部文件。** 已检查的 Windows 包含有 GPL FFmpeg DLL，其构建输入与选定的 LGPL 库配置不同。仅保留单独许可的 Remotion 可执行文件及包装文件，使库的构建输入明确。

**由媒体构建直接发布。** 媒体构建成功不能证明安装后的桌面应用或更新器。候选生成不具备发布权限。

## Consequences

Windows 编译增加 CI 时间，并需要独立二进制清单。源码和导入检查与实际原生执行分开记录；包体、安装和升级结论需要各自的证据。失败日志对应精确执行轮次留存，媒体候选不是已签名或已发布的桌面版本。
