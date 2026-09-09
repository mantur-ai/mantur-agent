# 字段来源与接入分析

本报告的本地证据日期为 2026-09-09。线上查询结果单独记录；本地文档不冒充 live schema。原型 fixture 是自建投影格式，不是算子实际运行响应。

## 两算子与四表

| 事实 | 已核实来源 | 工作台读取/编辑规则 |
|---|---|---|
| 提取输入完整剧本与 reference_images | Skill 1.10.7 / VERSION_LINK：asset-extract 2.3.0 | 记录原始提取来源与版本，不在 UI 发起提取 |
| 项目美术规范 | base-schema：world rules、positive style、negative constraints、画幅和音频/Clip 策略 | 项目上下文，随改写请求提供 |
| 角色（包含 crowd）、场景、道具 | base-schema 四表定义 | 图片 Tab 的三类过滤；群众保留 subtype |
| asset ID、base asset ID、variant ID | 提取合同、reference-routing-v3 | 稳定 ID 定位，V02+ 指向基础资产，禁止文件名/行号匹配 |
| generation prompt、negative constraints、适用集场、evidence、provenance、review status | Skill 与 base-schema | 提示词仅产生新修订，来源、验收、原文证据只读 |
| reference binding JSON、reference_uses、primary_layout_source | reference-routing-v3 | 保留绑定及用途，改写不隐式修改引用 |
| image URL、原附件、generation execution ID | base-schema 媒体合同 | 媒体关联到资产版本和真实生成任务；提取阶段为空 |
| episodes → scene group → Clip | clip-seedance-compile 2.3.3 本地版本合同 | 视频 Tab 按集/场过滤，一 Clip 一视频 |
| Clip ID ↔ 请求行 Clip ID | base-schema 两表一一对应 | 不按表格行顺序 join |
| prompt、previous Clip ID、continuity mode、缺失/延后资产 | Clip总表 | 依赖与阻断原因可见；同场前序尾帧不可伪造 |
| 请求体模板 JSON、metadata.content、return_last_frame | runtime-and-export | 编译产物只读；下一版提示词独立存储 |
| 实际请求、quote ID、approval、task ID、计费回执、成片/尾帧 | Seedance2.0请求体 | 已提交请求不可由 UI 覆盖；产物永远关联提交版本 |
| quality_report.duration_planning | Skill 分镜合同 | 保留原始/补足/最终秒数与审核状态，不自动缩剧情 |

## 事实源与同步

`.pipeline-state/project.json` 由预检持久化项目与环境策略；`poll-checkpoint` 持久化 task_id、poll_url、status、checkpoint、partial_path 和 result_url。动作源码没有提供一个对所有资产/Clip 的统一事务编辑库，Base 回填由 Agent 使用 lark-cli 执行。不能把 project.json 当作完整资产数据库，也不能宣称已有原子双向同步。

生产接入需要一个显式、版本锁定的项目清单引用原始提取/编译 JSON、媒体清单和任务记录。投影按稳定 ID 合并，保留原始文件及 checksum。编辑产生附加修订；应用须验证原值和源版本。现有 Agent 是写回拥有者，工作台通过受控接口请求更新，随后重新读回。Base 继续作为现有输出，写回失败保留“本地已应用/待同步”而不是谎报完成。原型仅对隔离 fixture 存储执行此协议，不直接改真实生产文件。

## 交互与最小实现

手动保存只写草稿；“交给 Agent 修改”固定目标 ID、原值/版本、草稿与用户要求，接收确认不代表改写完成。受控 Agent 返回逐项提案，用户预览差异后确认应用。应用采用版本检查，未选项不变，冲突保留草稿；成功项不可被重试重复应用。恢复历史产生新版本，不撤销已提交任务。

修改后标记资产、依赖 Clip 及同场后继为需审核。已有素材仍保留生成版本。原型不执行模型引用校验、物化、报价或提交；真实生产须复用 validate-references、materialize-video 与 live schema 检查，重新报价批准。

## 已验证的 Harness 接入位置

`packages/client/ui-layout/src/client/index.ts` 声明 `shell.overlay` 为 root/list，可用独立 id 添加；conversation/details 为已占用 single，不能接管。面板 visibility 需要按 session/project 持久化用户主动收起标记，普通 Agent 更新不得抢开。

`packages/api/session-controller/src/commands.ts` 的 prompt 使用 requestId 去重，最终通过 followup/steer 投递；返回 accepted 只代表接收。正式适配器可将结构化编辑信封作为主会话文本内容投递并记入会话日志，但必须新增关联 requestId 的提案/逐项结果事件或受控工具结果，不能根据 idle 推断某次请求成功。原型采用同一语义的隔离受控通道，不能称为真实主 Agent 端到端。

## 接入前准确缺项

1. 获准且脱敏的两个算子完整终态响应及媒体任务结果，验证 live 响应 envelope 与字段路径。
2. 当前发布客户端的插件注册入口和主会话实际适配器，由 owner 对齐；本原型不改发布包。
3. 生产项目清单、源版本指纹、原子更新/锁定与 Base 读回接口。
4. 真实会话的关联提案/结果事件、验证器和报价批准集成，以及 keyless session snapshot。
5. 项目根目录限制、MIME/checksum 验证和签名 URL 的安全媒体代理；原型只允许自有 fixture 媒体，不接受任意路径或远程 URL。

## 线上核查（2026-09-09，hub.mantur.ai）

当前基址由 Skill runtime 的 resolveManturhubBase 只读解析为 `https://hub.mantur.ai`，来源 `environment`。CLI 版本 0.10.0；未升级本地安装。`manturhub skill ls` 返回生产线 1.10.7，本次未复现此前目录 1.11.0；不能推断另一站或其他时刻目录内容。

[资产提取 describe 原始结果](asset-extract.describe.json) 中 weight=100 的版本为 v2.4.4；[分镜编译 describe 原始结果](clip-compile.describe.json) 中 weight=100 的版本为 v2.3.3。两者均 online。公开结果只有 params_schema，没有完整 output schema，也没有获准实际终态样例，兼容性仅能确认输入侧。

| 算子 | live 输入字段 | 确认约束 |
|---|---|---|
| asset-extract | action、target_region、script_url / script_text、script_name、project_style、visual_negative、reference_images、idempotency_key | 剧本 URL/正文恰选一；target_region=china/western；参考最多10张，每张必有url/label，可有note |
| clip-seedance-compile | action、script_url / script_text、asset_manifest_url / asset_manifest、project_name、episode_start/end | 剧本与资产清单各恰选一种传递方式，资产对象不含公开内嵌 schema |
| clip-seedance-compile | ratio、resolution、video_model、minimum/preferred/maximum_clips_per_episode、minimum/maximum_episode_seconds、minimum/maximum_clip_seconds | Clip 数是软目标，单 Clip 是硬时长；保留上下界各自语义 |
| clip-seedance-compile | target_region、dialogue_language、dialogue_words_per_15_seconds、dialogue_chinese_characters_per_15_seconds、missing_voice_policy | 地区决定zh/en；默认英文40词/中文55字，缺音色策略ai_direct/error |
| clip-seedance-compile | visual_style、visual_negative、hard_constraints、generate_audio、seed、idempotency_key | 不由工作台保存动作直接发起调用 |

本地 Skill 的开放参考目录与 live 的单次最多10张需要由输入准备阶段显式协调，不能静默截断；地区预设也说明旧文档的固定英文描述不足以覆盖当前配置。原型的 camelCase 字段属于工作台内部投影，四表字段的真实 JSON 键名、变体规则 JSON、输出文件索引、任务响应 envelope 与 source checksum 必须用正式响应再验证。
