# 内置 Mantur CLI 输入

[English](README.md) | 中文

本目录固定 MIT 许可的 `@manturhub/cli` 1.2.10 正式版本，来源为[官方 npm registry](https://registry.npmjs.org/@manturhub/cli/-/cli-1.2.10.tgz)。归档大小为 66,425 字节，SHA-256 为 `a486b168988239485fa45e01ad24a8c319eca5eda0c1587fe9b15c1a244e99a0`；32 个条目包含上游许可证和未经修改的 CLI 源码。

[prepare-cli.ts](../scripts/prepare-cli.ts)校验归档，通过 `npm ci` 仅安装锁定的生产依赖，并准备保留许可证文件的桌面资源。独立锁文件将 Apache-2.0 许可的 `@vercel/detect-agent` 固定为 1.2.1，并锁定 CLI 的 JSON Schema 校验依赖及 `libsql` 0.5.29 和对应平台的原生依赖。它不修改根 pnpm 依赖图，也不安装全局命令。

在仓库根目录执行资源准备：

```sh
pnpm --dir apps/desktop run prepare:cli
```

打包和开发工作流在启动或打包桌面前执行此准备。[桌面运行时](../README.zh.md)负责启动器选择和账号身份。替换归档需要审核过的源码交付、新哈希、更新独立锁文件及 CLI/broker 验证；npm 发布缺失时不会选择其他版本。
