# Agent Note: 可选的漫途账号入口

Status: implemented

[English](2026-09-09-optional-mantur-account-entry.md) | 中文

## Problem

账号引导参与空会话设置。因此，账号所有者不可用或账号清理未完成时，可能阻止不需要 ManturHub 凭据的本地工作。

## Decision

账号 UI 插件注册设置页和用户主动请求的原生弹窗，两种身份模式均不注册 `settings.onboarding` 入口。认证和精确设备 grant 撤销仍由现有账号服务负责。此变更使用客户端 slot 扩展点，不修改 agent loop 或 command scopes。

## Alternatives considered

自动记录“跳过”会在用户未明确操作时改变其偏好。忽略认证失败既不能授权云端请求，也会掩盖实际失败。移除引导注册将本地会话访问与可选账号交互分开。

## Consequences

本地会话创建不等待账号授权或清理。云端操作仍需要有效凭据。设置页和按需弹窗保留已有失败及取消行为。包注册测试覆盖两种身份模式和原生能力不可用的情况；真实安装包的界面验收仍须单独完成。
