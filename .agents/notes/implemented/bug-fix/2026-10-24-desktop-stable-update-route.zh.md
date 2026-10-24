# Agent Note: 桌面更新检查固定使用稳定版元数据

Status: implemented

[English](2026-10-24-desktop-stable-update-route.md) | 中文

## Problem

Electron Builder 从预发布版本检测出 `rc`，并将其与稳定更新源 URL 一起写入包内 generic 配置。没有运行时覆盖时，electron-updater 请求 `stable/rc-mac.yml` 或 `stable/rc.yml`，而隔离的发布器不会生成这些地址。仅禁用预发布偏好无法改变该地址。

## Decision

[桌面控制器](../../../../apps/desktop/src/updater.ts)在定时或手动检查前选择 `latest`，并在通道 setter 之后设置 `allowDowngrade=false`，因为 setter 的副作用会启用降级。所有桌面版本保留稳定更新源并禁用预发布偏好。generic provider 不按该偏好过滤元数据：稳定目录必须只包含稳定版本。更旧及相同版本不提供更新；更高的正式版本仍可更新，包括与 RC 主次补丁版本相同的正式版。

发布器配置保留 builder 通道检测以及独立的 RC 元数据和目录。[分发决策](../process/2026-10-16-tos-desktop-distribution.zh.md)规定发布隔离。元数据缺失和网络错误仍是失败，不跨通道回退。下载同意、安装确认、签名、公证和发布批准仍为必要条件。

## Alternatives considered

将全局 `publish.channel` 改为 `latest` 也会改变生成的 RC 元数据名称。把 RC 元数据复制到稳定目录会破坏发布隔离。跟随 RC 目录会改变客户端的稳定更新策略。这些替代方案都无法在保留两项策略的同时修复地址组合。

## Consequences

桌面 bundle 暴露与 Main 共用实现的 updater 入口。打包 smoke 使用包内 generic provider 和拦截的 HTTP executor 调用该入口，验证完整有效 URL 和请求前策略，不访问更新网络或执行安装。源码修复不会修好已存在的签名应用；冻结候选包保持不变。

## Verification

所属本地测试使用真实 builder 配置和稳定版、RC 元数据生成，再通过真实 GenericProvider 验证 Darwin arm64/x64 与 win32 x64 模型的路由。真实 AppUpdater 版本选择覆盖更旧、相同、更新 RC 和相同主次补丁正式版，包括 generic 预发布过滤的限制。负对照拒绝旧路由、仅更改偏好的方案和通道 setter 的降级副作用。控制器状态期望覆盖自动与手动的错误、无更新和有更新结果。发布组装及发布器矩阵保留 stable/RC 隔离和坏输入拒绝。离线模型不证明原生 Windows、新打包应用、签名、GUI、下载或安装验收通过。
