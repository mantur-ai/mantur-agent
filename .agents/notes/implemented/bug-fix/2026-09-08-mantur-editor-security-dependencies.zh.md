# Agent Note: 固定修复后的图像与归档依赖

Status: implemented

[English](2026-09-08-mantur-editor-security-dependencies.md) | 中文

## Problem

嵌入式编辑器的生产审计从两条依赖链报告四项高危条目。ONNX Runtime 选用低于 0.6.0 的 adm-zip，其归档大小处理可能分配过量内存。Transformers 选用低于 0.35.0 的 sharp，其中包含有漏洞的 libvips 代码。两个父包继承了这些告警，并非四个独立漏洞。

## Decision

编辑器通过覆盖配置将 `onnxruntime-node > adm-zip` 固定为 0.6.0，将 `@huggingface/transformers > sharp` 固定为 0.35.4。Harness 附件存储同样要求 sharp 0.35.4 或更高版本。锁文件保留 Transformers 4.2.0、两个 ONNX Runtime 版本及语音和模型提供方。限定范围的变更只更新这些依赖链及 sharp 配套的平台二进制。[来源配置](../../../../apps/desktop/mantur-cut/source.json)记录累计第三层补丁与结果树；基础补丁和打包补丁保持固定。

版本依据为 [adm-zip 发行说明](https://github.com/cthackers/adm-zip/releases/tag/v0.6.0)、[libvips 安全公告](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj)与 [libheif 安全公告](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)。Sharp 0.35.4 提供 libvips 8.18.6 和 libheif 1.23.2。Harness 在读取解码器元数据后才检查格式白名单，因此拒绝 AVIF 附件并不能免除使用修复版解码器的要求。ONNX 安装器提取指定文件，因此 adm-zip 对目录条目提取行为的调整不适用于该调用。这些依赖支持打包的 Node 24 运行时。

## Alternatives considered

禁用图像解码器或推理会删除可用功能。大范围升级 Transformers 或 ONNX 会改变模型执行，修复这两项告警并不需要这样做。编辑审计报告不能修复已安装的依赖树。增加第四层补丁会要求修改资源格式，却不改善依赖修复。

## Consequences

依赖变更需要全新不可变安装、生产审计、通过 Transformers 实际解码图像、指定 ZIP 文件条目提取，以及使用保留的 ONNX 版本执行 CPU 推理。平台原生检查只适用于被测平台；macOS arm64 不能验证 macOS x64 或 Windows 二进制。完整安装包重建与 GUI 验收仍然分开。

[adm-zip 符号链接公告](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)同样覆盖 0.6.0，且未列出已修复版本。其目标符号链接和覆盖条件需要单独评估安装器路径；修复图片解码不等于生产审计无告警。每个新签名候选均需验证两处实际安装的解码器，不能原地修改已签名资源。

上游编辑器分别在独立实用进程中启动语义、CLAP 和节奏推理。在 macOS arm64 上，同一个诊断进程同时加载两个 ONNX 版本时，原始依赖树和修复后的依赖树都会在自然退出时异常终止；该失败保留记录。单运行时检查必须包含自然进程退出，并保持实际 worker 的加载方式。检查通过不代表允许合并运行时，也不代表漫途嵌入式 HTTP 入口暴露了上游原生 ASR 桥接。
