# Embedded Mantur CLI input

English | [中文](README.zh.md)

This directory pins the MIT-licensed `@manturhub/cli` 1.2.10 release from [the official npm registry](https://registry.npmjs.org/@manturhub/cli/-/cli-1.2.10.tgz). The archive is 66,425 bytes with SHA-256 `a486b168988239485fa45e01ad24a8c319eca5eda0c1587fe9b15c1a244e99a0`; its 32 entries include the upstream license and unmodified CLI source.

[prepare-cli.ts](../scripts/prepare-cli.ts) verifies the archive, installs only its locked production dependencies with `npm ci`, and prepares desktop resources with retained license files. The independent lock pins `@vercel/detect-agent` 1.2.1 under Apache-2.0, plus the CLI’s JSON-schema validators and `libsql` 0.5.29 with its platform-specific native dependencies. It does not change the root pnpm graph or install a global command.

Run the resource preparation from the repository root:

```sh
pnpm --dir apps/desktop run prepare:cli
```

The package and development workflows invoke this preparation before launching or packaging the desktop. The [desktop runtime](../README.md) owns launcher selection and account identity. Replacing this archive requires a reviewed source delivery, new hash, updated independent lock and CLI/broker verification; an absent npm release never selects another version.
