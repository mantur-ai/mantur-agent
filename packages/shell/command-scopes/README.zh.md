---
description: "面向部署方和维护者的命令身份准备与完整进程树清理说明，用于组合 shell 和持久终端消费方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-scopes

[English](README.md) | 中文

## 概述

在启动 shell 进程或持久终端之前准备命令身份。身份保留到完整进程树退出且所有者确认释放之后。关闭期间拒绝新工作，并保留清理失败，不将其报告为关闭成功。协议子进程可以直接使用 subprocess 服务。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在挂载 shell 或终端消费方之前，将本服务与 subprocess 提供方一起挂载。

```yaml
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
- id: command-scopes
  name: '@deepseek-ai/dsh-command-scopes'
  config:
    identity: none
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `identity` | `none` | `required` 在一个身份提供方注册前拒绝接纳命令；`none` 不准备身份。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-command-scopes)拥有受支持配置字段的定义。身份提供方通过组合的 effect 注册，并提供环境覆盖值、取消信号和异步释放操作。身份值覆盖命令显式环境；缺少必需身份时，绝不切换为无身份作用域的命令。

进程分配在身份准备后异步返回。返回的进程分别提供直接子进程完成与完整进程树清理的 Promise。持久终端在多次发送之间保留身份，直到整个会话关闭。关闭操作同步停止接纳，取消待定准备与活动命令，并等待清理确认。取消后才完成的分配会先清理，再向调用方返回拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

命令所有者先记录接纳，再等待身份准备。当直接子进程退出但后代仍存活时，所有者继续保留取消能力。subprocess 提供方证明进程树退出后，身份提供方才释放权限。进程树退出检查或释放失败会继续保留，并使关闭操作拒绝。

[实现](src/index.ts)共同拥有注册、分配与清理。不发布运行时不变式伴生入口：本包不存在可供比较的独立事件投影或可变关系。[所有权测试](tests/command-scopes.spec.ts)在进程提供方处验证取消竞态、迟到分配与清理失败，并验证真实 POSIX 进程和终端。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Shell 执行](../shell/README.zh.md) —— 前台结果与异步后台句柄。
- [本地子进程](../../subprocess/subprocess-local/README.zh.md) —— 进程树与终端原语。
- [漫途账号授权](../../credentials/authorization-manturhub/README.zh.md) —— 桌面托管身份提供方。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-bash`、`dsh-tool-pwsh` 和持久 shell 消费方间接影响；它们呈现命令输出、取消和清理失败。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 本服务不进行账号认证、不隔离命令，也不停止绕过它的协议子进程。
- subprocess 提供方必须证明完整进程树或终端已退出。缺少证明时保留权限并拒绝关闭；仅经过一段时间不能作为证明。
- 每个必需身份的组合只接纳一个提供方。移除提供方会取消并等待它已接纳的命令。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>
