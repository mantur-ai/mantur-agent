# Agent Note：Windows npm 解析测试预算

Status: implemented

[English](2026-09-04-windows-npm-resolution-test-budget.md) | 中文

## Problem

`scripts/benchmark-npm-resolution.spec.ts` 会启动真实 npm 进程，并让它访问本地的纯 metadata registry。三个行为测试给子进程的时间都是 10 秒。手动 benchmark 不构成发布时性能承诺，因为 npm 解析耗时会随机器负载变化；但这个只属于测试的子进程时限把较慢的 Windows coverage runner 误报成产品故障。Fork 的双分区 Windows coverage lane 连续两次复现相同超时，而其余超过 15,000 个测试均通过。其中一次还在 npm 超时后仍占用文件时进入临时目录清理，随后产生 `EPERM`。

## Decision

三个预期成功的 npm 解析用例共用一个明确测试时限：Windows 为 60 秒，其他平台保留原来的 10 秒。测试仍要求成功生成 package lock、发生 registry metadata 请求、不请求 archive、得到预期 alias 布局，并隔离继承的 npm 配置。生产 benchmark 默认值与命令超时行为均不改变。

Windows 时限比 coverage lane 的单测试 90 秒预算少 30 秒，让 teardown 能在相同的测试预算内完成。它让真实 npm 子进程有时间正常完成并释放临时文件，同时不会把这组行为测试变成 resolver 速度检查。

## Verification

- `pnpm exec vitest run scripts/benchmark-npm-resolution.spec.ts`
- `pnpm run doc-sync`
- 拉取请求中具有阻断作用的 `windows node 24 / coverage` 任务会执行 Windows 专属的 60 秒路径。

## Alternatives considered

**提高生产 benchmark 默认值。**拒绝，因为失败值只属于行为测试。手动命令的默认值已经是 300 秒，其可选耗时阈值仍由调用方决定。

**在 Windows 上跳过 npm 进程测试。**拒绝，因为 Windows package-lock 生成与临时文件释放是有价值的跨平台证据。放宽安全时限可以保留该证据，同时不把 runner 性能当作断言。

## Consequences

Windows runner 争抢可能延长这三个测试，但不会再让无关拉取请求失败。真正卡住的 npm 进程仍会在 60 秒后失败，非 Windows 平台则保持原有 10 秒限制。
