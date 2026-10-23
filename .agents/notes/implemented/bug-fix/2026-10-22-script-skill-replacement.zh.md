# Agent Note：替换下架剧本推荐

Status: implemented

[English](2026-10-22-script-skill-replacement.md) | 中文

## Problem

公开市场已下架 `short-drama`，检查该名称返回 404。删除其打包资源也会使已有草稿中的精确引用失效。

## Decision

Mantur profile 推荐 `overseas-comic-script-studio`，公开标题为“出海短剧剧本创编”。固定归档及文件清单使用与其他打包 Skill 相同的校验。`bundledUpdateNames` 显式选择检查线上更新的打包名称；缺失名称在联网前拒绝，未设置时保持检查全部打包项。profile 从此名单排除 `short-drama`，同时保留不可变打包资源和原身份。用户安装及持久化引用不重写。

## Alternatives considered

只改按钮仍会请求已下架的元数据。删除旧归档会破坏精确引用。将旧名称映射到新内容会改变已保存输入的含义。把资源保留与更新选择分开可以避免上述三种影响。

## Consequences

旧引用可离线解析，无需查询下架版本。缓存版本保持不可变，更新选择不会回收缓存。其他推荐模式保留各自更新行为。Host 测试覆盖排除、缓存重用、旧精确引用和配置名称缺失；资源准备校验完整固定归档清单；客户端测试覆盖新标签与引用身份。

素材推荐使用 `mantur-preroll-remix-studio`，首页标签为“短剧素材智能剪辑”。原 `mantur-smartclip` 保留打包资源和旧引用，但不检查默认更新。两个替换技能均要求内嵌 CLI 1.2.10，其官方 npm 归档摘要经过验证，依赖锁定；本地 broker 测试验证桌面身份传输。
