# Embedded Mantur CLI input

English | [中文](README.zh.md)

This directory pins the MIT-licensed `@manturhub/cli` 1.2.6 delivery from source commit `c9b569d198f1b65690a28b5b1f2584b9c2e76f82`. The archive is 58,619 bytes with SHA-256 `98d2eefe59566b220950ac201f7ad133c47e469e3e0dfcad180027d6a623f86d`; its 30 entries include the upstream license and unmodified CLI source.

[prepare-cli.ts](../scripts/prepare-cli.ts) verifies the archive, installs only its locked production dependencies with `npm ci`, and prepares desktop resources with retained license files. The independent lock pins `@vercel/detect-agent` 1.2.1 under Apache-2.0, plus the CLI’s JSON-schema validators and `libsql` 0.5.29 with its platform-specific native dependencies. It does not change the root pnpm graph or install a global command.

Run the resource preparation from the repository root:

```sh
pnpm --dir apps/desktop run prepare:cli
```

The package and development workflows invoke this preparation before launching or packaging the desktop. The [desktop runtime](../README.md) owns launcher selection and account identity. Replacing this archive requires a reviewed source delivery, new hash, updated independent lock and CLI/broker verification; an absent npm release never selects another version.
