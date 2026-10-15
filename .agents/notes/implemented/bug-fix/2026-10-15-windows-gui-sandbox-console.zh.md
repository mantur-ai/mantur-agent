# Agent Note: 为 GUI 启动的沙箱 runner 准备控制台

Status: implemented

[English](2026-10-15-windows-gui-sandbox-console.md) | 中文

## Problem

Windows ACL 沙箱要求子进程继承控制台；原生验证记录表明，受限子进程自行创建控制台会发生 DLL 初始化失败。Electron GUI 启动不保证附有控制台。用户报告的 PowerShell 退出码 `0xC0000142` 与此记录一致，但尚未在本地复现故障机。

## Decision

沙箱 runner 在创建受限令牌前检查 `GetConsoleCP`。没有控制台时，在已有令牌下调用 `AllocConsole`，仅隐藏新分配的窗口。控制台分配可能替换重定向管道，因此保存并恢复全部三个继承的标准句柄。准备失败会终止执行。控制台保留到 runner 退出；不隐藏或分离已有终端控制台。

修改涉及上游 `packages/sandbox/sandbox-windows-acl` 的 runner 和 FFI，新增控制台准备函数，并从 `packages/subprocess/win32-process` 导出现有标准句柄常量。漫途 profile 无法表达受限进程创建前的原生控制台分配。令牌 SID、文件系统授权和 Job Object 所有权保持不变。

## Alternatives considered

**禁用隔离或改用非受限进程重试：** 不采用，因为 shell 成功启动不应获得更广的文件权限。

**给受限子进程设置 CREATE_NO_WINDOW：** 不采用，因为沙箱原生记录表明这会触发初始化失败，并非修复方式。

## Consequences

跨平台测试覆盖已有控制台保留、句柄恢复、无窗口及 API 失败。原生 runner 回归先分离控制台，通过真实 runner 执行 PowerShell，并验证工作区外写入被拒绝。此原生测试用于升级验收，在当前 macOS 主机上尚未执行；补丁不代表已证实用户故障机恢复。
