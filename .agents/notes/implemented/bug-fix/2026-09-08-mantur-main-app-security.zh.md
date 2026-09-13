# Agent Note: 固定桌面配置与 URI 依赖的修复版本

Status: implemented

[English](2026-09-08-mantur-main-app-security.md) | 中文

## Problem

7300 源码基线的桌面依赖闭包包含 js-yaml 4.2.0、fast-uri 3.1.3 和 ip-address 10.2.0。这三个包对应九项高危公告：两项 YAML CPU 耗尽问题、六项 URI 解释问题和一项 IPv4 解析歧义问题。工作区生产依赖审计还包含未打入主应用的依赖，因此其总数不等同于实际随包依赖清单。

## Decision

[工作区 overrides](../../../../pnpm-workspace.yaml) 将存在漏洞的 js-yaml 4.2.0 选择替换为 4.3.1，将 AJV 8.20.0 下的 fast-uri 固定为 3.1.6，将 express-rate-limit 8.5.2 下的 ip-address 固定为 10.3.1。锁文件仅改变这些依赖选择。按依赖所有者限定的覆盖保留 MCP SDK 1.29.0 和 express-rate-limit 8.5.2；YAML 覆盖也涵盖 vendored Include 消费者，无需编辑其源码。

Js-yaml 4.3.1 是同时修复[合并工作量限制](https://github.com/nodeca/js-yaml/security/advisories/GHSA-52cp-r559-cp3m)和[有序映射查找](https://github.com/nodeca/js-yaml/security/advisories/GHSA-5p4m-2wfm-xmqj)问题的首个 v4 版本。Fast-uri [3.1.6](https://github.com/fastify/fast-uri/releases/tag/v3.1.6) 在保留 v3 API 的同时补齐六项 URI 修复。Ip-address [10.3.1](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-mwp4-54f8-5fhr) 拒绝包含前导零的 IPv4 段。每份 YAML 文档最多访问 10,000 个合并键的限制保持启用；低于限制的合法配置保留合并优先级和 Loader 表达式处理行为。

## Alternatives considered

刷新宽泛的语义版本范围会改变无关包和 MCP 依赖栈，超出已确认需求。编辑 vendored Include 源码会重复工作区拥有的依赖决策。禁用解析限制或隐藏审计结果会保留存在漏洞的行为。

## Consequences

[回归测试](../../../../scripts/main-app-security.spec.ts) 通过实际所有者包解析依赖，覆盖 YAML 拒绝行为与合并语义、独立 JavaScript realm 中的有序映射查找工作量、畸形 URI 拒绝与 Unicode 规范化，以及 IPv4/IPv6 限流分桶。升级证据还包括不可变安装、生产依赖审计、现有 Loader 与 MCP/RPC 回归、Mantur 构建和受影响版本的负向对照。

Express-rate-limit 使用 Address6 和 Node 的 IPv6 检测。Address4 回归证明依赖修复，不代表已确认该消费者存在可利用的请求路径。独立 e2b/vitest 链中的七项高危公告不属于本次改动；无版本的内联代码片段也未完成穷尽清查。源码检查不代表重建安装包或 GUI 已验收；冻结基线应用保持原样。
