# Agent Note: 精确配置监听等待 Darwin 原生启动

Status: implemented

[English](2026-10-24-hmr-native-startup-barrier.md) | 中文

## 问题

精确配置注册可能在 macOS 启动原生事件流之前返回。调用方随后只创建一次目标文件，却收不到刷新。Chokidar 就绪只覆盖扫描和 watcher 创建调用；libuv 在另一线程以 `SinceNow` 创建 Darwin FSEvents 流，因此流创建前已发布的变更可能丢失。删除路径后重开监听、观察尚不存在的父目录时也存在同一窗口。

## 决策

[HMR（热模块替换）](../../../../vendor/hmr/src/index.ts) 等待 Chokidar 就绪，然后在 Darwin 且 watcher 实际选项禁用 polling 时，打开并关闭一个临时原生目录 watcher。libuv 关闭目录句柄时会等待共享 FSEvents 流重新调度，并纳入仍存活的精确 watcher。注册在该关闭完成后返回；临时原生 watcher 创建或关闭失败沿用现有注册清理与拒绝路径。此操作不写文件，也不改变 polling、刷新队列或时间预算。

此平台修正属于 vendored HMR，因为 app-boot 包装无法为其他调用方修复 `registerConfig()` 的就绪语义。受影响的上游源码和差异记录在 [vendor 日志](../../../../vendor/README.md) 中。[事务式重载](2026-07-20-config-hot-reload-resilience.zh.md)与[初始扫描抑制](2026-08-03-hmr-initial-scan-boot-deadlock.zh.md)仍各自负责独立问题。

## 考虑过的替代方案

**Sleep、重复写入或 polling 覆盖。** 这些操作改变调度或观察模式，却不能确认原生就绪。验收仍要求调用方只写一次。

**Chokidar 就绪后再读一次文件。** 读取之后、原生流启动之前仍存在窗口，无法覆盖调用方在该窗口内的后续写入。

**只同步测试中的写入方。** 这会削弱 API 在返回前就绪的承诺。启动同步属于注册内部。

## 影响

Darwin 原生注册增加一个临时目录句柄和一次流重新调度。此修正依赖 libuv 的 FSEvents 关闭同步，而非 Node 对其他 watcher 的公开保证；升级 Node/libuv 时必须重放受控启动竞态。它不承诺在无关的后续流重建期间无损传递事件，也不替代操作系统的事件语义。

受控 macOS 实验在真实 `FSEventStreamCreate` 采样 `SinceNow` 之前暂停它。独立进程确认单次目标写入的事件已发布后才释放暂停。原 HMR 提前返回并漏掉写入；同步后的注册等待原生关闭，返回后能收到调用方写入。历史失败缺少原生阶段记录，因此已证明的机制不能确定每次历史调用的精确原因。

[精确监听测试](../../../../packages/boot/app-boot/tests/hmr-config.spec.ts)保留原生 add/change/unlink 和缺失父目录用例，并约束关闭完成与启动拒绝。[Patch 测试](../../../../packages/boot/app-boot/tests/user-patches.spec.ts)观察真实 Include 更新完成；[事务 barrier](../../../../packages/boot/app-boot/tests/transaction-barrier.spec.ts)证明 dispose（资源释放）等待尚未完成的真实插件应用，且新一代独立完成。移除 drain 会使该 barrier 失败。模型文本、会话事件、SDK 行为及转录格式均未改变；此回归由文件系统和生命周期断言负责，而非录制模型响应。
