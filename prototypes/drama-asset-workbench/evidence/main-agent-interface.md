# 主会话最小接口与真实导入缺口

## 当前实现

[handoff.mjs](../handoff.mjs) 实现隔离状态中的请求准备、接收回执和确认应用；不包含网络传输、模型调用、源文件写入或 Base 同步。`main-agent-proposal-v1` 是协议测试模式，不代表真实主 Agent 已接入。浏览器 Worker 只接受 `fixture-controlled-agent`，两种模式不可互换。

宿主从允许访问的项目清单读取源文件，向投影行提供 `source.documentId`、`source.table` 和文件 SHA-256 `source.revision`。文档 ID 由清单分配，表名来自已验证报告键名，行 ID 来自资产或 Clip ID；不能用行号、标题或猜测的文件名定位。项目身份由宿主固定，重新导入不应因报告内容变化而换成另一个项目。

`prepareHandoff(state, { sessionId, requestId, ids, requirement }, currentSources)` 固定单项或批量目标、原文、草稿、草稿修订号和每项引用/前序依赖的源指纹。`currentSources` 必须由宿主重新读取源文件得到，不能从行内指纹复制。未绑定来源、缺少主会话地址或源文件变化会在请求入库前拒绝。返回的 `drama-prompt-edit-v1` 信封只允许提出 `prompt` 和 `negativePrompt` 修改；准备后的 queued 状态不表示已投递。

正式按钮由宿主在一次事务中准备并持久化信封，然后将信封作为数据投递给现有主会话。信封 requestId 是工作台关联 ID；当前 conversation.send 没有接收该 ID 的传输参数，不能声称服务端据此去重。网络超时保留原 ID，由宿主确认准入状态，不能自动重发、新建会话或切换受控 Worker。需要由会话拥有者实现并记录关联的 proposals 事件。当前浏览器预览未挂载真实发送适配器，也不根据会话 idle 状态推断改写完成。

`receiveHandoff` 校验 projectId、sessionId、requestId、已选 ID 和 attempt。admitted 只改变接收状态；proposals 携带逐项文本建议或 `AGENT_EDIT_FAILED`。非法批次整体拒绝，过时回执不覆盖已应用结果。`retryHandoff` 重新校验失败项的源指纹，再以相同信封格式返回这些项并递增其 attempt，保留原请求 ID 和原源指纹；源变化需要新建并审核请求。

用户查看差异并明确选择后，`confirmHandoff` 在宿主提供的新源指纹下检查目标、引用资产和前序 Clip；草稿及原文版本仍由编辑模型比较。逐项冲突保留提案和已有草稿；成功项只更新隔离文字修订。真实文件锁、附加修订写入、读回和 Base 同步仍由生产适配器实现，本地确认不能显示为这些步骤已经完成。源文件哈希检查本身不是跨进程原子写入保证。

## 与剧本工作台共同接入

剧本工作台拥有者确认其当前集成由剧本插件唯一注册 `main.workbench` 和 `main.workbench.toggle`，只分派 script/editing。资产应等待该轮源码提交稳定后共同增加子槽，不注册第二个外框或切换入口，也不改动其正在编辑的文件。原先独立 shell.overlay 接入提议不再作为集成方案。

[session-sender.mjs](../session-sender.mjs) 使用同一客户端路径：调用前比较当前选择与捕获的 Session ID，使用 `sessions.binding(id)?.ctx.get('conversation')`，再发送 JSON 信封。缺少绑定或会话变化时拒绝，不从另一个 feature runtime 导入发送函数。若以后抽取共享函数，应由静态 client 工具拥有者承接。此适配器不注册槽、不创建会话、不调用生成工具，也不实现第二套工作台。

单项和批量按钮使用同一路径；宿主持有原项目/原会话的事务存储，即使等待期间切换会话，回执也写回原存储：

```js
const envelope = await originalStore.transact(state => prepareHandoff(state, input, freshSources));
const receipts = await sendHandoffToSession(sessions, envelope);
await originalStore.transact(state => receipts.forEach(event => receiveHandoff(state, event)));
```

发送适配器在调用前复制信封，返回的逐项 admitted 回执始终对应被发送的 ID 和 attempt。它不改变草稿、不生成提案、不确认应用。send 拒绝时错误向上传播，宿主保留未确认投递状态；成功只表示原会话队列接收。真实提案还需关联事件，确认仍走 `confirmHandoff`。

七项受控会话注册表测试覆盖单项与批量的实际 send 回调、完整信封快照、防串会话、缺少绑定、投递失败、等待期间切换会话和修改草稿。回调由测试注入，没有启动真实 Harness Session、调用模型或改变当前浏览器预览。

## 本次真实项目证据

用户指定项目可读取 43 条资产、13 条 Clip 和 12 张本地生成图片。9 张图片通过分镜引用中明确的 asset_id 与 URL 解码文件名关联本地文件；这是本地关联证据，未核验远端文件内容。原始资产报告的图片字段全部为空。13 个成片的 SHA-256 与各自下载 meta 和导出清单一致，分为 5 个场次。测试预览和私有报告位于用户机器的临时目录，未提交剧本、原始报告、媒体或签名地址。

| 缺口 | 当前处理 | 允许解除缺口的证据 |
|---|---|---|
| 操场、医务室、能量棒三张图片缺少明确绑定 | 作为带本地文件哈希的待绑定文件显示，不进入正式资产修改请求 | 用户或源拥有者提供明确资产 ID、表及源版本，并在清单中保存映射；操场和医务室还需正式资产记录 |
| 编译表中 13 条实际请求字段为空 | 只读展示编译模板；任务 ID 标明来自下载记录；不推断生成提示词版本 | 与相同任务 ID 相关联、可核验的提交记录及其请求内容 |
| 保存的 video-params 与下载任务缺少已核验关联 | 不把参数文件当作已提交请求 | 明确的提交回执，包含任务 ID、参数指纹与提交时间/来源 |
| 前序 Clip 只有编译依赖 | 不声称真实尾帧已注入 | 实际请求引用的尾帧，以及该尾帧所属前序任务的记录 |

真实预览已验证图片显示、视频播放、集场筛选和草稿刷新保留；原始文件复核未变。该预览的主 Agent 按钮禁用。协议测试另外使用公开合成 fixture，覆盖单项/批量、稳定 ID、失效源指纹、依赖变化、草稿冲突、无关回执及失败项重试；这些结果均不是模型端到端证据。
