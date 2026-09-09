# Agent Note: Keep the drama asset workbench isolated until source and receipt adapters exist

Status: proposed

[English](2026-09-09-drama-asset-workbench.md) | 中文

## Problem

媒体工作台可能把编辑中的提示词误标为已有媒体的生成请求。当前 Skill 也没有统一的资产/Clip 事务编辑服务，而会话提示词接收确认无法证明对应修改已完成。

## Proposal

在[隔离原型](../../../../prototypes/drama-asset-workbench/README.zh.md)中验证浏览器工作台。编译输出、下一版文字和已提交生成记录分别保存。文字更新使用稳定 ID、源版本比较、关联逐项提案和明确批准。源数据或本地草稿冲突时保留用户草稿。失败项重试排除已应用目标。

生产集成使用可叠加的 shell.overlay 插槽和现有主会话，需要项目清单适配器、源数据原子更新、关联结果事件及现有 Base 读回。受控 Worker 仅验证隔离交互协议，不代表模型或生产线。预览与草稿编辑独立于登录。

## Alternatives considered

**替换会话或详情 single 插槽。** 这会移除已有客户端功能。可叠加浮层保留已有面板。

**把提示词接收当作修改完成。** 接收仅表示内容进入收件箱。逐项提案与已应用版本回执区分投递、执行和更新。

**文字编辑后改写实际请求。** 这会伪造媒体历史和价格批准。文字修订使未来批准失效，但不更改已提交请求或删除媒体。

## Acceptance criteria

隔离 fixture 验证图片/视频查看、精确选区、草稿保留、部分失败、重试排除、乐观冲突及读回。生产接入还需经过验证的响应 schema、获准项目样例、安全媒体适配器、主会话结果关联与无密钥会话快照。

## Risks

浏览器 fixture 存储不是生产事实源。受控 Worker 会在页面卸载时终止，中断后的已接收记录不能报告为成功。源数据与 Base 同步及真实模型执行尚未验证。本独立功能提案不取代任何已有 Agent Note。
