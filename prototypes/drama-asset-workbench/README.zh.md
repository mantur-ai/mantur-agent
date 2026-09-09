# 漫剧资产工作台隔离原型

[English](README.md) | 中文

浏览已有图片/视频，保存提示词草稿，把选定 ID 交给受控 Agent，预览差异并确认应用。原型使用两集、两条场次链、基础资产/变体及缺媒体/失败/等待尾帧等明确标注的 fixture，不连接真实主 Agent、生产项目、飞书或付费算子。

## 预览

从仓库根目录启动只绑定本机的静态预览：

```sh
python3 -m http.server 4318 --bind 127.0.0.1 --directory prototypes/drama-asset-workbench
```

打开 http://127.0.0.1:4318 。不需要 ManturHub 登录。页面在此浏览器源的 localStorage 保存隔离项目草稿、修订、回执和收起状态，通过 Web Locks 串行化多 Tab 写入。浏览器存储损坏会明确停止，不能拿 fixture 重新覆盖已有编辑。此命令是原型静态文件预览，不是新的 Harness 应用启动器。

## 操作

1. 图片/视频 Tab 与集场过滤限定浏览范围；筛选变化清空选择。
2. 打开素材，编辑下一版提示词/负面词。输入保留为浏览器草稿，点击“保存草稿”确认保存；“确认应用草稿”才产生新源修订。两者都不调用模型或生成媒体。
3. 对单项或多选项填写要求，明确发送给受控 Agent。接收确认和改写回执分开；每项展示原值、建议和状态，可以逐项接受或拒绝，也可确认全部待确认项。
4. 铜灯首轮受控改写故意失败；“仅重试失败项”保留请求 ID、递增失败项尝试号，不重做成功项。
5. 验证工具可以模拟另一 Agent 更新源版本。冲突保留草稿；比较当前文字后，显式选择基于当前版本继续。历史恢复生成新修订。
6. 收起不会终止 Worker。刷新会结束受控 Worker；同页恢复把在途记录标为“受控执行已中断”，用户可显式恢复，保持请求 ID 并只重做中断项。关闭整个页签后从新页签重开不具备跨页 Worker 归属恢复；这与真实主 Agent 后台执行不同，已接收记录不能当完成。

## 验证

```sh
node --test prototypes/drama-asset-workbench/model.test.mjs prototypes/drama-asset-workbench/handoff.test.mjs
node --test prototypes/drama-asset-workbench/session-sender.test.mjs
node --check prototypes/drama-asset-workbench/app.mjs
```

[字段映射与真实接入缺口](evidence/mapping.md) 区分 live 入参、本地 Skill 文档和未核实输出路径。[设计](DESIGN.md) 与 [产品约束](PRODUCT.md) 仅属于本目录。没有新增第三方 npm 依赖；图片为本任务自制标识卡，视频为 FFmpeg 测试源编码，不是生成的剧情素材。

## 生产接入限制

真实写回需要项目源版本指纹与原子更新适配器、主会话关联提案/回执、Base 同步读回、签名 URL 安全媒体访问，以及生成前重新验证和费用批准。剧本工作台在唯一的 main.workbench 外框下声明可选的资产标签/内容子槽。Loader 组合测试在其中挂载受控资产贡献；发布配置不添加资产提供者。生产接口缺失时不能把受控通道伪装为真实主会话。

[浏览器与测试证据](evidence/verification.md) 记录实际运行结果。expected-workflow.json 是无密钥受控通道快照，不是 Harness 真实 Session 回放。

## 主会话协议实验

[handoff.mjs](handoff.mjs) 准备仅请求文字提案的信封，并在隔离状态中验证关联的接收回执、逐项提案和明确确认。它锁定文档/表/行 ID、源文件 SHA-256、依赖版本和本地草稿修订号。宿主必须提供重新读取的源指纹；未绑定文件不能提交。受控 Worker 拒绝该协议模式。当前未安装真实传输或生产写回适配器。

[接口与导入证据](evidence/main-agent-interface.md) 定义宿主接入步骤及获准本地导入中的记录缺口。私有预览保留在仓库外：43 条资产、13 个校验通过的 Clip 和三张未绑定图片。实际请求字段为空时继续保留未知状态，参数文件不能证明已提交。expected-handoff.json 保存完整合成请求信封，不是真实主会话记录。

[session-sender.mjs](session-sender.mjs) 检查当前选择和绑定后，把冻结信封交给捕获 Session 的现有 conversation.send。它只返回接收回执，错误向上传播，不自动重试或模拟提案。七项受控注册表测试覆盖单项/批量投递及等待期间的会话/草稿变化。独立预览尚未挂载此适配器。共同外框测试使用受控会话接收和明确提案，不运行真实模型或写入项目源文件。
