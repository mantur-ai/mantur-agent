# 隔离验证证据

验证对象仅为 prototypes/drama-asset-workbench。浏览器交互通过 Codex 内置浏览器完成，使用本机 127.0.0.1:4318；没有调用真实模型、生成算子或飞书。

| 检查 | 实际结果 |
|---|---|
| 两个 describe 与 Skill 目录 | 成功，只读 hub.mantur.ai；原始 describe 保存在本目录 |
| 单项草稿 → 应用 | 草稿保持源 v1；确认后 v2；历史媒体提示词保留 v1 |
| 批量 CHAR-001-V01 / PROP-001-V01 | 接收与执行分开可见；铜灯首轮失败，失败项重试后应用；人物版本没有重复增长 |
| 视频播放 | DOM 观测 duration=3、currentTime=0.24109、paused=false、readyState=4 |
| 收起与普通 Agent 打开 | 收起标记保持，不抢开 |
| 刷新恢复 | 视频草稿和收起状态保留；受控在途请求明确中断，可用原 request ID 恢复 |
| 单项接受 | 恢复后的 Clip 提案经“接受这一项”变为已应用 |
| 集数过滤 | 修复详情留在隐藏项的问题，EP2 只显示两个 Clip，详情跟随 EP2 |
| 手机宽度 | 390px viewport，document.scrollWidth=390，无横向溢出；检查后恢复桌面宽度 |
| impeccable detector | 对 HTML/CSS/app 运行，返回 [] |

独立 reviewer 找到草稿并发覆盖、无法逐项确认、刷新后回执挂起三个问题；本原型加入草稿 compare-and-swap 与冲突副本、逐项接受/拒绝、受控中断恢复，并追加对应行为测试。不存在真实模型端到端证据。生产请求引用校验、重新报价、Base 同步及客户端插件注册均未执行。

最终行为检查：`node --test prototypes/drama-asset-workbench/model.test.mjs` 通过 21 项，包括 owner-local 无密钥回执快照及连续输入的草稿版本竞态。app/worker/controlled-agent/locales 的 `node --check` 均通过。仓库 Oxlint 明确忽略 .mjs，本原型没有该工具的 lint 通过声明。

`pnpm run doc-sync` 首次完整检查为 32 通过、1 失败（新增双语链接）；修复后 `node scripts/verify-translation-pairing.ts prototypes/drama-asset-workbench/README.md .agents/notes/proposed/feature/2026-09-09-drama-asset-workbench.md` 确认两个配对一致，`node scripts/verify-agent-note-format.ts` 与 `git diff --check` 通过。没有重复运行已通过的其他 32 项，也没有把首次 doc-sync 的非零退出码改称成功。

修复后的全库配对检查 `node scripts/verify-translation-pairing.ts` 通过 1137 个配对。正常 git pre-commit 的配对、lint 入口、空白和 vendor guard 均通过；lint 入口按现有规则跳过 .mjs，不能替代本原型行为测试。
