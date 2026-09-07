---
description: "首次发送时创建漫途项目，重试时保留原目录，并为后续项目选择保存根目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mantur-projects

[English](README.md) | 中文

## 概述

用户可以在选择项目前编写草稿。首次发送准备一个项目目录，重试复用已记录的创建标识。更改根目录只影响后续项目。读取设置既不创建目录，也不创建 Workspace。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

[漫途 bundle](../../bundle/mantur-app/README.zh.md) 将本插件与 Workspace registry、持久存储一并挂载。桌面载体提供操作系统文档目录下的 `漫途项目` 子目录；未提供默认值的部署要求用户明确选择根目录。创建调用方提供本地化的初始项目标题。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `defaultRoot` | 未设置 | 用户选择其他位置前使用的绝对项目根目录 |

[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-mantur-projects)列出接受的配置字段。客户端在发送前展示所选位置；选择位置只保存设置，不创建项目。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

`mantur_projects` 存储领域记录所选根目录，并在创建目录前记录每次创建预留的路径。独占创建拒绝已有路径。所有权记录完成后，每次重试都确认目录仍存在且不是符号链接，再通过 Workspace registry 接纳该目录。返回的 Session id 由创建 UUID 派生；客户端通过普通 Session controller 创建会话、转移完整草稿并发送。

共享 UUID 的并发调用合并为同一次操作。Host 卸载会等待这些操作完成，再关闭存储。[创建 controller](src/index.ts)拥有文件系统操作，[领域 schema](src/spec.ts)校验持久记录。创建意图不是实时文件系统投影，因此不发布运行时不变量 companion。每次准备检查当前目录，Workspace registry 负责其独立成员资格检查。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Workspace registry](../workspace/README.zh.md) — 目录标识与 Session 成员资格。
- [Conversation](../../client/ui-conversation/README.zh.md) — 完整草稿转移与普通提交。
- [自动项目决策](../../../.agents/notes/implemented/feature/2026-09-06-mantur-automatic-project.zh.md) — 持久化、取消与恢复选择。

-----

<a id="model-experience"></a>
## 模型体验

无；本 Host 插件创建项目目录并返回标识，不创建 Session、不追加消息，也不注册模型可见内容。

#### KV Cache 影响

无；生成的工作目录对应的请求由普通 Session 组合拥有。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 目录创建与所有权回执之间崩溃，可能留下所有权不确定的预留目录。重试会拒绝它，用户可以明确选择该目录。插件绝不自动接纳或删除它。
- 移动、删除或替换已拥有的目录会明确报错。更改根目录不会迁移既有预留路径，插件不会悄悄创建替代项目。
- 本插件不保存浏览器草稿，也不接收提示词。自动首次发送依赖桌面草稿检查点和漫途客户端策略；原生持久化不可用时，在写入任何 Host 实体前阻止创建。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
