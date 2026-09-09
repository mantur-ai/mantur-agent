# 漫剧资产工作台

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

漫剧制片用户在现有 Agent 会话中查看已提取资产和 Clip，手动编辑提示词或把明确选中的记录交给主 Agent 改写。

## Product Purpose

把生产线既有事实投影为图片和视频工作台，保留资产 ID、版本、生成请求和媒体任务的关联。

## Capabilities and Constraints

本目录是隔离验证原型，fixture 与受控 Agent 均显式标注。用户要求一级图片/视频 Tab、集场过滤、详情预览、单项与批量编辑、版本冲突、确认应用、可恢复历史和关闭恢复。预览与草稿无登录门槛。生产执行继续由原 Agent/Skill 负责，真实模型需要合法凭据，生成需要重新校验和费用批准。

## Evidence on Hand

本地生产线 Skill 1.10.7 及完整 references；Harness 的 shell.overlay 列表插槽和 SessionController.prompt 接收接口。尚无获准真实项目输出，原型不扫描私有项目、不读写飞书、不生成商业素材。

## Brand Commitments

沿用客户端简洁的系统字体、浅色工作区和分栏交互。已明确的图片/视频和详情布局优先于设计探索。
