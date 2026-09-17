# Agent Note: 桌面客户端会话与托管 OpenAPI Key

Status: implemented

[English](2026-09-17-client-session-migration.md) | 中文

## 问题

上游账号网关提供 LOOPBACK/PKCE 客户端会话和轮换 token。旧 browser-account-v2 设备授权不能用于当前 OpenAPI 报价及调用接口。只替换内置 CLI 而不改 Main，会导致调用失败或产生独立桌面身份。

## 决策

Main 使用客户端会话及系统加密、按站点隔离的存储。正式环境默认为 `https://hub.mantur.ai`，测试部署须显式指定。专用的九十天 API Key 通过现有命令 broker 授权 OpenAPI 调用。CLI 仅接收私有的短期 broker 描述文件，不接收账号 token 或 API Key。token 刷新单飞执行并在复用前提交。退出先禁止本地访问，等待命令停止再清除凭证。一次性换码结果丢失需要重新授权；Key 创建发送前记录意图，结果不确定时不能自动重复创建。

## 考虑过的替代方案

拒绝独立 CLI 登录，因为账号切换和退出会与桌面账号分离。真实报价接口返回 HTTP 401，因此拒绝直接将账号 token 用于 OpenAPI。拒绝任意复用已有个人 Key，因为所有权和撤销范围不明确。用户已授权创建专用 Key 并迁移桌面账号。

## 后果

新加密文件不转换旧设备授权数据库，升级用户需要重新登录。远端退出尽力执行，离线时本地退出仍然有效。[浏览器账号决策](2026-09-08-browser-account-authorization.zh.md)继续约束 Main 所有权、renderer 隔离和平台验收，本决策替换其中的冻结接口协议。需要定向验证控制器、响应流、真实子进程及内置包。正式站浏览器授权、macOS 系统存储和 Windows 原生验收必须与夹具结果分开报告。
