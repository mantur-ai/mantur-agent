# Agent Note: 签名前暂存仅属于目标平台的编辑器资源

Status: implemented

[English](2026-09-09-mantur-native-resource-staging.md) | 中文

## Problem

内嵌编辑器复制了构建缓存、第二份相同的 Chrome Headless Shell 和其他原生目标的 ONNX 二进制。macOS compositor 的可执行文件与 dylib 使用裸相对安装名称，即使相邻库存在，hardened runtime 也会拒绝加载。应用签名完整不代表视频导出能加载其依赖。

## Decision

分发复制排除精确的 webpack 缓存和重复浏览器缓存目录，保留清单指定的顶层浏览器及其许可证。两份 ONNX 安装仅保留 `bin/napi-v6` 下选定的平台与架构；缺少目标绑定会阻止暂存。其他依赖、缓存和 notice 不变。运行时浏览器调用继续使用既有的明确清单路径，缺失时仍报错，不请求下载。

macOS 暂存在签名前，将 compositor 的 ffmpeg、ffprobe、remotion 及每个相邻 dylib 改为相对于加载器的同目录引用。仅接受系统库路径和确实存在的同目录 dylib；再次检查会拒绝未解析或未改写的引用。打包器通过既有签名命令签署这些文件，不修改冻结应用或源二进制。

## Alternatives considered

泛化缓存删除或按文件名删除可能移除运行数据和许可证。保留第二份浏览器作为隐式备用会掩盖清单错误。关闭 hardened runtime 或扩大权限是在改变安全策略，而不是修复安装名称。修改已签名资源会使候选标识失效。

## Consequences

既有 electron-builder 标准权限包含 `disable-library-validation`；本决策不新增权限或签名例外。本地 ad-hoc 测试使用同一权限配置。仅启用 runtime、未带这些权限的 ad-hoc 探针会因另一项 Team ID 要求失败；应用包校验成功不代表已启用库校验，也不代表 Developer ID 或公证认可。

结构测试在所有支持目标上确认许可证与无关缓存保留。macOS 原生夹具在既有签名条件下加载递归 dylib 链。最终验收另需包内 FFmpeg 生成音频、编辑器真实视频导出及 ffprobe 读回、无下载的浏览器选择，以及完整应用签名校验。安装逻辑字节、实际占用字节与压缩归档大小分别报告；暂存排除项不能预测下载节省量。
