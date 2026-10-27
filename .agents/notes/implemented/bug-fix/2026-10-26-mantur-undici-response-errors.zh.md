# Agent Note：将响应编码错误限制在下载请求内

Status: implemented

[English](2026-10-26-mantur-undici-response-errors.md) | 中文

## Problem

嵌入式编辑器的 AI SDK 默认下载器使用 Undici 7.x。HTTP 响应携带过多内容编码并提前关闭连接时，即使调用方捕获 fetch 拒绝，Node 仍可能终止。仅监听回环地址的入站 HTTP 不能保护出站下载免受这种响应影响。[维护者公告](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c)将 7.30.1 列为首个修复该问题的 7.x 版本。

## Decision

编辑器在累计[退出补丁](../../../../packages/client/ui-mantur-editing/adapters/mantur-cut-shutdown.patch)中添加 npm override `undici@7: 7.30.1`，并锁定解析所得源码包的完整性摘要。[源码配置](../../../../apps/desktop/mantur-cut/source.json)绑定补丁摘要及结果 Git 树。前两层补丁、已有依赖 overrides 和独立解析的 Undici 6.x 构建依赖保留原值。[图像与归档依赖决策](2026-09-08-mantur-editor-security-dependencies.zh.md)仍独立适用。

## Alternatives considered

修改 Harness 锁文件不会更新编辑器打包依赖。广泛执行 audit fix 会改动无关提供方和媒体依赖。替换所有 Undici 主版本会迫使构建消费者跨越主版本边界，却没有解决另一条已证实的运行时路径。

## Consequences

官方[响应编码回归用例](https://github.com/nodejs/undici/blob/07ded4941b1e72afec862958c3b8ddf468f3b429/test/fetch/encoding.js)在 Node 24.18.1 下使用 7.29.0 时失败，使用 7.30.1 时通过。同一本机 fixture 在隔离测试进程中运行，唯一调整是选择已安装包的路径。正常压缩下载和超量编码链拒绝用例也通过。上游 fixture 在易受影响版本上报告响应长度不匹配；这是相同的提前断开失败场景，不是未取得的原审查者 socket 错误 payload。

依赖级结果不代表安装包批准。每个新候选包均需核对实际解析的依赖版本、重新执行生产审计并评估剩余发现，同时完成独立负责的媒体、签名与 GUI 检查。已签名资源不得原地修改。
