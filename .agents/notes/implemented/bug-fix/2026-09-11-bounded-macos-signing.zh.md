# Agent Note: 限制 macOS 签名扫描并发

Status: implemented

[English](2026-09-11-bounded-macos-signing.md) | 中文

## Problem

桌面正式构建在签名工具检查包内依赖时因 `EMFILE` 失败。打包器使用的 `@electron/osx-sign` 1.3.3 递归通过 `Promise.all` 启动所有子项检查，同时打开的文件数随应用目录树增长。

## Decision

pnpm 补丁让两种分发模块格式都按顺序扫描子项。二进制识别、临时文件清理、嵌套应用及 framework 顺序、权限声明、签名和验证保持不变。锁文件固定 electron-builder 使用的补丁。

## Alternatives considered

提高 runner 文件描述符限制仍会让扫描随包体增长而无限并发。忽略目录可能漏签嵌套代码。直接覆盖为 osx-sign 2.x 无法保留打包器所用 API：[上游大版本](https://github.com/electron/osx-sign/releases/tag/v2.0.0)移除了 `signAsync`。

## Consequences

扫描以并行吞吐量换取有限的打开文件数。打包器采用兼容的上游修复时需重新评估此补丁。Developer ID 签名、公证和打包启动检查仍决定候选版本能否交付；扫描成功本身不证明这些结果。

## Verification

正式构建工作流在软、硬文件描述符限制均为 64 的子进程中运行实际安装的扫描器。包含数百个文本文件及嵌套二进制代码的目录树必须按顺序返回完整签名目标、正常退出，且不遗留运行中的子进程。未打补丁的扫描器在相同限制下也已对本地桌面包复现 `EMFILE`。
